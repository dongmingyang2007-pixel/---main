import json
from random import randint
import time
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import enforce_rate_limit, get_client_ip, get_db_session, require_allowed_origin
from app.core.errors import ApiError
from app.schemas.demo import (
    DemoInferRequest,
    DemoInferResponse,
    DemoUploadPresignRequest,
    DemoUploadPresignResponse,
)
from app.services.audit import write_audit_log
from app.services.runtime_state import runtime_state
from app.services.storage import (
    build_demo_object_key,
    build_upload_id,
    create_presigned_post,
    put_object_bytes,
)
from app.services.upload_validation import (
    buffer_upload_body,
    ensure_uploaded_object_matches,
    ensure_uploaded_object_signature_matches,
    validate_workspace_upload_signature,
)
from app.tasks.worker_tasks import cleanup_pending_demo_request


router = APIRouter(prefix="/api/v1/demo", tags=["demo"])


def _demo_request_scope(request_id: str) -> str:
    return f"demo:request:{request_id}"


def _demo_upload_scope(upload_id: str) -> str:
    return f"demo:upload:{upload_id}"


def _demo_session_ttl_seconds(session: dict) -> int:
    expires_at = session.get("expires_at")
    if isinstance(expires_at, (int, float)):
        remaining = int(float(expires_at) - time.time())
        return max(1, remaining)
    return settings.demo_request_ttl_seconds


def _release_demo_slot(client_ip: str, session: dict | None = None) -> None:
    if session is not None and session.get("slot_released"):
        return
    runtime_state.decr("demo:active", client_ip)
    if session is not None:
        session["slot_released"] = True

@router.post("/presign", response_model=DemoUploadPresignResponse)
def demo_presign_upload(payload: DemoUploadPresignRequest, request: Request) -> DemoUploadPresignResponse:
    require_allowed_origin(request)
    client_ip = get_client_ip(request)
    enforce_rate_limit(
        request,
        scope="demo:presign",
        identifier=client_ip,
        limit=settings.demo_presign_rate_limit_max,
        window_seconds=settings.demo_presign_rate_limit_window_seconds,
    )
    concurrent = runtime_state.incr(
        "demo:active",
        client_ip,
        ttl_seconds=settings.demo_request_ttl_seconds,
    )
    if concurrent > settings.demo_max_concurrent_sessions_per_ip:
        runtime_state.decr("demo:active", client_ip)
        raise ApiError("rate_limited", "Too many concurrent demo sessions", status_code=429)
    max_bytes = settings.upload_max_mb * 1024 * 1024
    if payload.size_bytes > max_bytes:
        raise ApiError(
            "payload_too_large",
            f"File exceeds {settings.upload_max_mb}MB limit",
            status_code=413,
        )
    if payload.media_type not in settings.demo_allowed_media_types:
        raise ApiError("unsupported_media_type", "Only image uploads are allowed in demo mode", status_code=415)

    request_id = str(uuid4())
    upload_id = build_upload_id()
    object_key = build_demo_object_key(request_id=request_id, filename=payload.filename)
    headers: dict[str, str] = {}
    fields: dict[str, str] = {}
    upload_method = "PUT"
    if settings.should_use_proxy_uploads():
        put_url = f"{str(request.base_url).rstrip('/')}/api/v1/demo/upload/{upload_id}"
        headers = {"Content-Type": payload.media_type}
    else:
        put_url, fields, headers = create_presigned_post(
            bucket_name=settings.s3_demo_bucket,
            object_key=object_key,
            media_type=payload.media_type,
            max_bytes=payload.size_bytes,
        )
        upload_method = "POST"

    expires_at = time.time() + settings.demo_request_ttl_seconds
    runtime_state.set_json(
        _demo_request_scope(request_id),
        "session",
        {
            "request_id": request_id,
            "upload_id": upload_id,
            "object_key": object_key,
            "media_type": payload.media_type,
            "size_bytes": payload.size_bytes,
            "client_ip": client_ip,
            "uploaded": False,
            "infer_count": 0,
            "slot_released": False,
            "expires_at": expires_at,
        },
        ttl_seconds=settings.demo_request_ttl_seconds,
    )
    runtime_state.set_json(
        _demo_upload_scope(upload_id),
        "session",
        {
            "request_id": request_id,
            "object_key": object_key,
            "media_type": payload.media_type,
            "size_bytes": payload.size_bytes,
            "client_ip": client_ip,
            "expires_at": expires_at,
        },
        ttl_seconds=settings.demo_request_ttl_seconds,
    )
    try:
        cleanup_pending_demo_request.apply_async(
            args=[request_id, object_key, upload_id, client_ip],
            countdown=settings.demo_request_ttl_seconds,
        )
    except Exception:  # noqa: BLE001
        pass

    return DemoUploadPresignResponse(
        request_id=request_id,
        upload_id=upload_id,
        put_url=put_url,
        headers=headers,
        fields=fields,
        upload_method=upload_method,
    )


@router.put("/upload/{upload_id}")
async def demo_upload(upload_id: str, request: Request) -> dict[str, bool]:
    require_allowed_origin(request)
    upload = runtime_state.get_json(_demo_upload_scope(upload_id), "session")
    if not upload:
        raise ApiError("upload_not_found", "Upload session not found", status_code=404)
    if upload["client_ip"] != get_client_ip(request):
        raise ApiError("forbidden", "Upload session not accessible", status_code=403)
    content_type = request.headers.get("content-type", "")
    if content_type and content_type != upload["media_type"]:
        raise ApiError("content_type_mismatch", "Content-Type does not match upload session", status_code=400)

    max_bytes = settings.upload_max_mb * 1024 * 1024
    buffered_upload = await buffer_upload_body(
        request,
        expected_size=upload["size_bytes"],
        max_bytes=max_bytes,
    )
    try:
        validate_workspace_upload_signature(
            prefix=buffered_upload.peek_prefix(),
            media_type=upload["media_type"],
        )

        if settings.env != "test":
            try:
                put_object_bytes(
                    bucket_name=settings.s3_demo_bucket,
                    object_key=upload["object_key"],
                    payload=buffered_upload.file,
                    media_type=upload["media_type"],
                )
            except Exception as exc:  # noqa: BLE001
                raise ApiError("storage_error", "Object upload failed", status_code=502) from exc
    finally:
        buffered_upload.close()

    request_session = runtime_state.get_json(_demo_request_scope(upload["request_id"]), "session")
    if request_session:
        request_session["uploaded"] = True
        runtime_state.set_json(
            _demo_request_scope(upload["request_id"]),
            "session",
            request_session,
            ttl_seconds=_demo_session_ttl_seconds(request_session),
        )
    runtime_state.delete(_demo_upload_scope(upload_id), "session")
    return {"ok": True}


@router.post("/infer", response_model=DemoInferResponse)
async def demo_infer(
    payload: DemoInferRequest,
    request: Request,
    db: Session = Depends(get_db_session),
) -> DemoInferResponse:
    require_allowed_origin(request)
    client_ip = get_client_ip(request)
    enforce_rate_limit(
        request,
        scope="demo:infer",
        identifier=client_ip,
        limit=settings.demo_infer_rate_limit_max,
        window_seconds=settings.demo_infer_rate_limit_window_seconds,
    )
    if len(payload.prompt) > settings.demo_prompt_max_chars:
        raise ApiError("prompt_too_long", "Prompt exceeds allowed length", status_code=400)
    session = runtime_state.get_json(_demo_request_scope(payload.request_id), "session")
    if not session:
        raise ApiError("request_not_found", "Demo request not found or expired", status_code=404)
    if session.get("client_ip") != client_ip:
        raise ApiError("forbidden", "Demo request not accessible", status_code=403)
    if not session.get("uploaded"):
        ensure_uploaded_object_matches(
            bucket_name=settings.s3_demo_bucket,
            object_key=session["object_key"],
            expected_size_bytes=session["size_bytes"],
            expected_media_type=session["media_type"],
            missing_message="Demo upload is not complete",
            mismatch_message="Demo upload metadata does not match declared file",
        )
        ensure_uploaded_object_signature_matches(
            bucket_name=settings.s3_demo_bucket,
            object_key=session["object_key"],
            media_type=session["media_type"],
            mismatch_message="Demo upload contents do not match declared file type",
        )
        session["uploaded"] = True
        runtime_state.set_json(
            _demo_request_scope(payload.request_id),
            "session",
            session,
            ttl_seconds=_demo_session_ttl_seconds(session),
        )
    if session.get("infer_count", 0) >= settings.demo_max_infer_count:
        raise ApiError("rate_limited", "Demo request inference limit reached", status_code=429)
    request_id = payload.request_id

    if settings.demo_mode:
        if payload.task == "vqa":
            text = "图中看起来是室内场景，包含椅子与桌面。"
            boxes = [
                {"x": 0.12, "y": 0.25, "w": 0.30, "h": 0.40, "label": "chair", "score": 0.91},
                {"x": 0.45, "y": 0.34, "w": 0.22, "h": 0.18, "label": "desk", "score": 0.87},
            ]
            case_display_text = "前方：椅子（2m）"
            tts_text = "前方约两米有椅子。"
        else:
            text = "识别到文字：QIHANG DEMO"
            boxes = [{"x": 0.10, "y": 0.15, "w": 0.70, "h": 0.20, "label": "text", "score": 0.93}]
            case_display_text = "文字：QIHANG DEMO"
            tts_text = "我看到了文字，QIHANG DEMO。"

        session["infer_count"] = session.get("infer_count", 0) + 1
        _release_demo_slot(client_ip, session)
        runtime_state.set_json(
            _demo_request_scope(payload.request_id),
            "session",
            session,
            ttl_seconds=_demo_session_ttl_seconds(session),
        )
        return DemoInferResponse(
            request_id=request_id,
            task=payload.task,
            latency_ms=randint(80, 180),
            outputs={"text": text, "boxes": boxes},
            ui_cards={
                "case_display_text": case_display_text,
                "tts_text": tts_text,
                "status_icons": ["cloud", "privacy_on"],
            },
        )

    if not settings.demo_infer_enabled:
        raise ApiError("demo_infer_disabled", "Demo inference proxy is disabled", status_code=403)

    if not settings.inference_endpoint:
        raise ApiError("inference_not_configured", "INFERENCE_ENDPOINT is required", status_code=500)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
            response = await client.post(
                settings.inference_endpoint,
                json={
                    "request_id": payload.request_id,
                    "task": payload.task,
                    "prompt": payload.prompt,
                    "locale": payload.locale,
                    "image_ref": {
                        "type": "s3",
                        "bucket": settings.s3_demo_bucket,
                        "object_key": session["object_key"],
                    },
                },
            )
            response.raise_for_status()
            body = await response.aread()
    except (httpx.HTTPError, ValueError) as exc:
        write_audit_log(
            db,
            workspace_id=None,
            actor_user_id=None,
            action="demo.infer_failed",
            target_type="demo_request",
            target_id=payload.request_id,
            meta_json={"reason": "upstream_error", "error_type": type(exc).__name__},
        )
        db.commit()
        _release_demo_slot(client_ip, session)
        runtime_state.set_json(
            _demo_request_scope(payload.request_id),
            "session",
            session,
            ttl_seconds=_demo_session_ttl_seconds(session),
        )
        raise ApiError("inference_failed", "Inference request failed", status_code=502) from exc
    if len(body) > 1024 * 1024:
        write_audit_log(
            db,
            workspace_id=None,
            actor_user_id=None,
            action="demo.infer_failed",
            target_type="demo_request",
            target_id=payload.request_id,
            meta_json={"reason": "response_too_large"},
        )
        db.commit()
        _release_demo_slot(client_ip, session)
        runtime_state.set_json(
            _demo_request_scope(payload.request_id),
            "session",
            session,
            ttl_seconds=_demo_session_ttl_seconds(session),
        )
        raise ApiError("response_too_large", "Inference response exceeded size limit", status_code=502)
    data = json.loads(body.decode("utf-8"))
    session["infer_count"] = session.get("infer_count", 0) + 1
    _release_demo_slot(client_ip, session)
    runtime_state.set_json(
        _demo_request_scope(payload.request_id),
        "session",
        session,
        ttl_seconds=_demo_session_ttl_seconds(session),
    )
    write_audit_log(
        db,
        workspace_id=None,
        actor_user_id=None,
        action="demo.infer_succeeded",
        target_type="demo_request",
        target_id=payload.request_id,
        meta_json={"task": payload.task},
    )
    db.commit()

    return DemoInferResponse(
        request_id=data.get("request_id", request_id),
        task=data.get("task", payload.task),
        latency_ms=data.get("latency_ms", 0),
        outputs=data.get("outputs", {}),
        ui_cards=data.get("ui_cards", {}),
    )

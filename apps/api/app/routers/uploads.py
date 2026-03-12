from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import get_current_user, get_current_workspace_id, get_db_session, require_csrf_protection
from app.core.errors import ApiError
from app.models import DataItem, User
from app.routers.utils import get_data_item_in_workspace, get_dataset_in_workspace, get_project_in_workspace
from app.schemas.dataset import UploadCompleteRequest, UploadPresignRequest, UploadPresignResponse
from app.services.audit import write_audit_log
from app.services.runtime_state import runtime_state
from app.services.storage import (
    build_data_item_object_key,
    build_upload_id,
    create_presigned_put,
    object_exists,
    put_object_bytes,
)
from app.services.upload_validation import ensure_uploaded_object_matches, read_upload_body
from app.tasks.worker_tasks import process_data_item


router = APIRouter(prefix="/api/v1/uploads", tags=["uploads"])


def _upload_session_scope(upload_id: str) -> str:
    return f"upload:{upload_id}"

@router.post("/presign", response_model=UploadPresignResponse)
def presign_upload(
    payload: UploadPresignRequest,
    request: Request,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> UploadPresignResponse:
    dataset = get_dataset_in_workspace(db, dataset_id=payload.dataset_id, workspace_id=workspace_id)
    if not dataset:
        raise ApiError("not_found", "Dataset not found", status_code=404)
    project = get_project_in_workspace(db, project_id=dataset.project_id, workspace_id=workspace_id)
    if not project:
        raise ApiError("not_found", "Project not found", status_code=404)

    max_bytes = settings.upload_max_mb * 1024 * 1024
    if payload.size_bytes > max_bytes:
        raise ApiError(
            "payload_too_large",
            f"File exceeds {settings.upload_max_mb}MB limit",
            status_code=413,
        )

    data_item_id = str(uuid4())
    object_key = build_data_item_object_key(
        workspace_id=workspace_id,
        project_id=project.id,
        dataset_id=payload.dataset_id,
        data_item_id=data_item_id,
        filename=payload.filename,
    )
    upload_id = build_upload_id()
    headers = {"Content-Type": payload.media_type}
    if settings.should_use_proxy_uploads():
        put_url = f"{str(request.base_url).rstrip('/')}/api/v1/uploads/proxy/{upload_id}"
    else:
        put_url, headers = create_presigned_put(
            bucket_name=settings.s3_private_bucket,
            object_key=object_key,
            media_type=payload.media_type,
        )

    item = DataItem(
        id=data_item_id,
        dataset_id=payload.dataset_id,
        object_key=object_key,
        filename=payload.filename,
        media_type=payload.media_type,
        size_bytes=payload.size_bytes,
        meta_json={"upload_status": "presigned"},
    )
    db.add(item)
    db.flush()

    runtime_state.set_json(
        _upload_session_scope(upload_id),
        "session",
        {
        "data_item_id": data_item_id,
        "dataset_id": payload.dataset_id,
        "project_id": project.id,
        "user_id": current_user.id,
        "workspace_id": workspace_id,
        "object_key": object_key,
        "media_type": payload.media_type,
        "size_bytes": payload.size_bytes,
        "uploaded": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        },
        ttl_seconds=settings.upload_session_ttl_seconds,
    )

    write_audit_log(
        db,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        action="upload.presign",
        target_type="data_item",
        target_id=data_item_id,
        meta_json={"object_key": object_key},
    )
    db.commit()

    return UploadPresignResponse(
        upload_id=upload_id,
        put_url=put_url,
        headers=headers,
        data_item_id=data_item_id,
    )


@router.put("/proxy/{upload_id}")
async def proxy_upload_put(
    upload_id: str,
    request: Request,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> dict[str, bool]:
    upload = runtime_state.get_json(_upload_session_scope(upload_id), "session")
    if not upload:
        raise ApiError("upload_not_found", "Upload session not found", status_code=404)
    if upload["user_id"] != current_user.id or upload["workspace_id"] != workspace_id:
        raise ApiError("forbidden", "Upload session not accessible", status_code=403)
    content_type = request.headers.get("content-type", "")
    if content_type and content_type != upload["media_type"]:
        raise ApiError("content_type_mismatch", "Content-Type does not match upload session", status_code=400)

    max_bytes = settings.upload_max_mb * 1024 * 1024
    payload = await read_upload_body(request, expected_size=upload["size_bytes"], max_bytes=max_bytes)

    item = get_data_item_in_workspace(db, data_item_id=upload["data_item_id"], workspace_id=workspace_id)
    if not item:
        raise ApiError("not_found", "Data item not found", status_code=404)

    if settings.env != "test":
        try:
            put_object_bytes(
                bucket_name=settings.s3_private_bucket,
                object_key=upload["object_key"],
                payload=payload,
                media_type=upload["media_type"],
            )
        except Exception as exc:  # noqa: BLE001
            raise ApiError("storage_error", "Object upload failed", status_code=502) from exc

    item.meta_json = {**(item.meta_json or {}), "upload_status": "uploaded"}
    upload["uploaded"] = True
    runtime_state.set_json(
        _upload_session_scope(upload_id),
        "session",
        upload,
        ttl_seconds=settings.upload_session_ttl_seconds,
    )
    db.commit()
    return {"ok": True}


@router.post("/complete")
def complete_upload(
    payload: UploadCompleteRequest,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> dict[str, bool]:
    upload = runtime_state.get_json(_upload_session_scope(payload.upload_id), "session")
    if not upload:
        raise ApiError("upload_not_found", "Upload session not found", status_code=404)

    if upload["data_item_id"] != payload.data_item_id:
        raise ApiError("mismatch", "Upload and data item mismatch", status_code=400)
    if upload["user_id"] != current_user.id or upload["workspace_id"] != workspace_id:
        raise ApiError("forbidden", "Upload session not accessible", status_code=403)

    item = get_data_item_in_workspace(db, data_item_id=payload.data_item_id, workspace_id=workspace_id)
    if not item:
        raise ApiError("not_found", "Data item not found", status_code=404)

    dataset = get_dataset_in_workspace(db, dataset_id=item.dataset_id, workspace_id=workspace_id)
    if not dataset:
        raise ApiError("not_found", "Dataset not found", status_code=404)
    if not upload.get("uploaded"):
        if not object_exists(
            bucket_name=settings.s3_private_bucket,
            object_key=upload["object_key"],
        ):
            raise ApiError("upload_incomplete", "Uploaded object not found", status_code=400)
        ensure_uploaded_object_matches(
            bucket_name=settings.s3_private_bucket,
            object_key=upload["object_key"],
            expected_size_bytes=upload["size_bytes"],
            expected_media_type=upload["media_type"],
            missing_message="Uploaded object not found",
            mismatch_message="Uploaded object metadata does not match declared file",
        )

    item.meta_json = {**(item.meta_json or {}), "upload_status": "completed"}

    write_audit_log(
        db,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        action="upload.complete",
        target_type="data_item",
        target_id=item.id,
        meta_json={"object_key": item.object_key},
    )
    db.commit()

    try:
        if settings.env == "test":
            raise RuntimeError("execute_inline_in_test")
        process_data_item.delay(item.id)
    except Exception:  # noqa: BLE001
        process_data_item(item.id)

    runtime_state.delete(_upload_session_scope(payload.upload_id), "session")
    return {"ok": True}

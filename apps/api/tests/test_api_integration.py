# ruff: noqa: E402

import atexit
import asyncio
import base64
import hashlib
import importlib
import os
from pathlib import Path
import shutil
import tempfile
from types import SimpleNamespace

from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
import pytest
from starlette.websockets import WebSocketDisconnect

TEST_TEMP_DIR = Path(tempfile.mkdtemp(prefix="qihang-api-tests-"))
atexit.register(lambda: shutil.rmtree(TEST_TEMP_DIR, ignore_errors=True))

DB_PATH = TEST_TEMP_DIR / "test_api.db"
os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH}"
os.environ["ENV"] = "test"
os.environ["COOKIE_DOMAIN"] = ""
os.environ["DEMO_MODE"] = "true"

import app.core.config as config_module

config_module.get_settings.cache_clear()
config_module.settings = config_module.get_settings()

import app.db.session as session_module

importlib.reload(session_module)

import app.main as main_module

importlib.reload(main_module)

import app.routers.auth as auth_router
import app.routers.chat as chat_router
import app.routers.memory as memory_router
import app.routers.realtime as realtime_router
import app.routers.uploads as uploads_router
import app.services.dashscope_stream as dashscope_stream_service
import app.services.memory_file_context as memory_file_context_service
import app.services.orchestrator as orchestrator_service
from app.core.config import settings
from app.core.deps import revoke_user_tokens
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models import (
    AuditLog,
    Conversation,
    DataItem,
    Dataset,
    Memory,
    Message,
    Membership,
    MemoryFile,
    ModelVersion,
    PipelineConfig,
    Project,
    User,
    Workspace,
)
from app.services.model_catalog_seed import seed_model_catalog
from app.services import storage as storage_service
from app.services.runtime_state import runtime_state
import app.tasks.worker_tasks as worker_tasks

ORIGIN = "http://localhost:3000"


def setup_function() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_model_catalog(db)
    with runtime_state._memory._lock:
        runtime_state._memory._data.clear()


def public_headers() -> dict[str, str]:
    return {"origin": ORIGIN}


def verification_code_key(email: str, purpose: str) -> str:
    raw = f"{email.lower().strip()}:{purpose}"
    return hashlib.sha256(raw.encode()).hexdigest()


def issue_verification_code(client: TestClient, email: str, purpose: str = "register") -> str:
    resp = client.post(
        "/api/v1/auth/send-code",
        json={"email": email, "purpose": purpose},
        headers=public_headers(),
    )
    assert resp.status_code == 200

    entry = runtime_state.get_json("verify_code", verification_code_key(email, purpose))
    assert entry is not None
    return str(entry["code"])


def csrf_headers(client: TestClient, workspace_id: str | None = None) -> dict[str, str]:
    resp = client.get("/api/v1/auth/csrf", headers=public_headers())
    assert resp.status_code == 200
    headers = {"origin": ORIGIN, "x-csrf-token": resp.json()["csrf_token"]}
    if workspace_id:
        headers["x-workspace-id"] = workspace_id
    return headers


def add_workspace_membership(workspace_id: str, email: str, role: str) -> str:
    with SessionLocal() as db:
        user_id = db.query(User.id).filter(User.email == email).first()
        assert user_id is not None
        membership = Membership(workspace_id=workspace_id, user_id=user_id[0], role=role)
        db.add(membership)
        db.commit()
        return user_id[0]


def create_conversation_record(workspace_id: str, project_id: str, created_by: str, title: str) -> str:
    with SessionLocal() as db:
        conversation = Conversation(
            workspace_id=workspace_id,
            project_id=project_id,
            title=title,
            created_by=created_by,
        )
        db.add(conversation)
        db.commit()
        db.refresh(conversation)
        return conversation.id


def register_user(client: TestClient, email: str, display_name: str = "User") -> dict:
    code = issue_verification_code(client, email, "register")
    resp = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "pass1234pass",
            "display_name": display_name,
            "code": code,
        },
        headers=public_headers(),
    )
    assert resp.status_code == 200
    return resp.json()


def create_project(client: TestClient, name: str = "P1") -> dict:
    resp = client.post(
        "/api/v1/projects",
        json={"name": name, "description": "demo", "default_chat_mode": "standard"},
        headers=csrf_headers(client),
    )
    assert resp.status_code == 200
    return resp.json()


def create_dataset(client: TestClient, project_id: str, name: str = "D1") -> dict:
    resp = client.post(
        "/api/v1/datasets",
        json={"project_id": project_id, "name": name, "type": "images"},
        headers=csrf_headers(client),
    )
    assert resp.status_code == 200
    return resp.json()


def upload_fixture(filename: str) -> tuple[bytes, str]:
    suffix = Path(filename).suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return (b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00", "image/jpeg")
    if suffix == ".png":
        return (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR", "image/png")
    if suffix == ".pdf":
        return (b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "application/pdf")
    if suffix == ".txt":
        return (b"hello from qihang\n", "text/plain")
    if suffix == ".md":
        return (b"# qihang\n", "text/markdown")
    if suffix == ".docx":
        return (b"PK\x03\x04\x14\x00\x00\x00\x08\x00", _DOCX_MEDIA_TYPE)
    raise AssertionError(f"Unsupported test fixture for {filename}")


def upload_item(client: TestClient, dataset_id: str, filename: str) -> str:
    payload_bytes, media_type = upload_fixture(filename)
    presign = client.post(
        "/api/v1/uploads/presign",
        json={
            "dataset_id": dataset_id,
            "filename": filename,
            "media_type": media_type,
            "size_bytes": len(payload_bytes),
        },
        headers=csrf_headers(client),
    )
    assert presign.status_code == 200
    payload = presign.json()

    put_resp = client.put(
        payload["put_url"],
        content=payload_bytes,
        headers={**payload["headers"], **csrf_headers(client)},
    )
    assert put_resp.status_code == 200

    complete = client.post(
        "/api/v1/uploads/complete",
        json={"upload_id": payload["upload_id"], "data_item_id": payload["data_item_id"]},
        headers=csrf_headers(client),
    )
    assert complete.status_code == 200
    return payload["data_item_id"]


def commit_dataset(client: TestClient, dataset_id: str, commit_message: str, freeze_filter: dict | None = None) -> dict:
    resp = client.post(
        f"/api/v1/datasets/{dataset_id}/commit",
        json={"commit_message": commit_message, "freeze_filter": freeze_filter},
        headers=csrf_headers(client),
    )
    assert resp.status_code == 200
    return resp.json()["dataset_version"]


def make_client_error(code: str, status_code: int) -> ClientError:
    return ClientError(
        {
            "Error": {"Code": code, "Message": "boom"},
            "ResponseMetadata": {"HTTPStatusCode": status_code},
        },
        "HeadObject",
    )


def upload_model_artifact(client: TestClient, model_id: str, filename: str) -> str:
    payload_bytes = b'{"ok": true}'
    presign = client.post(
        f"/api/v1/models/{model_id}/artifact-uploads/presign",
        json={"filename": filename, "media_type": "application/json", "size_bytes": len(payload_bytes)},
        headers=csrf_headers(client),
    )
    assert presign.status_code == 200
    payload = presign.json()

    put_resp = client.put(
        payload["put_url"],
        content=payload_bytes,
        headers={**payload["headers"], **csrf_headers(client)},
    )
    assert put_resp.status_code == 200
    return payload["artifact_upload_id"]


_DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class DummyRealtimeUpstream:
    def __init__(self, *, close_immediately: bool = False):
        self._queue: asyncio.Queue[str | None] = asyncio.Queue()
        if close_immediately:
            self._queue.put_nowait(None)

    def __aiter__(self):
        return self

    async def __anext__(self):
        message = await self._queue.get()
        if message is None:
            raise StopAsyncIteration
        return message

    async def close(self) -> None:
        await self._queue.put(None)

    async def send(self, _message: str) -> None:
        return None


def stub_realtime_upstream(
    monkeypatch,
    *,
    close_immediately: bool = False,
    connect_delay_seconds: float = 0.0,
    session_update_delay_seconds: float = 0.0,
    prompt_sink: list[str] | None = None,
    model_sink: list[str] | None = None,
) -> None:
    from app.services.realtime_bridge import SessionState

    async def fake_connect_upstream(self) -> None:
        if connect_delay_seconds:
            await asyncio.sleep(connect_delay_seconds)
        if model_sink is not None:
            model_sink.append(getattr(self, "upstream_model", ""))
        self._upstream_ws = DummyRealtimeUpstream(close_immediately=close_immediately)

    async def fake_send_session_update(self, _system_prompt: str) -> None:
        if prompt_sink is not None:
            prompt_sink.append(_system_prompt)
        if session_update_delay_seconds:
            await asyncio.sleep(session_update_delay_seconds)
        self.state = SessionState.READY

    monkeypatch.setattr("app.services.realtime_bridge.RealtimeSession.connect_upstream", fake_connect_upstream)
    monkeypatch.setattr("app.services.realtime_bridge.RealtimeSession.send_session_update", fake_send_session_update)
    monkeypatch.setattr("app.services.realtime_bridge.RealtimeSession.send_initial_session_update", fake_send_session_update)


def test_auth_cookie_and_me() -> None:
    client = TestClient(main_module.app)
    code = issue_verification_code(client, "u1@example.com", "register")
    resp = client.post(
        "/api/v1/auth/register",
        json={
            "email": "u1@example.com",
            "password": "pass1234pass",
            "display_name": "U1",
            "code": code,
        },
        headers=public_headers(),
    )
    assert resp.status_code == 200
    assert "access_token" in resp.cookies
    assert resp.json()["access_token_expires_in_seconds"] == config_module.settings.jwt_expire_minutes * 60

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    data = me.json()
    assert data["email"] == "u1@example.com"


def test_logout_revokes_stolen_access_token() -> None:
    client = TestClient(main_module.app)
    register_user(client, "logout@example.com", "Logout User")

    access_token = client.cookies.get(config_module.settings.access_cookie_name)
    assert access_token

    shadow = TestClient(main_module.app)
    shadow.cookies.set(config_module.settings.access_cookie_name, access_token)
    assert shadow.get("/api/v1/auth/me").status_code == 200

    logout = client.post("/api/v1/auth/logout", headers=csrf_headers(client))
    assert logout.status_code == 200

    denied = shadow.get("/api/v1/auth/me")
    assert denied.status_code == 401


def test_reset_password_revokes_existing_sessions() -> None:
    client = TestClient(main_module.app)
    register_user(client, "reset@example.com", "Reset User")

    access_token = client.cookies.get(config_module.settings.access_cookie_name)
    assert access_token

    shadow = TestClient(main_module.app)
    shadow.cookies.set(config_module.settings.access_cookie_name, access_token)
    assert shadow.get("/api/v1/auth/me").status_code == 200

    code = issue_verification_code(client, "reset@example.com", "reset")
    reset = client.post(
        "/api/v1/auth/reset-password",
        json={"email": "reset@example.com", "password": "newpass1234pass", "code": code},
        headers=public_headers(),
    )
    assert reset.status_code == 200

    denied = shadow.get("/api/v1/auth/me")
    assert denied.status_code == 401

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "reset@example.com", "password": "newpass1234pass"},
        headers=public_headers(),
    )
    assert login.status_code == 200


def test_realtime_websocket_auth_uses_cookie_and_rejects_revoked_token() -> None:
    client = TestClient(main_module.app)
    register_user(client, "realtime-revoked@example.com", "Realtime Revoked")

    access_token = client.cookies.get(config_module.settings.access_cookie_name)
    assert access_token

    shadow = TestClient(main_module.app)
    shadow.cookies.set(config_module.settings.access_cookie_name, access_token)

    logout = client.post("/api/v1/auth/logout", headers=csrf_headers(client))
    assert logout.status_code == 200

    with shadow.websocket_connect("/api/v1/realtime/voice", headers=public_headers()) as websocket:
        message = websocket.receive_json()
        assert message["type"] == "error"
        assert message["code"] == "unauthorized"


def test_realtime_websocket_enforces_conversation_access(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")
    stub_realtime_upstream(monkeypatch)

    owner = TestClient(main_module.app)
    owner_info = register_user(owner, "realtime-owner@example.com", "Realtime Owner")
    workspace_id = owner_info["workspace"]["id"]
    owner_user_id = owner_info["user"]["id"]
    project = create_project(owner, "Realtime Project")
    conversation_id = create_conversation_record(workspace_id, project["id"], owner_user_id, "Owner Voice")

    viewer = TestClient(main_module.app)
    register_user(viewer, "realtime-viewer@example.com", "Realtime Viewer")
    add_workspace_membership(workspace_id, "realtime-viewer@example.com", "viewer")

    with owner.websocket_connect("/api/v1/realtime/voice", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "conversation_id": conversation_id,
                "project_id": project["id"],
                "workspace_id": "ignored-by-server",
            }
        )
        ready = websocket.receive_json()
        assert ready["type"] == "session.ready"
        websocket.send_json({"type": "session.end"})

    with viewer.websocket_connect("/api/v1/realtime/voice", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "conversation_id": conversation_id,
                "project_id": project["id"],
                "workspace_id": workspace_id,
            }
        )
        denied = websocket.receive_json()
        assert denied["type"] == "error"
        assert denied["code"] == "forbidden"


def test_realtime_websocket_ends_after_token_revocation(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")
    stub_realtime_upstream(monkeypatch)
    monkeypatch.setattr(realtime_router, "SESSION_MONITOR_INTERVAL_SECONDS", 0.01)

    client = TestClient(main_module.app)
    user_info = register_user(client, "realtime-live-revoke@example.com", "Realtime Live Revoke")
    project = create_project(client, "Realtime Revoke Project")
    conversation_id = create_conversation_record(
        user_info["workspace"]["id"],
        project["id"],
        user_info["user"]["id"],
        "Live Revoke",
    )

    with client.websocket_connect("/api/v1/realtime/voice", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "conversation_id": conversation_id,
                "project_id": project["id"],
                "workspace_id": user_info["workspace"]["id"],
            }
        )
        ready = websocket.receive_json()
        assert ready["type"] == "session.ready"

        revoke_user_tokens(user_info["user"]["id"])

        ended = websocket.receive_json()
        assert ended["type"] == "session.end"
        assert ended["reason"] == "auth_revoked"
        with pytest.raises(WebSocketDisconnect):
            websocket.receive_json()


def test_realtime_websocket_closes_when_upstream_disconnects(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")
    stub_realtime_upstream(monkeypatch, close_immediately=True)

    client = TestClient(main_module.app)
    user_info = register_user(client, "realtime-upstream-drop@example.com", "Realtime Upstream Drop")
    project = create_project(client, "Realtime Upstream Project")
    conversation_id = create_conversation_record(
        user_info["workspace"]["id"],
        project["id"],
        user_info["user"]["id"],
        "Upstream Drop",
    )

    with client.websocket_connect("/api/v1/realtime/voice", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "conversation_id": conversation_id,
                "project_id": project["id"],
            }
        )
        ready = websocket.receive_json()
        assert ready["type"] == "session.ready"

        error = websocket.receive_json()
        assert error["type"] == "error"
        assert error["code"] == "upstream_disconnected"

        with pytest.raises(WebSocketDisconnect):
            websocket.receive_json()


def test_realtime_websocket_times_out_during_upstream_setup(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")
    stub_realtime_upstream(monkeypatch, connect_delay_seconds=0.05)
    monkeypatch.setattr(realtime_router, "UPSTREAM_CONNECT_TIMEOUT_SECONDS", 0.01)

    client = TestClient(main_module.app)
    user_info = register_user(client, "realtime-timeout@example.com", "Realtime Timeout")
    project = create_project(client, "Realtime Timeout Project")
    conversation_id = create_conversation_record(
        user_info["workspace"]["id"],
        project["id"],
        user_info["user"]["id"],
        "Timeout",
    )

    with client.websocket_connect("/api/v1/realtime/voice", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "conversation_id": conversation_id,
                "project_id": project["id"],
            }
        )
        error = websocket.receive_json()
        assert error["type"] == "error"
        assert error["code"] == "upstream_timeout"


def test_realtime_websocket_initial_prompt_includes_recent_history(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")
    prompt_sink: list[str] = []
    stub_realtime_upstream(monkeypatch, prompt_sink=prompt_sink)

    client = TestClient(main_module.app)
    user_info = register_user(client, "realtime-history@example.com", "Realtime History")
    workspace_id = user_info["workspace"]["id"]
    project = create_project(client, "Realtime History Project")
    conversation_id = create_conversation_record(
        workspace_id,
        project["id"],
        user_info["user"]["id"],
        "History Conversation",
    )

    with SessionLocal() as db:
        db.add(Message(conversation_id=conversation_id, role="user", content="第一条历史消息"))
        db.add(Message(conversation_id=conversation_id, role="assistant", content="第一条历史回复"))
        db.commit()

    with client.websocket_connect("/api/v1/realtime/voice", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "conversation_id": conversation_id,
                "project_id": project["id"],
            }
        )
        ready = websocket.receive_json()
        assert ready["type"] == "session.ready"
        websocket.send_json({"type": "session.end"})

    assert prompt_sink
    assert "最近对话历史" in prompt_sink[0]
    assert "第一条历史消息" in prompt_sink[0]
    assert "第一条历史回复" in prompt_sink[0]


def test_realtime_websocket_prefers_project_realtime_model_when_configured(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")
    model_sink: list[str] = []
    stub_realtime_upstream(monkeypatch, model_sink=model_sink)

    client = TestClient(main_module.app)
    user_info = register_user(client, "realtime-omni@example.com", "Realtime Omni")
    project = create_project(client, "Realtime Omni Project")

    update = client.patch(
        "/api/v1/pipeline",
        json={
            "project_id": project["id"],
            "model_type": "realtime",
            "model_id": "qwen3-omni-flash-realtime",
            "config_json": {},
        },
        headers=csrf_headers(client),
    )
    assert update.status_code == 200

    conversation_id = create_conversation_record(
        user_info["workspace"]["id"],
        project["id"],
        user_info["user"]["id"],
        "Realtime Omni Conversation",
    )

    with client.websocket_connect("/api/v1/realtime/voice", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "conversation_id": conversation_id,
                "project_id": project["id"],
            }
        )
        ready = websocket.receive_json()
        assert ready["type"] == "session.ready"
        websocket.send_json({"type": "session.end"})

    assert model_sink == ["qwen3-omni-flash-realtime"]


def test_composed_realtime_websocket_runs_synthetic_pipeline(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")
    persisted_turns: list[tuple[str, str]] = []

    async def fake_orchestrate(
        _db,
        *,
        workspace_id: str,
        project_id: str,
        conversation_id: str,
        user_text: str,
        image_bytes: bytes | None = None,
        image_mime_type: str = "image/jpeg",
        video_bytes: bytes | None = None,
        video_mime_type: str = "video/mp4",
    ) -> dict[str, str]:
        assert workspace_id
        assert project_id
        assert conversation_id
        assert user_text == "你好"
        assert image_bytes is None
        assert video_bytes is None
        _ = image_mime_type
        _ = video_mime_type
        return {"text_input": "你好", "text_response": "你好，我在。"}

    async def fake_tts(_db, *, project_id: str, text: str) -> bytes:
        assert project_id
        assert text == "你好，我在。"
        return b"fake-mp3"

    async def fake_persist(_session, user_text: str, ai_text: str) -> None:
        persisted_turns.append((user_text, ai_text))

    class FakeRealtimeBridge:
        def __init__(self, model: str) -> None:
            self.model = model
            self.events: asyncio.Queue[dict[str, str]] = asyncio.Queue()

        async def connect(self) -> None:
            return None

        async def send_audio_chunk(self, audio_bytes: bytes) -> None:
            assert audio_bytes == b"pcm-turn"

        async def commit(self) -> None:
            await self.events.put({"type": "transcript.final", "text": "你好"})

        async def next_event(self) -> dict[str, str]:
            return await self.events.get()

        async def close(self) -> None:
            return None

    monkeypatch.setattr(realtime_router, "RealtimeTranscriptionBridge", FakeRealtimeBridge)
    monkeypatch.setattr("app.services.composed_realtime.orchestrate_synthetic_realtime_turn_from_text", fake_orchestrate)
    monkeypatch.setattr("app.services.composed_realtime.synthesize_realtime_speech_for_project", fake_tts)
    monkeypatch.setattr("app.routers.realtime._persist_composed_turn", fake_persist)

    client = TestClient(main_module.app)
    register_user(client, "synthetic-realtime@example.com", "Synthetic Realtime")
    project = create_project(client, "Synthetic Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Synthetic Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    with client.websocket_connect("/api/v1/realtime/composed-voice", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "project_id": project["id"],
                "conversation_id": conversation_id,
            }
        )
        ready = websocket.receive_json()
        assert ready["type"] == "session.ready"

        websocket.send_bytes(b"pcm-turn")
        websocket.send_json({"type": "audio.stop"})

        transcript = websocket.receive_json()
        assert transcript == {"type": "transcript.final", "text": "你好"}

        assistant_chunk = websocket.receive_json()
        assert assistant_chunk == {"type": "response.text", "text": "你好，我在。"}

        audio_meta = websocket.receive_json()
        assert audio_meta["type"] == "audio.meta"

        audio = websocket.receive_bytes()
        assert audio == b"fake-mp3"

        done = websocket.receive_json()
        assert done["type"] == "response.done"

    assert persisted_turns == [("你好", "你好，我在。")]


def test_composed_realtime_websocket_keeps_session_open_on_turn_failure(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")
    async def fake_orchestrate(
        _db,
        *,
        workspace_id: str,
        project_id: str,
        conversation_id: str,
        user_text: str,
        image_bytes: bytes | None = None,
        image_mime_type: str = "image/jpeg",
        video_bytes: bytes | None = None,
        video_mime_type: str = "video/mp4",
    ) -> dict[str, str]:
        assert workspace_id
        assert project_id
        assert conversation_id
        assert user_text == "你好"
        _ = image_bytes
        _ = image_mime_type
        _ = video_bytes
        _ = video_mime_type
        raise realtime_router.UpstreamServiceError("boom")

    class FakeRealtimeBridge:
        def __init__(self, model: str) -> None:
            self.model = model
            self.events: asyncio.Queue[dict[str, str]] = asyncio.Queue()

        async def connect(self) -> None:
            return None

        async def send_audio_chunk(self, audio_bytes: bytes) -> None:
            assert audio_bytes == b"pcm-turn"

        async def commit(self) -> None:
            await self.events.put({"type": "transcript.final", "text": "你好"})

        async def next_event(self) -> dict[str, str]:
            return await self.events.get()

        async def close(self) -> None:
            return None

    monkeypatch.setattr(realtime_router, "RealtimeTranscriptionBridge", FakeRealtimeBridge)
    monkeypatch.setattr("app.services.composed_realtime.orchestrate_synthetic_realtime_turn_from_text", fake_orchestrate)

    client = TestClient(main_module.app)
    register_user(client, "synthetic-turn-error@example.com", "Synthetic Turn Error")
    project = create_project(client, "Synthetic Turn Error Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Synthetic Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    with client.websocket_connect("/api/v1/realtime/composed-voice", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "project_id": project["id"],
                "conversation_id": conversation_id,
            }
        )
        ready = websocket.receive_json()
        assert ready["type"] == "session.ready"

        websocket.send_bytes(b"pcm-turn")
        websocket.send_json({"type": "audio.stop"})

        transcript = websocket.receive_json()
        assert transcript == {"type": "transcript.final", "text": "你好"}

        turn_error = websocket.receive_json()
        assert turn_error == {
            "type": "turn.error",
            "code": "upstream_unavailable",
            "message": "AI 暂时无响应，请重试",
        }

        websocket.send_json({"type": "session.end"})
        with pytest.raises(WebSocketDisconnect):
            websocket.receive_json()


def test_realtime_dictate_websocket_streams_partial_and_final_transcripts(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")

    class FakeRealtimeBridge:
        def __init__(self, model: str) -> None:
            assert model == "qwen3-asr-flash-realtime"
            self.events: asyncio.Queue[dict[str, str]] = asyncio.Queue()

        async def connect(self) -> None:
            return None

        async def send_audio_chunk(self, audio_bytes: bytes) -> None:
            assert audio_bytes == b"pcm-turn"
            await self.events.put({"type": "transcript.partial", "text": "你"})

        async def commit(self) -> None:
            await self.events.put({"type": "transcript.final", "text": "你好世界"})

        async def next_event(self) -> dict[str, str]:
            return await self.events.get()

        async def close(self) -> None:
            return None

    monkeypatch.setattr(realtime_router, "RealtimeTranscriptionBridge", FakeRealtimeBridge)

    client = TestClient(main_module.app)
    register_user(client, "realtime-dictate@example.com", "Realtime Dictate")
    project = create_project(client, "Realtime Dictate Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Realtime Dictate Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    with client.websocket_connect("/api/v1/realtime/dictate", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "project_id": project["id"],
                "conversation_id": conversation_id,
            }
        )

        ready = websocket.receive_json()
        assert ready == {"type": "session.ready"}

        websocket.send_bytes(b"pcm-turn")
        partial = websocket.receive_json()
        assert partial == {"type": "transcript.partial", "text": "你"}

        websocket.send_json({"type": "audio.stop"})
        final = websocket.receive_json()
        assert final == {"type": "transcript.final", "text": "你好世界"}

        websocket.send_json({"type": "session.end"})
        with pytest.raises(WebSocketDisconnect):
            websocket.receive_json()


def test_realtime_dictate_websocket_surfaces_upstream_connect_failure(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")

    class FakeRealtimeBridge:
        def __init__(self, model: str) -> None:
            assert model == "qwen3-asr-flash-realtime"

        async def connect(self) -> None:
            raise realtime_router.UpstreamServiceError("boom")

        async def close(self) -> None:
            return None

    monkeypatch.setattr(realtime_router, "RealtimeTranscriptionBridge", FakeRealtimeBridge)

    client = TestClient(main_module.app)
    register_user(client, "realtime-dictate-upstream@example.com", "Realtime Dictate Upstream")
    project = create_project(client, "Realtime Dictate Upstream Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Realtime Dictate Failure Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    with client.websocket_connect("/api/v1/realtime/dictate", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "project_id": project["id"],
                "conversation_id": conversation_id,
            }
        )

        ready = websocket.receive_json()
        assert ready == {"type": "session.ready"}

        websocket.send_bytes(b"pcm-turn")
        error = websocket.receive_json()
        assert error == {
            "type": "error",
            "code": "upstream_unavailable",
            "message": "AI 暂时无响应，请重试",
        }

        with pytest.raises(WebSocketDisconnect):
            websocket.receive_json()


def test_composed_realtime_websocket_falls_back_to_text_when_tts_fails(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")
    async def fake_orchestrate(
        _db,
        *,
        workspace_id: str,
        project_id: str,
        conversation_id: str,
        user_text: str,
        image_bytes: bytes | None = None,
        image_mime_type: str = "image/jpeg",
        video_bytes: bytes | None = None,
        video_mime_type: str = "video/mp4",
    ) -> dict[str, str]:
        assert workspace_id
        assert project_id
        assert conversation_id
        assert user_text == "你好"
        _ = image_bytes
        _ = image_mime_type
        _ = video_bytes
        _ = video_mime_type
        return {"text_input": "你好", "text_response": "这次先看文字。"}

    async def fake_tts(_db, *, project_id: str, text: str) -> bytes:
        assert project_id
        assert text == "这次先看文字。"
        raise realtime_router.UpstreamServiceError("tts boom")

    class FakeRealtimeBridge:
        def __init__(self, model: str) -> None:
            self.model = model
            self.events: asyncio.Queue[dict[str, str]] = asyncio.Queue()

        async def connect(self) -> None:
            return None

        async def send_audio_chunk(self, audio_bytes: bytes) -> None:
            assert audio_bytes == b"pcm-turn"

        async def commit(self) -> None:
            await self.events.put({"type": "transcript.final", "text": "你好"})

        async def next_event(self) -> dict[str, str]:
            return await self.events.get()

        async def close(self) -> None:
            return None

    monkeypatch.setattr(realtime_router, "RealtimeTranscriptionBridge", FakeRealtimeBridge)
    monkeypatch.setattr("app.services.composed_realtime.orchestrate_synthetic_realtime_turn_from_text", fake_orchestrate)
    monkeypatch.setattr("app.services.composed_realtime.synthesize_realtime_speech_for_project", fake_tts)

    client = TestClient(main_module.app)
    register_user(client, "synthetic-tts-fallback@example.com", "Synthetic TTS Fallback")
    project = create_project(client, "Synthetic TTS Fallback Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Synthetic Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    with client.websocket_connect("/api/v1/realtime/composed-voice", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "project_id": project["id"],
                "conversation_id": conversation_id,
            }
        )
        ready = websocket.receive_json()
        assert ready["type"] == "session.ready"

        websocket.send_bytes(b"pcm-turn")
        websocket.send_json({"type": "audio.stop"})

        transcript = websocket.receive_json()
        assert transcript == {"type": "transcript.final", "text": "你好"}

        assistant_chunk = websocket.receive_json()
        assert assistant_chunk == {"type": "response.text", "text": "这次先看文字。"}

        done = websocket.receive_json()
        assert done == {"type": "response.done"}

        notice = websocket.receive_json()
        assert notice == {
            "type": "turn.notice",
            "code": "audio_unavailable",
            "message": "语音输出暂时不可用，已切换为文字回复",
        }

        websocket.send_json({"type": "session.end"})
        with pytest.raises(WebSocketDisconnect):
            websocket.receive_json()


def test_composed_realtime_websocket_streams_partial_transcript_before_turn_completion(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")

    async def fake_orchestrate(
        _db,
        *,
        workspace_id: str,
        project_id: str,
        conversation_id: str,
        user_text: str,
        image_bytes: bytes | None = None,
        image_mime_type: str = "image/jpeg",
        video_bytes: bytes | None = None,
        video_mime_type: str = "video/mp4",
    ) -> dict[str, str]:
        assert workspace_id
        assert project_id
        assert conversation_id
        assert user_text == "你好"
        _ = image_bytes
        _ = image_mime_type
        _ = video_bytes
        _ = video_mime_type
        return {"text_input": "你好", "text_response": "我收到了。"}

    async def fake_tts(_db, *, project_id: str, text: str) -> bytes:
        assert project_id
        assert text == "我收到了。"
        return b""

    class FakeRealtimeBridge:
        def __init__(self, model: str) -> None:
            self.model = model
            self.events: asyncio.Queue[dict[str, str]] = asyncio.Queue()

        async def connect(self) -> None:
            return None

        async def send_audio_chunk(self, audio_bytes: bytes) -> None:
            assert audio_bytes == b"pcm-turn"
            await self.events.put({"type": "transcript.partial", "text": "你"})

        async def commit(self) -> None:
            await self.events.put({"type": "transcript.final", "text": "你好"})

        async def next_event(self) -> dict[str, str]:
            return await self.events.get()

        async def close(self) -> None:
            return None

    monkeypatch.setattr(realtime_router, "RealtimeTranscriptionBridge", FakeRealtimeBridge)
    monkeypatch.setattr("app.services.composed_realtime.orchestrate_synthetic_realtime_turn_from_text", fake_orchestrate)
    monkeypatch.setattr("app.services.composed_realtime.synthesize_realtime_speech_for_project", fake_tts)

    client = TestClient(main_module.app)
    register_user(client, "synthetic-partial@example.com", "Synthetic Partial")
    project = create_project(client, "Synthetic Partial Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Synthetic Partial Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    with client.websocket_connect("/api/v1/realtime/composed-voice", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "project_id": project["id"],
                "conversation_id": conversation_id,
            }
        )
        ready = websocket.receive_json()
        assert ready["type"] == "session.ready"

        websocket.send_bytes(b"pcm-turn")
        partial = websocket.receive_json()
        assert partial == {"type": "transcript.partial", "text": "你"}

        websocket.send_json({"type": "audio.stop"})
        final = websocket.receive_json()
        assert final == {"type": "transcript.final", "text": "你好"}

        assistant_chunk = websocket.receive_json()
        assert assistant_chunk == {"type": "response.text", "text": "我收到了。"}

        done = websocket.receive_json()
        assert done == {"type": "response.done"}

        websocket.send_json({"type": "session.end"})
        with pytest.raises(WebSocketDisconnect):
            websocket.receive_json()


def test_composed_realtime_media_is_cleared_after_turn_starts(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")
    async def fake_orchestrate(
        _db,
        *,
        workspace_id: str,
        project_id: str,
        conversation_id: str,
        user_text: str,
        image_bytes: bytes | None = None,
        image_mime_type: str = "image/jpeg",
        video_bytes: bytes | None = None,
        video_mime_type: str = "video/mp4",
    ) -> dict[str, str]:
        assert workspace_id
        assert project_id
        assert conversation_id
        assert user_text == "看图"
        assert image_bytes is not None
        assert image_mime_type == "image/jpeg"
        assert video_bytes is None
        _ = video_mime_type
        return {"text_input": "看图", "text_response": "已看到图片。"}

    async def fake_tts(_db, *, project_id: str, text: str) -> bytes:
        assert project_id
        assert text == "已看到图片。"
        return b"fake-mp3"

    async def fake_persist(_session, user_text: str, ai_text: str) -> None:
        assert user_text == "看图"
        assert ai_text == "已看到图片。"

    class FakeRealtimeBridge:
        def __init__(self, model: str) -> None:
            self.model = model
            self.events: asyncio.Queue[dict[str, str]] = asyncio.Queue()

        async def connect(self) -> None:
            return None

        async def send_audio_chunk(self, audio_bytes: bytes) -> None:
            assert audio_bytes == b"pcm-turn"

        async def commit(self) -> None:
            await self.events.put({"type": "transcript.final", "text": "看图"})

        async def next_event(self) -> dict[str, str]:
            return await self.events.get()

        async def close(self) -> None:
            return None

    monkeypatch.setattr(realtime_router, "RealtimeTranscriptionBridge", FakeRealtimeBridge)
    monkeypatch.setattr("app.services.composed_realtime.orchestrate_synthetic_realtime_turn_from_text", fake_orchestrate)
    monkeypatch.setattr("app.services.composed_realtime.synthesize_realtime_speech_for_project", fake_tts)
    monkeypatch.setattr("app.routers.realtime._persist_composed_turn", fake_persist)

    client = TestClient(main_module.app)
    register_user(client, "synthetic-clear@example.com", "Synthetic Clear")
    project = create_project(client, "Synthetic Clear Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Synthetic Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]
    image_bytes, _ = upload_fixture("frame.jpg")
    image_payload = f"data:image/jpeg;base64,{base64.b64encode(image_bytes).decode()}"

    with client.websocket_connect("/api/v1/realtime/composed-voice", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "project_id": project["id"],
                "conversation_id": conversation_id,
            }
        )
        ready = websocket.receive_json()
        assert ready["type"] == "session.ready"

        websocket.send_json({"type": "media.set", "data_url": image_payload, "filename": "frame.jpg"})
        attached = websocket.receive_json()
        assert attached["type"] == "media.attached"

        websocket.send_bytes(b"pcm-turn")
        websocket.send_json({"type": "audio.stop"})

        transcript = websocket.receive_json()
        assert transcript == {"type": "transcript.final", "text": "看图"}

        cleared = websocket.receive_json()
        assert cleared == {"type": "media.cleared"}


def test_composed_realtime_media_set_rejects_oversized_payload(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")
    monkeypatch.setattr(realtime_router.settings, "realtime_media_max_mb", 0)

    client = TestClient(main_module.app)
    register_user(client, "synthetic-large@example.com", "Synthetic Large")
    project = create_project(client, "Synthetic Large Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Synthetic Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200

    image_bytes, _ = upload_fixture("frame.jpg")
    image_payload = f"data:image/jpeg;base64,{base64.b64encode(image_bytes).decode()}"

    with client.websocket_connect("/api/v1/realtime/composed-voice", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "project_id": project["id"],
                "conversation_id": conversation.json()["id"],
            }
        )
        assert websocket.receive_json()["type"] == "session.ready"

        websocket.send_json({"type": "media.set", "data_url": image_payload, "filename": "frame.jpg"})
        error = websocket.receive_json()
        assert error["type"] == "error"
        assert error["code"] == "payload_too_large"


def test_composed_realtime_media_set_rejects_signature_mismatch(monkeypatch) -> None:
    monkeypatch.setattr(realtime_router.settings, "dashscope_api_key", "test-key")
    client = TestClient(main_module.app)
    register_user(client, "synthetic-mismatch@example.com", "Synthetic Mismatch")
    project = create_project(client, "Synthetic Mismatch Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Synthetic Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200

    bad_payload = f"data:image/jpeg;base64,{base64.b64encode(b'<html>not-a-jpeg</html>').decode()}"

    with client.websocket_connect("/api/v1/realtime/composed-voice", headers=public_headers()) as websocket:
        websocket.send_json(
            {
                "type": "session.start",
                "project_id": project["id"],
                "conversation_id": conversation.json()["id"],
            }
        )
        assert websocket.receive_json()["type"] == "session.ready"

        websocket.send_json({"type": "media.set", "data_url": bad_payload, "filename": "frame.jpg"})
        error = websocket.receive_json()
        assert error["type"] == "error"
        assert error["code"] == "upload_mismatch"


def test_pipeline_patch_downgrades_synthetic_default_when_llm_loses_vision() -> None:
    client = TestClient(main_module.app)
    register_user(client, "pipeline-vision-downgrade@example.com", "Pipeline Vision Downgrade")
    project = create_project(client, "Pipeline Vision Downgrade Project")

    set_mode = client.patch(
        f"/api/v1/projects/{project['id']}",
        json={"default_chat_mode": "synthetic_realtime"},
        headers=csrf_headers(client),
    )
    assert set_mode.status_code == 200
    assert set_mode.json()["default_chat_mode"] == "synthetic_realtime"

    update_llm = client.patch(
        "/api/v1/pipeline",
        json={
          "project_id": project["id"],
          "model_type": "llm",
          "model_id": "deepseek-r1",
          "config_json": {},
        },
        headers=csrf_headers(client),
    )
    assert update_llm.status_code == 200

    refreshed = client.get(f"/api/v1/projects/{project['id']}")
    assert refreshed.status_code == 200
    assert refreshed.json()["default_chat_mode"] == "standard"


def test_reset_code_survives_incorrect_attempt() -> None:
    client = TestClient(main_module.app)
    register_user(client, "reset-code@example.com", "Reset Code")

    code = issue_verification_code(client, "reset-code@example.com", "reset")
    wrong = client.post(
        "/api/v1/auth/reset-password",
        json={"email": "reset-code@example.com", "password": "newpass1234pass", "code": "000000"},
        headers=public_headers(),
    )
    assert wrong.status_code == 400
    assert runtime_state.get_json("verify_code", verification_code_key("reset-code@example.com", "reset")) is not None

    correct = client.post(
        "/api/v1/auth/reset-password",
        json={"email": "reset-code@example.com", "password": "newpass1234pass", "code": code},
        headers=public_headers(),
    )
    assert correct.status_code == 200
    assert runtime_state.get_json("verify_code", verification_code_key("reset-code@example.com", "reset")) is None


def test_login_uses_dummy_verifier_for_missing_users(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "login-existing@example.com", "Login Existing")

    verifier_inputs: list[str | None] = []

    def fake_verify_password_or_dummy(password: str, hashed_password: str | None) -> bool:
        verifier_inputs.append(hashed_password)
        return False

    monkeypatch.setattr(auth_router, "verify_password_or_dummy", fake_verify_password_or_dummy)

    missing = client.post(
        "/api/v1/auth/login",
        json={"email": "missing-login@example.com", "password": "badpass12345"},
        headers=public_headers(),
    )
    existing = client.post(
        "/api/v1/auth/login",
        json={"email": "login-existing@example.com", "password": "badpass12345"},
        headers=public_headers(),
    )

    assert missing.status_code == 401
    assert existing.status_code == 401
    assert verifier_inputs[0] is None
    assert isinstance(verifier_inputs[1], str) and verifier_inputs[1]


def test_unauthorized_error_shape() -> None:
    client = TestClient(main_module.app)
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 401
    err = resp.json()["error"]
    assert err["code"] == "unauthorized"
    assert isinstance(err["request_id"], str)
    assert err["request_id"]


def test_local_loopback_origins_are_allowed_for_auth() -> None:
    client = TestClient(main_module.app)
    resp = client.post(
        "/api/v1/auth/send-code",
        json={"email": "loopback@example.com", "purpose": "register"},
        headers={"origin": "http://127.0.0.1:3102"},
    )
    assert resp.status_code == 200

    blocked = client.post(
        "/api/v1/auth/send-code",
        json={"email": "blocked@example.com", "purpose": "register"},
        headers={"origin": "http://evil.example"},
    )
    assert blocked.status_code == 403


def test_workspace_rbac_forbidden() -> None:
    owner = TestClient(main_module.app)
    owner_info = register_user(owner, "owner@example.com", "Owner")
    owner_workspace_id = owner_info["workspace"]["id"]

    p1 = owner.post(
        "/api/v1/projects",
        json={"name": "P1", "description": "demo"},
        headers=csrf_headers(owner),
    )
    assert p1.status_code == 200

    other = TestClient(main_module.app)
    register_user(other, "other@example.com", "Other")

    resp = other.get("/api/v1/projects", headers={"x-workspace-id": owner_workspace_id})
    assert resp.status_code == 403


def test_workspace_header_is_required_when_user_has_multiple_workspaces() -> None:
    client = TestClient(main_module.app)
    user_info = register_user(client, "multi-workspace@example.com", "Multi Workspace")
    user_id = user_info["user"]["id"]

    with SessionLocal() as db:
        second_workspace = Workspace(name="Second Workspace", plan="free")
        db.add(second_workspace)
        db.flush()
        db.add(Membership(workspace_id=second_workspace.id, user_id=user_id, role="owner"))
        db.commit()
        second_workspace_id = second_workspace.id

    create_second = client.post(
        "/api/v1/projects",
        json={"name": "Workspace B Project", "description": "demo"},
        headers=csrf_headers(client, second_workspace_id),
    )
    assert create_second.status_code == 200

    ambiguous = client.get("/api/v1/projects", headers=public_headers())
    assert ambiguous.status_code == 409
    assert ambiguous.json()["error"]["code"] == "workspace_required"


def test_conversation_access_respects_role_and_creator_boundary(monkeypatch) -> None:
    monkeypatch.setattr(chat_router.settings, "dashscope_api_key", "test-key")
    async def fake_orchestrate_inference(*args, **kwargs):
        return "mocked reply"
    monkeypatch.setattr(chat_router, "orchestrate_inference", fake_orchestrate_inference)
    owner = TestClient(main_module.app)
    owner_info = register_user(owner, "owner-boundary@example.com", "Owner Boundary")
    owner_workspace_id = owner_info["workspace"]["id"]
    project = create_project(owner, "Boundary Project")

    owner_conversation = owner.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Owner Thread"},
        headers=csrf_headers(owner),
    )
    assert owner_conversation.status_code == 200
    owner_conversation_id = owner_conversation.json()["id"]

    editor = TestClient(main_module.app)
    register_user(editor, "editor-boundary@example.com", "Editor Boundary")
    add_workspace_membership(owner_workspace_id, "editor-boundary@example.com", "editor")

    viewer = TestClient(main_module.app)
    register_user(viewer, "viewer-boundary@example.com", "Viewer Boundary")
    viewer_user_id = add_workspace_membership(owner_workspace_id, "viewer-boundary@example.com", "viewer")

    editor_conversation = editor.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Editor Thread"},
        headers=csrf_headers(editor, owner_workspace_id),
    )
    assert editor_conversation.status_code == 200
    editor_conversation_id = editor_conversation.json()["id"]

    viewer_conversation_id = create_conversation_record(
        owner_workspace_id,
        project["id"],
        viewer_user_id,
        "Viewer Thread",
    )

    viewer_list = viewer.get(
        f"/api/v1/chat/conversations?project_id={project['id']}",
        headers={"x-workspace-id": owner_workspace_id},
    )
    assert viewer_list.status_code == 200
    assert [item["id"] for item in viewer_list.json()] == [viewer_conversation_id]

    viewer_create = viewer.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Viewer Create"},
        headers=csrf_headers(viewer, owner_workspace_id),
    )
    assert viewer_create.status_code == 403

    viewer_write = viewer.post(
        f"/api/v1/chat/conversations/{viewer_conversation_id}/messages",
        json={"content": "viewer cannot write"},
        headers=csrf_headers(viewer, owner_workspace_id),
    )
    assert viewer_write.status_code == 403

    viewer_owner_access = viewer.get(
        f"/api/v1/chat/conversations/{owner_conversation_id}/messages",
        headers={"x-workspace-id": owner_workspace_id},
    )
    assert viewer_owner_access.status_code == 404

    editor_owner_access = editor.get(
        f"/api/v1/chat/conversations/{owner_conversation_id}/messages",
        headers={"x-workspace-id": owner_workspace_id},
    )
    assert editor_owner_access.status_code == 404

    editor_send = editor.post(
        f"/api/v1/chat/conversations/{editor_conversation_id}/messages",
        json={"content": "editor can write"},
        headers=csrf_headers(editor, owner_workspace_id),
    )
    assert editor_send.status_code == 200

    owner_view = owner.get(
        f"/api/v1/chat/conversations/{viewer_conversation_id}/messages",
        headers={"x-workspace-id": owner_workspace_id},
    )
    assert owner_view.status_code == 200


def test_viewer_role_is_read_only_across_workspace_mutations() -> None:
    owner = TestClient(main_module.app)
    owner_info = register_user(owner, "viewer-authz-owner@example.com", "Viewer Authz Owner")
    owner_workspace_id = owner_info["workspace"]["id"]
    project = create_project(owner, "Viewer Authz Project")
    dataset = create_dataset(owner, project["id"], "Viewer Authz Dataset")
    upload_item(owner, dataset["id"], "viewer-authz.jpg")
    version = commit_dataset(owner, dataset["id"], "seed dataset")

    model_resp = owner.post(
        "/api/v1/models",
        json={"project_id": project["id"], "name": "Viewer Authz Model", "task_type": "general"},
        headers=csrf_headers(owner),
    )
    assert model_resp.status_code == 200
    model_id = model_resp.json()["model"]["id"]

    viewer = TestClient(main_module.app)
    register_user(viewer, "viewer-authz@example.com", "Viewer Authz")
    add_workspace_membership(owner_workspace_id, "viewer-authz@example.com", "viewer")
    viewer_headers = csrf_headers(viewer, owner_workspace_id)

    responses = [
        viewer.patch(
            f"/api/v1/projects/{project['id']}",
            json={"name": "Blocked Rename"},
            headers=viewer_headers,
        ),
        viewer.post(
            "/api/v1/datasets",
            json={"project_id": project["id"], "name": "Blocked Dataset", "type": "images"},
            headers=viewer_headers,
        ),
        viewer.patch(
            "/api/v1/pipeline",
            json={"project_id": project["id"], "model_type": "llm", "model_id": "qwen3.5-plus", "config_json": {}},
            headers=viewer_headers,
        ),
        viewer.post(
            "/api/v1/uploads/presign",
            json={
                "dataset_id": dataset["id"],
                "filename": "blocked.jpg",
                "media_type": "image/jpeg",
                "size_bytes": 16,
            },
            headers=viewer_headers,
        ),
        viewer.post(
            "/api/v1/models",
            json={"project_id": project["id"], "name": "Blocked Model", "task_type": "general"},
            headers=viewer_headers,
        ),
        viewer.post(
            f"/api/v1/models/{model_id}/artifact-uploads/presign",
            json={"filename": "blocked.json", "media_type": "application/json", "size_bytes": 16},
            headers=viewer_headers,
        ),
        viewer.post(
            "/api/v1/train/jobs",
            json={
                "project_id": project["id"],
                "dataset_version_id": version["id"],
                "recipe": "lora",
                "params_json": {},
            },
            headers=viewer_headers,
        ),
        viewer.post(
            "/api/v1/eval/runs",
            json={
                "model_version_a": "left-model-version",
                "model_version_b": "right-model-version",
                "dataset_version_id": version["id"],
            },
            headers=viewer_headers,
        ),
        viewer.delete(
            f"/api/v1/projects/{project['id']}",
            headers=viewer_headers,
        ),
    ]

    for response in responses:
        assert response.status_code == 403



def test_upload_complete_triggers_processing() -> None:
    client = TestClient(main_module.app)
    register_user(client, "uploader@example.com", "Uploader")
    project = create_project(client, "Upload Project")
    dataset = create_dataset(client, project["id"], "Upload Dataset")

    data_item_id = upload_item(client, dataset["id"], "sample scene.jpg")

    items_resp = client.get(f"/api/v1/datasets/{dataset['id']}/items")
    assert items_resp.status_code == 200
    items = items_resp.json()
    item = next(i for i in items if i["id"] == data_item_id)
    assert item["sha256"] is not None
    assert item["width"] == 1024
    assert item["height"] == 768
    assert item["meta_json"]["processed"] is True
    assert item["meta_json"]["mock"] is True
    assert item["preview_url"]
    assert item["download_url"]
    assert "thumbnail_object_key" not in item["meta_json"]


def test_upload_presign_rejects_unsafe_active_content_types() -> None:
    client = TestClient(main_module.app)
    register_user(client, "unsafe-upload@example.com", "Unsafe Upload")
    project = create_project(client, "Unsafe Upload Project")
    dataset = create_dataset(client, project["id"], "Unsafe Upload Dataset")

    presign = client.post(
        "/api/v1/uploads/presign",
        json={
            "dataset_id": dataset["id"],
            "filename": "payload.svg",
            "media_type": "image/svg+xml",
            "size_bytes": 128,
        },
        headers=csrf_headers(client),
    )
    assert presign.status_code == 415
    assert presign.json()["error"]["code"] == "unsupported_media_type"


def test_upload_proxy_rejects_mismatched_image_payload() -> None:
    client = TestClient(main_module.app)
    register_user(client, "mismatch-upload@example.com", "Mismatch Upload")
    project = create_project(client, "Mismatch Project")
    dataset = create_dataset(client, project["id"], "Mismatch Dataset")
    payload_bytes = b"<html><body>not-an-image</body></html>"

    presign = client.post(
        "/api/v1/uploads/presign",
        json={
            "dataset_id": dataset["id"],
            "filename": "spoofed.jpg",
            "media_type": "image/jpeg",
            "size_bytes": len(payload_bytes),
        },
        headers=csrf_headers(client),
    )
    assert presign.status_code == 200
    payload = presign.json()

    put_resp = client.put(
        payload["put_url"],
        content=payload_bytes,
        headers={**payload["headers"], **csrf_headers(client)},
    )
    assert put_resp.status_code == 400
    assert put_resp.json()["error"]["code"] == "upload_mismatch"


def test_buffer_upload_body_spools_large_payloads_to_disk() -> None:
    from app.services.upload_validation import (
        UPLOAD_SPOOL_MAX_MEMORY_BYTES,
        buffer_upload_body,
    )

    class DummyUploadRequest:
        def __init__(self, payload: bytes) -> None:
            self.headers = {"content-length": str(len(payload))}
            self._payload = payload

        async def stream(self):
            midpoint = len(self._payload) // 2
            yield self._payload[:midpoint]
            yield self._payload[midpoint:]

    payload = b"x" * (UPLOAD_SPOOL_MAX_MEMORY_BYTES + 1)
    buffered_upload = asyncio.run(
        buffer_upload_body(
            DummyUploadRequest(payload),
            expected_size=len(payload),
            max_bytes=len(payload) + 1024,
        )
    )
    try:
        assert getattr(buffered_upload.file, "_rolled", False) is True
    finally:
        buffered_upload.close()


def test_non_previewable_uploads_do_not_get_preview_url() -> None:
    client = TestClient(main_module.app)
    register_user(client, "preview-safe@example.com", "Preview Safe")
    project = create_project(client, "Preview Project")
    dataset = create_dataset(client, project["id"], "Preview Dataset")

    data_item_id = upload_item(client, dataset["id"], "notes.txt")

    item_resp = client.get(f"/api/v1/data-items/{data_item_id}")
    assert item_resp.status_code == 200
    item = item_resp.json()
    assert item["preview_url"] is None
    assert item["download_url"]


def test_upload_complete_triggers_processing_and_indexing_followups(monkeypatch) -> None:
    class FakeTask:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple]] = []

        def __call__(self, *args):
            self.calls.append(("call", args))

        def delay(self, *args):
            self.calls.append(("delay", args))

    fake_process = FakeTask()
    fake_index = FakeTask()
    monkeypatch.setattr(uploads_router, "process_data_item", fake_process)
    monkeypatch.setattr(uploads_router, "index_data_item", fake_index)

    client = TestClient(main_module.app)
    user_info = register_user(client, "followup@example.com", "Followup User")
    workspace_id = user_info["workspace"]["id"]
    project = create_project(client, "Followup Project")
    dataset = create_dataset(client, project["id"], "Followup Dataset")

    data_item_id = upload_item(client, dataset["id"], "followup.pdf")

    with SessionLocal() as db:
        item = db.get(DataItem, data_item_id)
        assert item is not None
        assert fake_process.calls == [("call", (data_item_id,))]
        assert fake_index.calls == [
            ("call", (workspace_id, project["id"], data_item_id, item.object_key, item.filename))
        ]


def test_upload_is_hidden_until_complete() -> None:
    client = TestClient(main_module.app)
    register_user(client, "ghost@example.com", "Ghost User")
    project = create_project(client, "Ghost Project")
    dataset = create_dataset(client, project["id"], "Ghost Dataset")

    payload_bytes, _ = upload_fixture("ghost.jpg")
    presign = client.post(
        "/api/v1/uploads/presign",
        json={
            "dataset_id": dataset["id"],
            "filename": "ghost.jpg",
            "media_type": "image/jpeg",
            "size_bytes": len(payload_bytes),
        },
        headers=csrf_headers(client),
    )
    assert presign.status_code == 200

    items_before = client.get(f"/api/v1/datasets/{dataset['id']}/items")
    assert items_before.status_code == 200
    assert items_before.json() == []

    payload = presign.json()
    put_resp = client.put(
        payload["put_url"],
        content=payload_bytes,
        headers={**payload["headers"], **csrf_headers(client)},
    )
    assert put_resp.status_code == 200

    complete = client.post(
        "/api/v1/uploads/complete",
        json={"upload_id": payload["upload_id"], "data_item_id": payload["data_item_id"]},
        headers=csrf_headers(client),
    )
    assert complete.status_code == 200

    items_after = client.get(f"/api/v1/datasets/{dataset['id']}/items")
    assert items_after.status_code == 200
    assert [item["filename"] for item in items_after.json()] == ["ghost.jpg"]


def test_upload_presign_uses_post_policy_in_production(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "post@example.com", "Post User")
    project = create_project(client, "Post Project")
    dataset = create_dataset(client, project["id"], "Post Dataset")

    monkeypatch.setattr(config_module.settings, "env", "production")
    monkeypatch.setattr(config_module.settings, "upload_put_proxy", False)
    monkeypatch.setattr(
        uploads_router,
        "create_presigned_post",
        lambda **kwargs: ("https://storage.example/upload", {"key": "object-key", "policy": "signed"}, {}),
    )

    resp = client.post(
        "/api/v1/uploads/presign",
        json={
            "dataset_id": dataset["id"],
            "filename": "post.jpg",
            "media_type": "image/jpeg",
            "size_bytes": 1024,
        },
        headers=csrf_headers(client),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["upload_method"] == "POST"
    assert body["fields"] == {"key": "object-key", "policy": "signed"}
    assert body["headers"] == {}


def test_cleanup_pending_upload_session_removes_orphan_state(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "upload-cleanup@example.com", "Upload Cleanup")
    project = create_project(client, "Upload Cleanup Project")
    dataset = create_dataset(client, project["id"], "Upload Cleanup Dataset")

    presign = client.post(
        "/api/v1/uploads/presign",
        json={
            "dataset_id": dataset["id"],
            "filename": "orphan.jpg",
            "media_type": "image/jpeg",
            "size_bytes": 16,
        },
        headers=csrf_headers(client),
    )
    assert presign.status_code == 200
    payload = presign.json()
    session = runtime_state.get_json(f"upload:{payload['upload_id']}", "session")
    assert session is not None

    deleted: list[tuple[str, str]] = []

    def fake_delete_object(*, bucket_name: str, object_key: str) -> None:
        deleted.append((bucket_name, object_key))

    monkeypatch.setattr(worker_tasks, "delete_object", fake_delete_object)

    worker_tasks.cleanup_pending_upload_session(payload["upload_id"])

    assert (config_module.settings.s3_private_bucket, session["object_key"]) in deleted
    assert runtime_state.get_json(f"upload:{payload['upload_id']}", "session") is None


def test_cleanup_pending_demo_request_removes_orphan_state(monkeypatch) -> None:
    client = TestClient(main_module.app)
    presign = client.post(
        "/api/v1/demo/presign",
        json={"filename": "demo.png", "media_type": "image/png", "size_bytes": 16},
        headers=public_headers(),
    )
    assert presign.status_code == 200
    payload = presign.json()
    session = runtime_state.get_json(f"demo:request:{payload['request_id']}", "session")
    assert session is not None

    deleted: list[tuple[str, str]] = []

    def fake_delete_object(*, bucket_name: str, object_key: str) -> None:
        deleted.append((bucket_name, object_key))

    monkeypatch.setattr(worker_tasks, "delete_object", fake_delete_object)

    worker_tasks.cleanup_pending_demo_request(payload["request_id"])

    assert (config_module.settings.s3_demo_bucket, session["object_key"]) in deleted
    assert runtime_state.get_json(f"demo:request:{payload['request_id']}", "session") is None
    assert runtime_state.get_json(f"demo:upload:{payload['upload_id']}", "session") is None


def test_cleanup_deleted_dataset_deletes_objects(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "cleanup@example.com", "Cleanup User")
    project = create_project(client, "Cleanup Project")
    dataset = create_dataset(client, project["id"], "Cleanup Dataset")

    data_item_id = upload_item(client, dataset["id"], "cleanup.jpg")
    with SessionLocal() as db:
        data_item = db.get(DataItem, data_item_id)
        assert data_item is not None
        object_key = data_item.object_key

    deleted: list[tuple[str, str]] = []

    def fake_delete_object(*, bucket_name: str, object_key: str) -> None:
        deleted.append((bucket_name, object_key))

    monkeypatch.setattr(worker_tasks, "delete_object", fake_delete_object)

    worker_tasks.cleanup_deleted_dataset(dataset["id"])

    assert (config_module.settings.s3_private_bucket, object_key) in deleted
    with SessionLocal() as db:
        data_item = db.get(DataItem, data_item_id)
        assert data_item is not None
        assert data_item.deleted_at is not None
        assert data_item.meta_json["cleanup_marked"] is True


def test_cleanup_deleted_project_deletes_project_objects(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "project-cleanup@example.com", "Project Cleanup User")
    project = create_project(client, "Project Cleanup")
    dataset = create_dataset(client, project["id"], "Project Cleanup Dataset")
    data_item_id = upload_item(client, dataset["id"], "project-cleanup.jpg")

    model_resp = client.post(
        "/api/v1/models",
        json={"project_id": project["id"], "name": "Cleanup Model", "task_type": "general"},
        headers=csrf_headers(client),
    )
    assert model_resp.status_code == 200
    model_id = model_resp.json()["model"]["id"]
    artifact_upload_id = upload_model_artifact(client, model_id, "project-report.json")

    version_resp = client.post(
        f"/api/v1/models/{model_id}/versions",
        json={"run_id": None, "artifact_upload_id": artifact_upload_id, "metrics_json": {"acc": 0.91}},
        headers=csrf_headers(client),
    )
    assert version_resp.status_code == 200
    model_version_id = version_resp.json()["model_version"]["id"]

    with SessionLocal() as db:
        data_item = db.get(DataItem, data_item_id)
        model_version = db.get(ModelVersion, model_version_id)
        assert data_item is not None
        assert model_version is not None
        data_object_key = data_item.object_key
        model_object_key = model_version.artifact_object_key

    deleted: list[tuple[str, str]] = []

    def fake_delete_object(*, bucket_name: str, object_key: str) -> None:
        deleted.append((bucket_name, object_key))

    monkeypatch.setattr(worker_tasks, "delete_object", fake_delete_object)

    worker_tasks.cleanup_deleted_project(project["id"])

    assert (config_module.settings.s3_private_bucket, data_object_key) in deleted
    assert (config_module.settings.s3_private_bucket, model_object_key) in deleted


def test_audit_log_redacts_object_keys() -> None:
    client = TestClient(main_module.app)
    register_user(client, "audit@example.com", "Audit User")
    project = create_project(client, "Audit Project")
    dataset = create_dataset(client, project["id"], "Audit Dataset")

    payload_bytes, _ = upload_fixture("audit.jpg")
    presign = client.post(
        "/api/v1/uploads/presign",
        json={
            "dataset_id": dataset["id"],
            "filename": "audit.jpg",
            "media_type": "image/jpeg",
            "size_bytes": len(payload_bytes),
        },
        headers=csrf_headers(client),
    )
    assert presign.status_code == 200

    with SessionLocal() as db:
        log = db.query(AuditLog).filter(AuditLog.action == "upload.presign").first()
        assert log is not None
        assert log.meta_json["object_key"] == "[redacted]"


def test_dataset_commit_versions_increment_and_filter() -> None:
    client = TestClient(main_module.app)
    register_user(client, "dataset@example.com", "Dataset User")
    project = create_project(client, "Dataset Project")
    dataset = create_dataset(client, project["id"], "Dataset A")

    item_keep = upload_item(client, dataset["id"], "keep.jpg")
    upload_item(client, dataset["id"], "drop.jpg")

    ann_resp = client.post(
        f"/api/v1/data-items/{item_keep}/annotations",
        json={"type": "tag", "payload_json": {"tags": ["keep"]}},
        headers=csrf_headers(client),
    )
    assert ann_resp.status_code == 200

    version1 = commit_dataset(client, dataset["id"], "only keep tag", {"tag": "keep"})
    assert version1["version"] == 1
    assert version1["item_count"] == 1
    assert version1["frozen_item_ids"] == [item_keep]

    version2 = commit_dataset(client, dataset["id"], "all items")
    assert version2["version"] == 2
    assert version2["item_count"] == 2
    assert len(version2["frozen_item_ids"]) == 2


def test_dataset_items_tag_filter_returns_only_matching_items() -> None:
    client = TestClient(main_module.app)
    register_user(client, "items@example.com", "Items User")
    project = create_project(client, "Items Project")
    dataset = create_dataset(client, project["id"], "Dataset Filter")

    item_keep = upload_item(client, dataset["id"], "keep.jpg")
    upload_item(client, dataset["id"], "drop.jpg")

    ann_resp = client.post(
        f"/api/v1/data-items/{item_keep}/annotations",
        json={"type": "tag", "payload_json": {"tags": ["keep", "featured"]}},
        headers=csrf_headers(client),
    )
    assert ann_resp.status_code == 200

    items_resp = client.get(f"/api/v1/datasets/{dataset['id']}/items?tag=keep")
    assert items_resp.status_code == 200
    items = items_resp.json()
    assert [item["id"] for item in items] == [item_keep]
    assert items[0]["annotations"] == [
        {
            "id": ann_resp.json()["annotation"]["id"],
            "type": "tag",
            "payload_json": {"tags": ["keep", "featured"]},
            "created_at": items[0]["annotations"][0]["created_at"],
        }
    ]


def test_training_job_success_and_failure_flow() -> None:
    client = TestClient(main_module.app)
    register_user(client, "trainer@example.com", "Trainer")
    project = create_project(client, "Train Project")
    dataset = create_dataset(client, project["id"], "Train Dataset")
    upload_item(client, dataset["id"], "train-1.jpg")
    version = commit_dataset(client, dataset["id"], "baseline")

    success_resp = client.post(
        "/api/v1/train/jobs",
        json={
            "project_id": project["id"],
            "dataset_version_id": version["id"],
            "recipe": "mock",
            "params_json": {"sync": True},
        },
        headers=csrf_headers(client),
    )
    assert success_resp.status_code == 200
    assert success_resp.json()["job"]["status"] == "succeeded"
    success_job_id = success_resp.json()["job"]["id"]

    success_job = client.get(f"/api/v1/train/jobs/{success_job_id}")
    assert success_job.status_code == 200
    assert success_job.json()["job"]["status"] == "succeeded"

    fail_resp = client.post(
        "/api/v1/train/jobs",
        json={
            "project_id": project["id"],
            "dataset_version_id": version["id"],
            "recipe": "mock",
            "params_json": {"sync": True, "force_fail": True},
        },
        headers=csrf_headers(client),
    )
    assert fail_resp.status_code == 200
    assert fail_resp.json()["job"]["status"] == "failed"
    failed_job_id = fail_resp.json()["job"]["id"]

    failed_job = client.get(f"/api/v1/train/jobs/{failed_job_id}")
    assert failed_job.status_code == 200
    assert failed_job.json()["job"]["status"] == "failed"


def test_eval_run_requires_expected_schema() -> None:
    client = TestClient(main_module.app)
    register_user(client, "eval@example.com", "Eval User")

    missing = client.post(
        "/api/v1/eval/runs",
        json={"model_version_a": "model-a"},
        headers=csrf_headers(client),
    )
    assert missing.status_code == 422
    assert missing.json()["error"]["code"] == "validation_error"

    extra = client.post(
        "/api/v1/eval/runs",
        json={
            "model_version_a": "model-a",
            "model_version_b": "model-b",
            "dataset_version_id": "dataset-v1",
            "unexpected": True,
        },
        headers=csrf_headers(client),
    )
    assert extra.status_code == 422
    assert extra.json()["error"]["code"] == "validation_error"


def test_schema_uses_named_indexes_without_duplicate_orm_indexes() -> None:
    expected_indexes = {
        "data_items": {"idx_data_items_dataset", "idx_data_items_sha"},
        "annotations": {"idx_annotations_item"},
        "dataset_versions": {"idx_dsv_dataset"},
        "training_jobs": {"idx_jobs_project"},
        "training_runs": {"idx_runs_job"},
        "metrics": {"idx_metrics_run"},
        "artifacts": {"idx_artifacts_run"},
        "models": {"idx_models_project"},
        "model_versions": {"idx_model_versions_model"},
    }
    for table_name, expected in expected_indexes.items():
        indexes = {index.name for index in Base.metadata.tables[table_name].indexes}
        assert expected.issubset(indexes)
        assert not {name for name in indexes if name.startswith("ix_")}


def test_model_version_alias_publish_and_rollback() -> None:
    client = TestClient(main_module.app)
    register_user(client, "model@example.com", "Model User")
    project = create_project(client, "Model Project")

    model_resp = client.post(
        "/api/v1/models",
        json={"project_id": project["id"], "name": "Assistant", "task_type": "general"},
        headers=csrf_headers(client),
    )
    assert model_resp.status_code == 200
    model_id = model_resp.json()["model"]["id"]

    artifact_v1 = upload_model_artifact(client, model_id, "report-v1.json")
    v1_resp = client.post(
        f"/api/v1/models/{model_id}/versions",
        json={"run_id": None, "artifact_upload_id": artifact_v1, "metrics_json": {"acc": 0.8}},
        headers=csrf_headers(client),
    )
    assert v1_resp.status_code == 200
    v1_id = v1_resp.json()["model_version"]["id"]
    assert v1_resp.json()["model_version"]["artifact_download_url"]

    artifact_v2 = upload_model_artifact(client, model_id, "report-v2.json")
    v2_resp = client.post(
        f"/api/v1/models/{model_id}/versions",
        json={"run_id": None, "artifact_upload_id": artifact_v2, "metrics_json": {"acc": 0.9}},
        headers=csrf_headers(client),
    )
    assert v2_resp.status_code == 200
    v2_id = v2_resp.json()["model_version"]["id"]

    publish_resp = client.post(
        f"/api/v1/models/{model_id}/aliases",
        json={"alias": "prod", "model_version_id": v1_id},
        headers=csrf_headers(client),
    )
    assert publish_resp.status_code == 200

    rollback_resp = client.post(
        f"/api/v1/models/{model_id}/rollback",
        json={"alias": "prod", "to_model_version_id": v2_id},
        headers=csrf_headers(client),
    )
    assert rollback_resp.status_code == 200

    detail_resp = client.get(f"/api/v1/models/{model_id}")
    assert detail_resp.status_code == 200
    aliases = detail_resp.json()["aliases"]
    prod_alias = next(a for a in aliases if a["alias"] == "prod")
    assert prod_alias["model_version_id"] == v2_id


def test_validation_error_shape_contains_request_id() -> None:
    client = TestClient(main_module.app)
    resp = client.post("/api/v1/auth/register", json={"password": "missing-email"}, headers=public_headers())
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "validation_error"
    assert isinstance(body["error"]["request_id"], str)
    assert body["error"]["request_id"]
    assert body["error"]["details"]["errors"]
    assert all("input" not in error for error in body["error"]["details"]["errors"])


def test_login_rate_limit_ignores_spoofed_forwarded_for() -> None:
    client = TestClient(main_module.app)
    register_user(client, "ratelimit@example.com", "Rate Limit User")
    for i in range(5):
        resp = client.post(
            "/api/v1/auth/login",
            json={"email": "ratelimit@example.com", "password": "wrongpass1234"},
            headers={**public_headers(), "x-forwarded-for": f"198.51.100.{i}"},
        )
        assert resp.status_code == 401

    blocked = client.post(
        "/api/v1/auth/login",
        json={"email": "ratelimit@example.com", "password": "wrongpass1234"},
        headers={**public_headers(), "x-forwarded-for": "203.0.113.99"},
    )
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "rate_limited"


def test_origin_required_for_public_mutations() -> None:
    client = TestClient(main_module.app)
    resp = client.post(
        "/api/v1/auth/register",
        json={
            "email": "origin@example.com",
            "password": "pass1234pass",
            "display_name": "Origin",
            "code": "123456",
        },
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "origin_required"


def test_csrf_required_for_authenticated_mutations() -> None:
    client = TestClient(main_module.app)
    register_user(client, "csrf@example.com", "CSRF User")
    resp = client.post("/api/v1/projects", json={"name": "P1", "description": "demo"}, headers=public_headers())
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "csrf_required"


def test_refresh_csrf_reuses_existing_valid_token() -> None:
    client = TestClient(main_module.app)
    user_info = register_user(client, "csrf-reuse@example.com", "CSRF Reuse")
    workspace_id = user_info["workspace"]["id"]

    first = client.get("/api/v1/auth/csrf", headers=public_headers())
    assert first.status_code == 200
    second = client.get("/api/v1/auth/csrf", headers=public_headers())
    assert second.status_code == 200
    assert second.json()["csrf_token"] == first.json()["csrf_token"]

    create = client.post(
        "/api/v1/projects",
        json={"name": "Stable CSRF", "description": "demo"},
        headers={
            **public_headers(),
            "x-workspace-id": workspace_id,
            "x-csrf-token": first.json()["csrf_token"],
        },
    )
    assert create.status_code == 200


def test_demo_upload_and_infer_flow() -> None:
    client = TestClient(main_module.app)
    payload_bytes, _ = upload_fixture("demo.png")
    presign = client.post(
        "/api/v1/demo/presign",
        json={"filename": "demo.png", "media_type": "image/png", "size_bytes": len(payload_bytes)},
        headers=public_headers(),
    )
    assert presign.status_code == 200
    payload = presign.json()
    assert "object_key" not in payload

    put_resp = client.put(
        payload["put_url"],
        content=payload_bytes,
        headers={**payload["headers"], **public_headers()},
    )
    assert put_resp.status_code == 200

    for _ in range(3):
        infer = client.post(
            "/api/v1/demo/infer",
            json={"request_id": payload["request_id"], "task": "ocr", "prompt": "读取图片文字", "locale": "zh-CN"},
            headers=public_headers(),
        )
        assert infer.status_code == 200
        body = infer.json()
        assert body["request_id"] == payload["request_id"]
        assert body["outputs"]["text"]

    limited = client.post(
        "/api/v1/demo/infer",
        json={"request_id": payload["request_id"], "task": "ocr", "prompt": "读取图片文字", "locale": "zh-CN"},
        headers=public_headers(),
    )
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limited"


def test_demo_slot_is_released_after_successful_infer() -> None:
    client = TestClient(main_module.app)
    payload_bytes, _ = upload_fixture("demo.png")

    for index in range(settings.demo_max_concurrent_sessions_per_ip + 1):
        presign = client.post(
            "/api/v1/demo/presign",
            json={"filename": f"demo-{index}.png", "media_type": "image/png", "size_bytes": len(payload_bytes)},
            headers=public_headers(),
        )
        assert presign.status_code == 200
        payload = presign.json()

        put_resp = client.put(
            payload["put_url"],
            content=payload_bytes,
            headers={**payload["headers"], **public_headers()},
        )
        assert put_resp.status_code == 200

        infer = client.post(
            "/api/v1/demo/infer",
            json={"request_id": payload["request_id"], "task": "ocr", "prompt": "读取图片文字", "locale": "zh-CN"},
            headers=public_headers(),
        )
        assert infer.status_code == 200


def test_storage_helpers_only_treat_missing_objects_as_absent(monkeypatch) -> None:
    class MissingClient:
        def head_object(self, **kwargs):
            raise make_client_error("NotFound", 404)

    class ForbiddenClient:
        def head_object(self, **kwargs):
            raise make_client_error("403", 403)

    monkeypatch.setattr(storage_service.settings, "env", "local")
    monkeypatch.setattr(storage_service, "get_s3_client", lambda: MissingClient())
    assert storage_service.object_exists(bucket_name="bucket", object_key="missing") is False
    assert storage_service.get_object_metadata(bucket_name="bucket", object_key="missing") is None

    monkeypatch.setattr(storage_service, "get_s3_client", lambda: ForbiddenClient())
    with pytest.raises(ClientError):
        storage_service.object_exists(bucket_name="bucket", object_key="forbidden")
    with pytest.raises(ClientError):
        storage_service.get_object_metadata(bucket_name="bucket", object_key="forbidden")


def test_create_presigned_get_preserves_unicode_download_name(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class DummyPresignClient:
        def generate_presigned_url(self, *, ClientMethod, Params, ExpiresIn):
            captured["client_method"] = ClientMethod
            captured["params"] = Params
            captured["expires_in"] = ExpiresIn
            return "https://example.com/presigned"

    monkeypatch.setattr(storage_service, "get_s3_presign_client", lambda: DummyPresignClient())
    url = storage_service.create_presigned_get(
        bucket_name="bucket",
        object_key="path/to/object",
        download_name="测试 图片.png",
    )

    assert url == "https://example.com/presigned"
    assert storage_service.sanitize_filename("测试 图片.png") == "测试_图片.png"
    disposition = captured["params"]["ResponseContentDisposition"]
    assert 'filename="测试_图片.png"' in disposition
    assert "filename*=UTF-8''%E6%B5%8B%E8%AF%95%20%E5%9B%BE%E7%89%87.png" in disposition


def test_pipeline_patch_persists_config_json() -> None:
    client = TestClient(main_module.app)
    register_user(client, "pipeline@example.com", "Pipeline")
    project = create_project(client, "Pipeline Project")

    payload = {
        "project_id": project["id"],
        "model_type": "tts",
        "model_id": "cosyvoice-v1",
        "config_json": {"voice_id": "cosy-cn", "speed": 1.1},
    }
    resp = client.patch(
        "/api/v1/pipeline",
        json=payload,
        headers=csrf_headers(client),
    )

    assert resp.status_code == 200
    assert resp.json()["config_json"] == payload["config_json"]

    current = client.get(f"/api/v1/pipeline?project_id={project['id']}")
    assert current.status_code == 200
    matching = [item for item in current.json()["items"] if item["model_type"] == "tts"]
    assert matching[0]["config_json"] == payload["config_json"]


def test_project_creation_seeds_default_pipeline() -> None:
    client = TestClient(main_module.app)
    register_user(client, "defaults@example.com", "Defaults")
    project = create_project(client, "Defaults Project")

    current = client.get(f"/api/v1/pipeline?project_id={project['id']}")
    assert current.status_code == 200
    items = {item["model_type"]: item["model_id"] for item in current.json()["items"]}
    assert items["llm"] == "qwen3.5-plus"
    assert items["asr"] == "paraformer-v2"
    assert items["tts"] == "cosyvoice-v1"
    assert items["vision"] == "qwen-vl-plus"
    assert items["realtime"] == "qwen3-omni-flash-realtime"
    assert items["realtime_asr"] == "qwen3-asr-flash-realtime"
    assert items["realtime_tts"] == "qwen3-tts-flash-realtime"
    assert project["default_chat_mode"] == "standard"


def test_pipeline_patch_rejects_realtime_model_in_chat_slot() -> None:
    client = TestClient(main_module.app)
    register_user(client, "pipeline-chat-guard@example.com", "Pipeline Chat Guard")
    project = create_project(client, "Pipeline Chat Guard Project")

    resp = client.patch(
        "/api/v1/pipeline",
        json={
            "project_id": project["id"],
            "model_type": "llm",
            "model_id": "qwen3-omni-flash-realtime",
            "config_json": {},
        },
        headers=csrf_headers(client),
    )

    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_model_type"


def test_pipeline_patch_rejects_non_realtime_model_in_realtime_slot() -> None:
    client = TestClient(main_module.app)
    register_user(client, "pipeline-realtime-guard@example.com", "Pipeline Realtime Guard")
    project = create_project(client, "Pipeline Realtime Guard Project")

    resp = client.patch(
        "/api/v1/pipeline",
        json={
            "project_id": project["id"],
            "model_type": "realtime",
            "model_id": "qwen3.5-plus",
            "config_json": {},
        },
        headers=csrf_headers(client),
    )

    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "invalid_model_type"


def test_send_message_does_not_duplicate_current_user_message(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "chat@example.com", "Chat")
    project = create_project(client, "Chat Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    captured: dict[str, object] = {}

    async def fake_orchestrate_inference(*args, **kwargs):
        captured["user_message"] = kwargs["user_message"]
        captured["recent_messages"] = kwargs["recent_messages"]
        return "mocked ai reply"

    monkeypatch.setattr(chat_router.settings, "dashscope_api_key", "test-key")
    monkeypatch.setattr(chat_router, "orchestrate_inference", fake_orchestrate_inference)

    resp = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        json={"content": "hello world"},
        headers=csrf_headers(client),
    )

    assert resp.status_code == 200
    assert captured["user_message"] == "hello world"
    assert captured["recent_messages"] == []


def test_send_message_persists_reasoning_content_when_thinking_enabled(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "chat-thinking@example.com", "Chat Thinking")
    project = create_project(client, "Chat Thinking Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    captured: dict[str, object] = {}

    async def fake_orchestrate_inference(*args, **kwargs):
        captured["enable_thinking"] = kwargs.get("enable_thinking")
        return {
            "content": "最终回答",
            "reasoning_content": "先拆解问题，再形成回答。",
        }

    monkeypatch.setattr(chat_router.settings, "dashscope_api_key", "test-key")
    monkeypatch.setattr(chat_router, "orchestrate_inference", fake_orchestrate_inference)

    resp = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        json={"content": "帮我分析", "enable_thinking": True},
        headers=csrf_headers(client),
    )

    assert resp.status_code == 200
    assert captured["enable_thinking"] is True
    assert resp.json()["content"] == "最终回答"
    assert resp.json()["reasoning_content"] == "先拆解问题，再形成回答。"

    messages = client.get(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        headers={"origin": ORIGIN},
    )
    assert messages.status_code == 200
    assert messages.json()[1]["reasoning_content"] == "先拆解问题，再形成回答。"


def test_send_message_auto_disables_thinking_for_simple_greeting(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "chat-auto-greeting@example.com", "Chat Auto Greeting")
    project = create_project(client, "Chat Auto Greeting Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    captured: dict[str, object] = {}

    async def fake_orchestrate_inference(*args, **kwargs):
        captured["enable_thinking"] = kwargs.get("enable_thinking")
        return {"content": "你好呀", "reasoning_content": None}

    monkeypatch.setattr(chat_router.settings, "dashscope_api_key", "test-key")
    monkeypatch.setattr(chat_router, "orchestrate_inference", fake_orchestrate_inference)

    resp = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        json={"content": "你好"},
        headers=csrf_headers(client),
    )

    assert resp.status_code == 200
    assert captured["enable_thinking"] is False


def test_send_message_auto_enables_thinking_for_analysis_prompt(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "chat-auto-analysis@example.com", "Chat Auto Analysis")
    project = create_project(client, "Chat Auto Analysis Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    captured: dict[str, object] = {}

    async def fake_orchestrate_inference(*args, **kwargs):
        captured["enable_thinking"] = kwargs.get("enable_thinking")
        return {"content": "我来分析一下", "reasoning_content": "..." }

    monkeypatch.setattr(chat_router.settings, "dashscope_api_key", "test-key")
    monkeypatch.setattr(chat_router, "orchestrate_inference", fake_orchestrate_inference)

    resp = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        json={"content": "请分析一下这个方案的优缺点"},
        headers=csrf_headers(client),
    )

    assert resp.status_code == 200
    assert captured["enable_thinking"] is True


def test_stream_message_auto_disables_thinking_for_simple_greeting(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "chat-stream-auto-greeting@example.com", "Chat Stream Auto Greeting")
    project = create_project(client, "Chat Stream Auto Greeting Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    captured: dict[str, object] = {}

    async def fake_chat_completion_stream(
        messages,
        model=None,
        *,
        temperature=0.7,
        max_tokens=2048,
        enable_thinking=None,
        timeout=120.0,
    ):
        del messages, model, temperature, max_tokens, timeout
        captured["enable_thinking"] = enable_thinking
        yield dashscope_stream_service.StreamChunk(reasoning_content="不该显示的思考")
        yield dashscope_stream_service.StreamChunk(content="你好呀")
        yield dashscope_stream_service.StreamChunk(finish_reason="stop")

    monkeypatch.setattr(chat_router.settings, "dashscope_api_key", "test-key")
    monkeypatch.setattr(orchestrator_service, "chat_completion_stream", fake_chat_completion_stream)

    resp = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/stream",
        json={"content": "你好"},
        headers=csrf_headers(client),
    )

    assert resp.status_code == 200
    assert captured["enable_thinking"] is False
    assert "event: reasoning" not in resp.text
    assert '"reasoning_content": null' in resp.text

    messages = client.get(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        headers={"origin": ORIGIN},
    )
    assert messages.status_code == 200
    assert messages.json()[1]["content"] == "你好呀"
    assert messages.json()[1]["reasoning_content"] is None


@pytest.mark.asyncio
async def test_chat_completion_stream_explicitly_sends_false_enable_thinking(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class FakeStreamResponse:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            del exc_type, exc, tb
            return False

        def raise_for_status(self) -> None:
            return None

        async def aiter_lines(self):
            yield 'data: {"choices":[{"delta":{"content":"你好"},"finish_reason":null}]}'
            yield "data: [DONE]"

    class FakeClient:
        def stream(self, method, url, headers=None, json=None, timeout=None):
            captured["method"] = method
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            captured["timeout"] = timeout
            return FakeStreamResponse()

    monkeypatch.setattr(dashscope_stream_service, "get_client", lambda: FakeClient())

    chunks: list[dashscope_stream_service.StreamChunk] = []
    async for chunk in dashscope_stream_service.chat_completion_stream(
        [{"role": "user", "content": "你好"}],
        model="qwen3.5-plus",
        enable_thinking=False,
    ):
        chunks.append(chunk)

    assert [chunk.content for chunk in chunks] == ["你好"]
    assert isinstance(captured["json"], dict)
    assert captured["json"]["enable_thinking"] is False


def test_send_message_returns_explicit_error_when_model_api_is_unconfigured(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "chat-unconfigured@example.com", "Chat Unconfigured")
    project = create_project(client, "Chat Unconfigured Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    monkeypatch.setattr(chat_router.settings, "dashscope_api_key", "")

    resp = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        json={"content": "hello world"},
        headers=csrf_headers(client),
    )

    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "model_api_unconfigured"

    messages = client.get(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        headers={"origin": ORIGIN},
    )
    assert messages.status_code == 200
    assert messages.json() == []


def test_send_message_survives_non_fatal_rag_failure(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "chat-rag-failure@example.com", "Chat Rag Failure")
    project = create_project(client, "Chat Rag Failure Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    async def fake_search_similar(*args, **kwargs):
        raise RuntimeError("vector lookup failed")

    async def fake_chat_completion_detailed(messages, model, enable_thinking=None):  # noqa: ARG001
        return SimpleNamespace(content="rag fallback ok", reasoning_content=None)

    monkeypatch.setattr(chat_router.settings, "dashscope_api_key", "test-key")
    monkeypatch.setattr(orchestrator_service, "search_similar", fake_search_similar)
    monkeypatch.setattr(orchestrator_service, "chat_completion_detailed", fake_chat_completion_detailed)

    resp = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        json={"content": "hello world"},
        headers=csrf_headers(client),
    )

    assert resp.status_code == 200
    assert resp.json()["content"] == "rag fallback ok"

    messages = client.get(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        headers={"origin": ORIGIN},
    )
    assert messages.status_code == 200
    assert [item["role"] for item in messages.json()] == ["user", "assistant"]


def test_dictate_voice_input_transcribes_audio_without_creating_messages(monkeypatch) -> None:
    monkeypatch.setattr(chat_router.settings, "dashscope_api_key", "test-key")
    client = TestClient(main_module.app)
    register_user(client, "chat-dictate@example.com", "Chat Dictate")
    project = create_project(client, "Chat Dictate Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    async def fake_transcribe_audio_input_for_project(*args, **kwargs):
        assert kwargs["project_id"] == project["id"]
        assert kwargs["audio_bytes"] == b"voice-audio"
        assert kwargs["filename"] == "recording.webm"
        return "这是听写结果"

    monkeypatch.setattr(
        chat_router,
        "transcribe_audio_input_for_project",
        fake_transcribe_audio_input_for_project,
    )

    dictated = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/dictate",
        files={"audio": ("recording.webm", b"voice-audio", "audio/webm")},
        headers=csrf_headers(client),
    )
    assert dictated.status_code == 200
    assert dictated.json()["text_input"] == "这是听写结果"

    messages = client.get(f"/api/v1/chat/conversations/{conversation_id}/messages")
    assert messages.status_code == 200
    assert messages.json() == []


def test_dictate_voice_input_accepts_media_type_parameters(monkeypatch) -> None:
    monkeypatch.setattr(chat_router.settings, "dashscope_api_key", "test-key")
    client = TestClient(main_module.app)
    register_user(client, "chat-dictate-codecs@example.com", "Chat Dictate Codecs")
    project = create_project(client, "Chat Dictate Codecs Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    async def fake_transcribe_audio_input_for_project(*args, **kwargs):
        assert kwargs["project_id"] == project["id"]
        assert kwargs["audio_bytes"] == b"voice-audio"
        assert kwargs["filename"] == "recording.webm"
        return "带参数的音频头也能过"

    monkeypatch.setattr(
        chat_router,
        "transcribe_audio_input_for_project",
        fake_transcribe_audio_input_for_project,
    )

    dictated = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/dictate",
        files={"audio": ("recording.webm", b"voice-audio", "audio/webm;codecs=opus")},
        headers=csrf_headers(client),
    )
    assert dictated.status_code == 200
    assert dictated.json()["text_input"] == "带参数的音频头也能过"


def test_speech_endpoint_synthesizes_audio_without_creating_messages(monkeypatch) -> None:
    monkeypatch.setattr(chat_router.settings, "dashscope_api_key", "test-key")
    client = TestClient(main_module.app)
    register_user(client, "chat-speech@example.com", "Chat Speech")
    project = create_project(client, "Chat Speech Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    async def fake_synthesize_speech_for_project(*args, **kwargs):
        assert kwargs["project_id"] == project["id"]
        assert kwargs["text"] == "请朗读这段回复"
        return b"\x01\x02\x03"

    monkeypatch.setattr(
        chat_router,
        "synthesize_speech_for_project",
        fake_synthesize_speech_for_project,
    )

    spoken = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/speech",
        json={"content": "请朗读这段回复"},
        headers=csrf_headers(client),
    )
    assert spoken.status_code == 200
    assert spoken.json()["audio_response"] == "AQID"

    messages = client.get(f"/api/v1/chat/conversations/{conversation_id}/messages")
    assert messages.status_code == 200
    assert messages.json() == []


def test_transcribe_audio_input_for_project_falls_back_to_qwen3_asr_flash(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "chat-asr-fallback@example.com", "Chat ASR Fallback")
    project = create_project(client, "Chat ASR Fallback Project")

    captured: dict[str, object] = {}

    async def fake_transcribe_audio(audio_bytes: bytes, filename: str = "audio.wav", model: str | None = None, content_type: str | None = None) -> str:
        captured["audio_bytes"] = audio_bytes
        captured["filename"] = filename
        captured["model"] = model
        return "fallback ok"

    monkeypatch.setattr("app.services.asr_client.transcribe_audio", fake_transcribe_audio)

    with SessionLocal() as db:
        result = asyncio.run(
            orchestrator_service.transcribe_audio_input_for_project(
                db,
                project_id=project["id"],
                audio_bytes=b"voice-audio",
                filename="recording.webm",
            )
        )

    assert result == "fallback ok"
    assert captured["audio_bytes"] == b"voice-audio"
    assert captured["filename"] == "recording.webm"
    assert captured["model"] == "qwen3-asr-flash"


def test_synthesize_speech_for_project_falls_back_to_qwen3_tts_flash(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "chat-tts-fallback@example.com", "Chat TTS Fallback")
    project = create_project(client, "Chat TTS Fallback Project")

    captured: dict[str, object] = {}

    async def fake_synthesize_speech(text: str, model: str | None = None, voice: str = "Cherry") -> bytes:
        captured["text"] = text
        captured["model"] = model
        captured["voice"] = voice
        return b"\x01\x02"

    monkeypatch.setattr("app.services.tts_client.synthesize_speech", fake_synthesize_speech)

    with SessionLocal() as db:
        result = asyncio.run(
            orchestrator_service.synthesize_speech_for_project(
                db,
                project_id=project["id"],
                text="请朗读这段回复",
            )
        )

    assert result == b"\x01\x02"
    assert captured["text"] == "请朗读这段回复"
    assert captured["model"] == "qwen3-tts-flash"


def test_image_endpoint_uses_prompt_and_preserves_image_mime_type(monkeypatch) -> None:
    monkeypatch.setattr(chat_router.settings, "dashscope_api_key", "test-key")
    client = TestClient(main_module.app)
    register_user(client, "chat-image@example.com", "Chat Image")
    project = create_project(client, "Chat Image Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    captured: dict[str, object] = {}

    async def fake_orchestrate_voice_inference(*args, **kwargs):
        captured.update(kwargs)
        return {
            "text_input": "帮我看看这个图",
            "text_response": "这是一张测试图片。",
            "audio_response": b"\x01\x02\x03",
        }

    monkeypatch.setattr(chat_router, "orchestrate_voice_inference", fake_orchestrate_voice_inference)

    image_bytes, media_type = upload_fixture("example.png")
    response = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/image",
        data={"prompt": "帮我看看这个图"},
        files={"image": ("example.png", image_bytes, media_type)},
        headers=csrf_headers(client),
    )

    assert response.status_code == 200
    assert captured["project_id"] == project["id"]
    assert captured["conversation_id"] == conversation_id
    assert captured["image_bytes"] == image_bytes
    assert captured["image_mime_type"] == "image/png"
    assert captured["text_input"] == "帮我看看这个图"
    assert response.json()["message"]["content"] == "这是一张测试图片。"
    assert response.json()["audio_response"] == "AQID"


def test_memory_routes_return_204_and_search_falls_back_without_embeddings() -> None:
    client = TestClient(main_module.app)
    register_user(client, "memory@example.com", "Memory")
    project = create_project(client, "Memory Project")

    first = client.post(
        "/api/v1/memory",
        json={"project_id": project["id"], "content": "用户喜欢黑咖啡", "category": "偏好", "type": "permanent"},
        headers=csrf_headers(client),
    )
    assert first.status_code == 200
    second = client.post(
        "/api/v1/memory",
        json={"project_id": project["id"], "content": "用户计划四月去东京", "category": "计划", "type": "permanent"},
        headers=csrf_headers(client),
    )
    assert second.status_code == 200

    edge = client.post(
        "/api/v1/memory/edges",
        json={
            "source_memory_id": first.json()["id"],
            "target_memory_id": second.json()["id"],
        },
        headers=csrf_headers(client),
    )
    assert edge.status_code == 200
    assert edge.json()["edge_type"] == "manual"

    search = client.post(
        "/api/v1/memory/search",
        json={"project_id": project["id"], "query": "黑咖啡", "top_k": 5},
        headers=csrf_headers(client),
    )
    assert search.status_code == 200
    results = search.json()
    assert len(results) == 1
    assert results[0]["memory"]["content"] == "用户喜欢黑咖啡"

    delete_edge = client.delete(
        f"/api/v1/memory/edges/{edge.json()['id']}",
        headers=csrf_headers(client),
    )
    assert delete_edge.status_code == 204
    assert delete_edge.content == b""

    delete_memory = client.delete(
        f"/api/v1/memory/{first.json()['id']}",
        headers=csrf_headers(client),
    )
    assert delete_memory.status_code == 204
    assert delete_memory.content == b""


def test_project_creation_initializes_assistant_root_memory() -> None:
    client = TestClient(main_module.app)
    register_user(client, "memory-root@example.com", "Memory Root")
    project = create_project(client, "医生助手")

    assert project["assistant_root_memory_id"]

    graph = client.get(f"/api/v1/memory?project_id={project['id']}")
    assert graph.status_code == 200
    root = next(
        node
        for node in graph.json()["nodes"]
        if node["id"] == project["assistant_root_memory_id"]
    )
    assert root["metadata_json"]["node_kind"] == "assistant-root"
    assert root["content"] == "医生助手"
    assert root["parent_memory_id"] is None


def test_memory_creation_defaults_to_project_root_and_root_is_protected() -> None:
    client = TestClient(main_module.app)
    register_user(client, "memory-default-parent@example.com", "Memory Default Parent")
    project = create_project(client, "默认根记忆项目")
    root_id = project["assistant_root_memory_id"]

    memory = client.post(
        "/api/v1/memory",
        json={"project_id": project["id"], "content": "用户喜欢晨间沟通", "category": "偏好", "type": "permanent"},
        headers=csrf_headers(client),
    )
    assert memory.status_code == 200
    assert memory.json()["parent_memory_id"] == root_id

    search = client.post(
        "/api/v1/memory/search",
        json={"project_id": project["id"], "query": "默认根记忆项目", "top_k": 5},
        headers=csrf_headers(client),
    )
    assert search.status_code == 200
    assert search.json() == []

    update_root = client.patch(
        f"/api/v1/memory/{root_id}",
        json={"content": "不允许修改"},
        headers=csrf_headers(client),
    )
    assert update_root.status_code == 400
    assert update_root.json()["error"]["code"] == "bad_request"

    delete_root = client.delete(
        f"/api/v1/memory/{root_id}",
        headers=csrf_headers(client),
    )
    assert delete_root.status_code == 400
    assert delete_root.json()["error"]["code"] == "bad_request"


def test_memory_graph_backfills_legacy_project_root() -> None:
    client = TestClient(main_module.app)
    user_info = register_user(client, "memory-legacy@example.com", "Memory Legacy")
    workspace_id = user_info["workspace"]["id"]

    with SessionLocal() as db:
        project = Project(workspace_id=workspace_id, name="Legacy Assistant", description="demo")
        db.add(project)
        db.commit()
        db.refresh(project)

        orphan = Memory(
            workspace_id=workspace_id,
            project_id=project.id,
            content="历史记忆事实",
            category="事实",
            type="permanent",
            parent_memory_id=None,
            metadata_json={},
        )
        db.add(orphan)
        db.commit()
        db.refresh(orphan)
        project_id = project.id
        orphan_id = orphan.id

    graph = client.get(f"/api/v1/memory?project_id={project_id}")
    assert graph.status_code == 200
    body = graph.json()

    root = next(
        node
        for node in body["nodes"]
        if node.get("metadata_json", {}).get("node_kind") == "assistant-root"
    )
    orphan = next(node for node in body["nodes"] if node["id"] == orphan_id)

    assert root["content"] == "Legacy Assistant"
    assert orphan["parent_memory_id"] == root["id"]

    with SessionLocal() as db:
        project = db.get(Project, project_id)
        assert project is not None
        assert project.assistant_root_memory_id == root["id"]


def test_temporary_memory_requires_conversation_and_graph_includes_file_nodes() -> None:
    client = TestClient(main_module.app)
    register_user(client, "memory-files@example.com", "Memory Files")
    project = create_project(client, "Memory Files Project")
    dataset = create_dataset(client, project["id"], "Memory Files Dataset")
    data_item_id = upload_item(client, dataset["id"], "attachment.jpg")

    missing_conversation = client.post(
        "/api/v1/memory",
        json={
            "project_id": project["id"],
            "content": "临时记忆缺少对话",
            "type": "temporary",
        },
        headers=csrf_headers(client),
    )
    assert missing_conversation.status_code == 400
    assert missing_conversation.json()["error"]["code"] == "bad_request"

    memory = client.post(
        "/api/v1/memory",
        json={
            "project_id": project["id"],
            "content": "知识库文件",
            "category": "资料",
            "type": "permanent",
        },
        headers=csrf_headers(client),
    )
    assert memory.status_code == 200

    with SessionLocal() as db:
        db.add(MemoryFile(memory_id=memory.json()["id"], data_item_id=data_item_id))
        db.commit()

    graph = client.get(f"/api/v1/memory?project_id={project['id']}")
    assert graph.status_code == 200
    body = graph.json()

    file_node = next(node for node in body["nodes"] if node["category"] == "file")
    assert file_node["id"].startswith("file:")
    assert file_node["parent_memory_id"] == memory.json()["id"]
    assert file_node["metadata_json"]["filename"] == "attachment.jpg"
    assert file_node["metadata_json"]["memory_id"] == memory.json()["id"]

    file_edge = next(edge for edge in body["edges"] if edge["edge_type"] == "file")
    assert file_edge["source_memory_id"] == memory.json()["id"]
    assert file_edge["target_memory_id"] == file_node["id"]


def test_temporary_memory_is_hidden_from_other_workspace_members() -> None:
    owner = TestClient(main_module.app)
    owner_info = register_user(owner, "memory-owner@example.com", "Memory Owner")
    owner_workspace_id = owner_info["workspace"]["id"]
    project = create_project(owner, "Private Memory Project")
    conversation = owner.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Private Thread"},
        headers=csrf_headers(owner),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    temp_memory = owner.post(
        "/api/v1/memory",
        json={
            "project_id": project["id"],
            "content": "私人临时记忆-不要泄露",
            "category": "测试",
            "type": "temporary",
            "source_conversation_id": conversation_id,
        },
        headers=csrf_headers(owner),
    )
    assert temp_memory.status_code == 200
    temp_memory_id = temp_memory.json()["id"]

    viewer = TestClient(main_module.app)
    register_user(viewer, "memory-viewer@example.com", "Memory Viewer")
    add_workspace_membership(owner_workspace_id, "memory-viewer@example.com", "viewer")

    viewer_detail = viewer.get(
        f"/api/v1/memory/{temp_memory_id}",
        headers={"x-workspace-id": owner_workspace_id},
    )
    assert viewer_detail.status_code == 404

    viewer_graph = viewer.get(
        f"/api/v1/memory?project_id={project['id']}&conversation_id={conversation_id}",
        headers={"x-workspace-id": owner_workspace_id},
    )
    assert viewer_graph.status_code == 404

    viewer_search = viewer.post(
        "/api/v1/memory/search",
        json={"project_id": project["id"], "query": "私人临时记忆-不要泄露", "top_k": 5},
        headers=csrf_headers(viewer, owner_workspace_id),
    )
    assert viewer_search.status_code == 200
    assert viewer_search.json() == []

    viewer_stream = viewer.get(
        f"/api/v1/chat/conversations/{conversation_id}/memory-stream",
        headers={"x-workspace-id": owner_workspace_id},
    )
    assert viewer_stream.status_code == 404

    viewer_write = viewer.post(
        "/api/v1/memory",
        json={
            "project_id": project["id"],
            "content": "viewer cannot create memory",
            "type": "permanent",
        },
        headers=csrf_headers(viewer, owner_workspace_id),
    )
    assert viewer_write.status_code == 403


def test_memory_file_attach_and_detach_refreshes_detail() -> None:
    client = TestClient(main_module.app)
    register_user(client, "memory-attach@example.com", "Memory Attach")
    project = create_project(client, "Attach Project")
    dataset = create_dataset(client, project["id"], "Attach Dataset")
    data_item_id = upload_item(client, dataset["id"], "attach.pdf")

    memory = client.post(
        "/api/v1/memory",
        json={"project_id": project["id"], "content": "需要关联资料"},
        headers=csrf_headers(client),
    )
    assert memory.status_code == 200
    memory_id = memory.json()["id"]

    available = client.get(f"/api/v1/memory/{memory_id}/available-files")
    assert available.status_code == 200
    assert any(item["id"] == data_item_id for item in available.json())

    attached = client.post(
        f"/api/v1/memory/{memory_id}/files",
        json={"data_item_id": data_item_id},
        headers=csrf_headers(client),
    )
    assert attached.status_code == 200
    memory_file_id = attached.json()["id"]

    detail = client.get(f"/api/v1/memory/{memory_id}")
    assert detail.status_code == 200
    assert detail.json()["files"][0]["data_item_id"] == data_item_id

    deleted = client.delete(
        f"/api/v1/memory/files/{memory_file_id}",
        headers=csrf_headers(client),
    )
    assert deleted.status_code == 204

    refreshed = client.get(f"/api/v1/memory/{memory_id}")
    assert refreshed.status_code == 200
    assert refreshed.json()["files"] == []


def test_sync_memory_links_for_data_item_creates_only_missing_links(monkeypatch) -> None:
    client = TestClient(main_module.app)
    user_info = register_user(client, "memory-link@example.com", "Memory Link")
    workspace_id = user_info["workspace"]["id"]
    project = create_project(client, "Memory Link Project")
    dataset = create_dataset(client, project["id"], "Memory Link Dataset")
    data_item_id = upload_item(client, dataset["id"], "memory-link.txt")

    memory_a = client.post(
        "/api/v1/memory",
        json={"project_id": project["id"], "content": "心理学"},
        headers=csrf_headers(client),
    )
    assert memory_a.status_code == 200
    memory_b = client.post(
        "/api/v1/memory",
        json={"project_id": project["id"], "content": "医生"},
        headers=csrf_headers(client),
    )
    assert memory_b.status_code == 200

    with SessionLocal() as db:
        db.add(MemoryFile(memory_id=memory_a.json()["id"], data_item_id=data_item_id))
        db.commit()

    monkeypatch.setattr(
        memory_file_context_service,
        "find_related_memories_for_data_item",
        lambda *args, **kwargs: [
            {"memory_id": memory_a.json()["id"], "score": 0.95},
            {"memory_id": memory_b.json()["id"], "score": 0.91},
        ],
    )

    with SessionLocal() as db:
        created = memory_file_context_service.sync_memory_links_for_data_item(
            db,
            workspace_id=workspace_id,
            project_id=project["id"],
            data_item_id=data_item_id,
        )
        assert created == [memory_b.json()["id"]]

        links = {
            (memory_id, item_id)
            for memory_id, item_id in db.query(MemoryFile.memory_id, MemoryFile.data_item_id)
            .filter(MemoryFile.data_item_id == data_item_id)
            .all()
        }
        assert links == {
            (memory_a.json()["id"], data_item_id),
            (memory_b.json()["id"], data_item_id),
        }


def test_create_memory_triggers_auto_linking_for_existing_files(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "memory-auto@example.com", "Memory Auto")
    project = create_project(client, "Memory Auto Project")

    calls: dict[str, str] = {}

    async def fake_embed_and_store(*args, **kwargs) -> str:
        calls["embedded_memory_id"] = kwargs["memory_id"]
        return "embedding-1"

    def fake_sync_data_item_links_for_memory(db, *, memory, **kwargs) -> list[str]:
        calls["linked_memory_id"] = memory.id
        return ["data-item-1"]

    monkeypatch.setattr(memory_router.settings, "dashscope_api_key", "test-key")
    monkeypatch.setattr(memory_router, "embed_and_store", fake_embed_and_store)
    monkeypatch.setattr(memory_router, "sync_data_item_links_for_memory", fake_sync_data_item_links_for_memory)

    created = client.post(
        "/api/v1/memory",
        json={"project_id": project["id"], "content": "与知识库自动关联"},
        headers=csrf_headers(client),
    )
    assert created.status_code == 200
    assert calls["embedded_memory_id"] == created.json()["id"]
    assert calls["linked_memory_id"] == created.json()["id"]


def test_memory_patch_does_not_allow_direct_type_mutation() -> None:
    client = TestClient(main_module.app)
    register_user(client, "memory-type@example.com", "Memory Type")
    project = create_project(client, "Memory Type Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Memory Type Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200

    created = client.post(
        "/api/v1/memory",
        json={
            "project_id": project["id"],
            "content": "临时记忆",
            "category": "测试",
            "type": "temporary",
            "source_conversation_id": conversation.json()["id"],
        },
        headers=csrf_headers(client),
    )
    assert created.status_code == 200

    updated = client.patch(
        f"/api/v1/memory/{created.json()['id']}",
        json={"type": "permanent", "content": "仍然是临时记忆"},
        headers=csrf_headers(client),
    )
    assert updated.status_code == 200
    assert updated.json()["type"] == "temporary"


def test_memory_edge_rejects_cross_project_links() -> None:
    client = TestClient(main_module.app)
    register_user(client, "memory-edge@example.com", "Memory Edge")
    project_a = create_project(client, "Project A")
    project_b = create_project(client, "Project B")

    first = client.post(
        "/api/v1/memory",
        json={"project_id": project_a["id"], "content": "A", "type": "permanent"},
        headers=csrf_headers(client),
    )
    second = client.post(
        "/api/v1/memory",
        json={"project_id": project_b["id"], "content": "B", "type": "permanent"},
        headers=csrf_headers(client),
    )
    assert first.status_code == 200
    assert second.status_code == 200

    resp = client.post(
        "/api/v1/memory/edges",
        json={
            "source_memory_id": first.json()["id"],
            "target_memory_id": second.json()["id"],
        },
        headers=csrf_headers(client),
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "bad_request"


def test_delete_conversation_returns_204_and_removes_temporary_memories() -> None:
    client = TestClient(main_module.app)
    register_user(client, "conversation-delete@example.com", "Conversation Delete")
    project = create_project(client, "Conversation Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    memory = client.post(
        "/api/v1/memory",
        json={
            "project_id": project["id"],
            "content": "对话里的临时记忆",
            "type": "temporary",
            "source_conversation_id": conversation_id,
        },
        headers=csrf_headers(client),
    )
    assert memory.status_code == 200

    deleted = client.delete(
        f"/api/v1/chat/conversations/{conversation_id}",
        headers=csrf_headers(client),
    )
    assert deleted.status_code == 204
    assert deleted.content == b""

    detail = client.get(f"/api/v1/memory/{memory.json()['id']}")
    assert detail.status_code == 404


def test_send_message_rate_limit_triggers_after_ten_requests(monkeypatch) -> None:
    monkeypatch.setattr(chat_router.settings, "dashscope_api_key", "test-key")
    async def fake_orchestrate_inference(*args, **kwargs):
        return "mocked reply"
    monkeypatch.setattr(chat_router, "orchestrate_inference", fake_orchestrate_inference)
    client = TestClient(main_module.app)
    register_user(client, "chat-limit@example.com", "Chat Limit")
    project = create_project(client, "Chat Limit Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    for index in range(10):
        resp = client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            json={"content": f"message-{index}"},
            headers=csrf_headers(client),
        )
        assert resp.status_code == 200

    limited = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        json={"content": "message-over-limit"},
        headers=csrf_headers(client),
    )
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limited"


def test_model_catalog_detail_exposes_modalities_and_support_flags() -> None:
    client = TestClient(main_module.app)
    register_user(client, "catalog@example.com", "Catalog")

    detail = client.get("/api/v1/models/catalog/qwen3.5-plus")
    assert detail.status_code == 200

    payload = detail.json()
    assert payload["provider_display"] == "千问 · 阿里云"
    assert payload["canonical_model_id"] == "qwen3.5-plus"
    assert payload["model_id"] == "qwen3.5-plus"
    assert payload["id"] == "00000000-0000-0000-0000-000000000002"
    assert payload["official_category"] == "文本生成"
    assert payload["official_category_key"] == "text_generation"
    assert payload["input_modalities"] == ["text", "image", "video"]
    assert payload["output_modalities"] == ["text"]
    assert payload["supports_function_calling"] is True
    assert payload["supports_web_search"] is True
    assert payload["supports_structured_output"] is False
    assert payload["supports_cache"] is False
    assert payload["supported_tools"] == ["function_calling", "web_search"]
    assert payload["price_unit"] == "tokens"


def test_model_catalog_list_includes_qwen3_vl_plus_and_hides_qwen3_plus() -> None:
    client = TestClient(main_module.app)
    register_user(client, "catalog-list@example.com", "Catalog List")

    resp = client.get("/api/v1/models/catalog")
    assert resp.status_code == 200

    model_ids = {item["model_id"] for item in resp.json()}
    assert "qwen3-vl-plus" in model_ids
    assert "qwen3-plus" not in model_ids


def test_model_catalog_detail_supports_legacy_aliases() -> None:
    client = TestClient(main_module.app)
    register_user(client, "catalog-alias@example.com", "Catalog Alias")

    legacy_plus = client.get("/api/v1/models/catalog/qwen3-plus")
    assert legacy_plus.status_code == 200
    assert legacy_plus.json()["model_id"] == "qwen3.5-plus"
    assert legacy_plus.json()["canonical_model_id"] == "qwen3.5-plus"

    legacy_vl = client.get("/api/v1/models/catalog/qwen3-vl-plus")
    assert legacy_vl.status_code == 200
    assert legacy_vl.json()["model_id"] in {"qwen3-vl-plus", "qwen-vl-plus"}


def test_model_catalog_discover_view_returns_official_taxonomy_and_qwen_items() -> None:
    client = TestClient(main_module.app)
    register_user(client, "catalog-discover@example.com", "Catalog Discover")

    resp = client.get("/api/v1/models/catalog?view=discover")
    assert resp.status_code == 200

    payload = resp.json()
    assert "taxonomy" in payload
    assert "items" in payload
    assert any(item["key"] == "text_generation" for item in payload["taxonomy"])

    model_ids = {item["model_id"] for item in payload["items"]}
    assert "qwen3.5-plus" in model_ids
    assert "deepseek-v3.2" not in model_ids


def test_model_catalog_separates_chat_and_realtime_slots() -> None:
    client = TestClient(main_module.app)
    register_user(client, "catalog-slots@example.com", "Catalog Slots")

    llm = client.get("/api/v1/models/catalog?category=llm")
    assert llm.status_code == 200
    llm_ids = {item["model_id"] for item in llm.json()}
    assert "qwen3.5-plus" in llm_ids
    assert "qwen3-omni-flash-realtime" not in llm_ids

    realtime = client.get("/api/v1/models/catalog?category=realtime")
    assert realtime.status_code == 200
    realtime_items = realtime.json()
    realtime_ids = {item["model_id"] for item in realtime_items}
    assert "qwen3-omni-flash-realtime" in realtime_ids
    assert all(item["category"] == "realtime" for item in realtime_items)

    realtime_asr = client.get("/api/v1/models/catalog?category=realtime_asr")
    assert realtime_asr.status_code == 200
    realtime_asr_items = realtime_asr.json()
    assert "qwen3-asr-flash-realtime" in {item["model_id"] for item in realtime_asr_items}
    assert all(item["category"] == "realtime_asr" for item in realtime_asr_items)

    realtime_tts = client.get("/api/v1/models/catalog?category=realtime_tts")
    assert realtime_tts.status_code == 200
    realtime_tts_items = realtime_tts.json()
    assert "qwen3-tts-flash-realtime" in {item["model_id"] for item in realtime_tts_items}
    assert all(item["category"] == "realtime_tts" for item in realtime_tts_items)


def test_model_catalog_detail_supports_db_id_lookup_and_preserves_runtime_fields() -> None:
    client = TestClient(main_module.app)
    register_user(client, "catalog-db-id@example.com", "Catalog DB ID")

    detail = client.get("/api/v1/models/catalog/00000000-0000-0000-0000-000000000002")
    assert detail.status_code == 200

    payload = detail.json()
    assert payload["id"] == "00000000-0000-0000-0000-000000000002"
    assert payload["model_id"] == "qwen3.5-plus"
    assert payload["canonical_model_id"] == "qwen3.5-plus"
    assert payload["input_price"] == 0.0008
    assert payload["output_price"] == 0.0048
    assert payload["context_window"] == 1000000


def test_model_catalog_unknown_category_returns_empty_list() -> None:
    client = TestClient(main_module.app)
    register_user(client, "catalog-empty-category@example.com", "Catalog Empty Category")

    resp = client.get("/api/v1/models/catalog?category=unknown-slot")
    assert resp.status_code == 200
    assert resp.json() == []


def test_send_message_maps_upstream_failures_to_502_and_503(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "chat-errors@example.com", "Chat Errors")
    project = create_project(client, "Chat Errors Project")
    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    monkeypatch.setattr(chat_router.settings, "dashscope_api_key", "test-key")

    async def fail_502(*args, **kwargs):
        raise chat_router.UpstreamServiceError("Model API unavailable")

    monkeypatch.setattr(chat_router, "orchestrate_inference", fail_502)
    bad_gateway = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        json={"content": "hello"},
        headers=csrf_headers(client),
    )
    assert bad_gateway.status_code == 502
    assert bad_gateway.json()["error"]["code"] == "model_api_unavailable"
    assert bad_gateway.json()["error"]["details"]["retry_after"] == 5

    async def fail_503(*args, **kwargs):
        raise chat_router.InferenceTimeoutError("Inference timeout")

    monkeypatch.setattr(chat_router, "orchestrate_inference", fail_503)
    timeout = client.post(
        f"/api/v1/chat/conversations/{conversation_id}/messages",
        json={"content": "hello again"},
        headers=csrf_headers(client),
    )
    assert timeout.status_code == 503
    assert timeout.json()["error"]["code"] == "inference_timeout"


def test_authenticated_presign_endpoints_are_rate_limited(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "presign-limit@example.com", "Presign Limit")
    project = create_project(client, "Presign Project")
    dataset = create_dataset(client, project["id"], "Presign Dataset")

    monkeypatch.setattr(config_module.settings, "upload_presign_rate_limit_max", 2)
    monkeypatch.setattr(config_module.settings, "model_artifact_presign_rate_limit_max", 2)

    for index in range(2):
        resp = client.post(
            "/api/v1/uploads/presign",
            json={
                "dataset_id": dataset["id"],
                "filename": f"upload-{index}.jpg",
                "media_type": "image/jpeg",
                "size_bytes": 16,
            },
            headers=csrf_headers(client),
        )
        assert resp.status_code == 200

    upload_limited = client.post(
        "/api/v1/uploads/presign",
        json={
            "dataset_id": dataset["id"],
            "filename": "upload-over-limit.jpg",
            "media_type": "image/jpeg",
            "size_bytes": 16,
        },
        headers=csrf_headers(client),
    )
    assert upload_limited.status_code == 429
    assert upload_limited.json()["error"]["code"] == "rate_limited"

    model_resp = client.post(
        "/api/v1/models",
        json={"project_id": project["id"], "name": "Artifact Model", "task_type": "general"},
        headers=csrf_headers(client),
    )
    assert model_resp.status_code == 200
    model_id = model_resp.json()["model"]["id"]

    for index in range(2):
        resp = client.post(
            f"/api/v1/models/{model_id}/artifact-uploads/presign",
            json={
                "filename": f"artifact-{index}.json",
                "media_type": "application/json",
                "size_bytes": 16,
            },
            headers=csrf_headers(client),
        )
        assert resp.status_code == 200

    artifact_limited = client.post(
        f"/api/v1/models/{model_id}/artifact-uploads/presign",
        json={
            "filename": "artifact-over-limit.json",
            "media_type": "application/json",
            "size_bytes": 16,
        },
        headers=csrf_headers(client),
    )
    assert artifact_limited.status_code == 429
    assert artifact_limited.json()["error"]["code"] == "rate_limited"


def test_memory_stream_endpoint_is_rate_limited(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "memory-stream@example.com", "Memory Stream")
    project = create_project(client, "Memory Stream Project")

    monkeypatch.setattr(config_module.settings, "sse_rate_limit_max", 0)

    blocked = client.get(f"/api/v1/memory/{project['id']}/stream")
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "rate_limited"


def test_cleanup_pending_upload_session_skips_completed_items_when_task_replays(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "upload-replay@example.com", "Upload Replay")
    project = create_project(client, "Upload Replay Project")
    dataset = create_dataset(client, project["id"], "Upload Replay Dataset")

    payload_bytes, _ = upload_fixture("replay.jpg")
    presign = client.post(
        "/api/v1/uploads/presign",
        json={
            "dataset_id": dataset["id"],
            "filename": "replay.jpg",
            "media_type": "image/jpeg",
            "size_bytes": len(payload_bytes),
        },
        headers=csrf_headers(client),
    )
    assert presign.status_code == 200
    payload = presign.json()

    put_resp = client.put(
        payload["put_url"],
        content=payload_bytes,
        headers={**payload["headers"], **csrf_headers(client)},
    )
    assert put_resp.status_code == 200

    complete = client.post(
        "/api/v1/uploads/complete",
        json={"upload_id": payload["upload_id"], "data_item_id": payload["data_item_id"]},
        headers=csrf_headers(client),
    )
    assert complete.status_code == 200

    with SessionLocal() as db:
        item = db.get(DataItem, payload["data_item_id"])
        assert item is not None
        object_key = item.object_key

    deleted: list[tuple[str, str]] = []

    def fake_delete_object(*, bucket_name: str, object_key: str) -> None:
        deleted.append((bucket_name, object_key))

    monkeypatch.setattr(worker_tasks, "delete_object", fake_delete_object)

    worker_tasks.cleanup_pending_upload_session(payload["upload_id"], object_key, payload["data_item_id"])

    assert deleted == []


def test_cleanup_deleted_dataset_marks_failed_when_object_delete_fails(monkeypatch) -> None:
    client = TestClient(main_module.app)
    register_user(client, "cleanup-fail@example.com", "Cleanup Fail User")
    project = create_project(client, "Cleanup Fail Project")
    dataset = create_dataset(client, project["id"], "Cleanup Fail Dataset")
    data_item_id = upload_item(client, dataset["id"], "cleanup-fail.jpg")

    def fake_delete_object(*, bucket_name: str, object_key: str) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(worker_tasks, "delete_object", fake_delete_object)

    worker_tasks.cleanup_deleted_dataset(dataset["id"])

    with SessionLocal() as db:
        dataset_row = db.get(Dataset, dataset["id"])
        data_item = db.get(DataItem, data_item_id)
        assert dataset_row is not None
        assert dataset_row.cleanup_status == "failed"
        assert data_item is not None
        assert data_item.deleted_at is not None


def test_eval_run_requires_workspace_bound_resources() -> None:
    client = TestClient(main_module.app)
    register_user(client, "eval-resources@example.com", "Eval Resources")
    project = create_project(client, "Eval Project")
    dataset = create_dataset(client, project["id"], "Eval Dataset")
    upload_item(client, dataset["id"], "eval.jpg")
    dataset_version = commit_dataset(client, dataset["id"], "eval dataset")

    model_resp = client.post(
        "/api/v1/models",
        json={"project_id": project["id"], "name": "Eval Model", "task_type": "general"},
        headers=csrf_headers(client),
    )
    assert model_resp.status_code == 200
    model_id = model_resp.json()["model"]["id"]

    artifact_a = upload_model_artifact(client, model_id, "eval-a.json")
    version_a = client.post(
        f"/api/v1/models/{model_id}/versions",
        json={"run_id": None, "artifact_upload_id": artifact_a, "metrics_json": {"acc": 0.8}},
        headers=csrf_headers(client),
    )
    assert version_a.status_code == 200

    artifact_b = upload_model_artifact(client, model_id, "eval-b.json")
    version_b = client.post(
        f"/api/v1/models/{model_id}/versions",
        json={"run_id": None, "artifact_upload_id": artifact_b, "metrics_json": {"acc": 0.81}},
        headers=csrf_headers(client),
    )
    assert version_b.status_code == 200

    missing = client.post(
        "/api/v1/eval/runs",
        json={
            "model_version_a": "missing-model-version",
            "model_version_b": version_b.json()["model_version"]["id"],
            "dataset_version_id": dataset_version["id"],
        },
        headers=csrf_headers(client),
    )
    assert missing.status_code == 404

    success = client.post(
        "/api/v1/eval/runs",
        json={
            "model_version_a": version_a.json()["model_version"]["id"],
            "model_version_b": version_b.json()["model_version"]["id"],
            "dataset_version_id": dataset_version["id"],
        },
        headers=csrf_headers(client),
    )
    assert success.status_code == 200
    assert isinstance(success.json()["eval_id"], str)


def test_pipeline_get_backfills_missing_defaults_and_migrates_legacy_realtime_llm() -> None:
    client = TestClient(main_module.app)
    register_user(client, "pipeline-get@example.com", "Pipeline Get")
    project = create_project(client, "Pipeline Get Project")

    with SessionLocal() as db:
        vision = (
            db.query(PipelineConfig)
            .filter(PipelineConfig.project_id == project["id"], PipelineConfig.model_type == "vision")
            .first()
        )
        assert vision is not None
        db.delete(vision)
        llm = (
            db.query(PipelineConfig)
            .filter(PipelineConfig.project_id == project["id"], PipelineConfig.model_type == "llm")
            .first()
        )
        assert llm is not None
        llm.model_id = "qwen3-omni-flash-realtime"
        realtime = (
            db.query(PipelineConfig)
            .filter(PipelineConfig.project_id == project["id"], PipelineConfig.model_type == "realtime")
            .first()
        )
        assert realtime is not None
        db.delete(realtime)
        realtime_asr = (
            db.query(PipelineConfig)
            .filter(PipelineConfig.project_id == project["id"], PipelineConfig.model_type == "realtime_asr")
            .first()
        )
        assert realtime_asr is not None
        db.delete(realtime_asr)
        realtime_tts = (
            db.query(PipelineConfig)
            .filter(PipelineConfig.project_id == project["id"], PipelineConfig.model_type == "realtime_tts")
            .first()
        )
        assert realtime_tts is not None
        db.delete(realtime_tts)
        db.commit()
        assert db.query(PipelineConfig).filter(PipelineConfig.project_id == project["id"]).count() == 3

    current = client.get(f"/api/v1/pipeline?project_id={project['id']}")
    assert current.status_code == 200
    items = {item["model_type"]: item["model_id"] for item in current.json()["items"]}
    assert len(items) == 7
    assert items["llm"] == "qwen3.5-plus"
    assert items["vision"] == "qwen-vl-plus"
    assert items["realtime"] == "qwen3-omni-flash-realtime"
    assert items["realtime_asr"] == "qwen3-asr-flash-realtime"
    assert items["realtime_tts"] == "qwen3-tts-flash-realtime"

    with SessionLocal() as db:
        assert db.query(PipelineConfig).filter(PipelineConfig.project_id == project["id"]).count() == 7


def test_deleted_project_invalidates_conversation_and_memory_handles() -> None:
    client = TestClient(main_module.app)
    register_user(client, "deleted-project@example.com", "Deleted Project")
    project = create_project(client, "Deleted Project")

    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Deleted Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    memory = client.post(
        "/api/v1/memory",
        json={"project_id": project["id"], "content": "用户喜欢乌龙茶", "category": "偏好", "type": "permanent"},
        headers=csrf_headers(client),
    )
    assert memory.status_code == 200
    memory_id = memory.json()["id"]

    deleted = client.delete(
        f"/api/v1/projects/{project['id']}",
        headers=csrf_headers(client),
    )
    assert deleted.status_code == 200

    assert client.get(f"/api/v1/chat/conversations/{conversation_id}/messages").status_code == 404
    assert (
        client.post(
            f"/api/v1/chat/conversations/{conversation_id}/messages",
            json={"content": "should fail"},
            headers=csrf_headers(client),
        ).status_code
        == 404
    )
    assert client.get(f"/api/v1/memory/{memory_id}").status_code == 404
    assert client.get(f"/api/v1/memory/{project['id']}/stream").status_code == 404
    assert client.get(f"/api/v1/chat/conversations/{conversation_id}/memory-stream").status_code == 404


def test_promoted_private_memory_stays_hidden_from_other_members() -> None:
    owner = TestClient(main_module.app)
    owner_info = register_user(owner, "promote-owner@example.com", "Promote Owner")
    owner_workspace_id = owner_info["workspace"]["id"]
    project = create_project(owner, "Promote Project")

    conversation = owner.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Promote Thread"},
        headers=csrf_headers(owner),
    )
    assert conversation.status_code == 200
    conversation_id = conversation.json()["id"]

    temp_memory = owner.post(
        "/api/v1/memory",
        json={
            "project_id": project["id"],
            "content": "用户下周去东京出差",
            "category": "工作.计划",
            "type": "temporary",
            "source_conversation_id": conversation_id,
        },
        headers=csrf_headers(owner),
    )
    assert temp_memory.status_code == 200

    promoted = owner.post(
        f"/api/v1/memory/{temp_memory.json()['id']}/promote",
        headers=csrf_headers(owner),
    )
    assert promoted.status_code == 200
    promoted_id = promoted.json()["id"]

    viewer = TestClient(main_module.app)
    register_user(viewer, "promote-viewer@example.com", "Promote Viewer")
    add_workspace_membership(owner_workspace_id, "promote-viewer@example.com", "viewer")

    viewer_detail = viewer.get(
        f"/api/v1/memory/{promoted_id}",
        headers={"x-workspace-id": owner_workspace_id},
    )
    assert viewer_detail.status_code == 404

    viewer_graph = viewer.get(
        f"/api/v1/memory?project_id={project['id']}",
        headers={"x-workspace-id": owner_workspace_id},
    )
    assert viewer_graph.status_code == 200
    assert all(node["id"] != promoted_id for node in viewer_graph.json()["nodes"])

    owner_search = owner.post(
        "/api/v1/memory/search",
        json={"project_id": project["id"], "query": "东京"},
        headers={"x-workspace-id": owner_workspace_id},
    )
    assert owner_search.status_code == 200
    assert [item["memory"]["id"] for item in owner_search.json()] == [promoted_id]

    viewer_search = viewer.post(
        "/api/v1/memory/search",
        json={"project_id": project["id"], "query": "东京"},
        headers={"x-workspace-id": owner_workspace_id},
    )
    assert viewer_search.status_code == 200
    assert viewer_search.json() == []


def test_memory_detail_hides_deleted_dataset_files() -> None:
    client = TestClient(main_module.app)
    register_user(client, "memory-deleted-files@example.com", "Memory Deleted Files")
    project = create_project(client, "Memory Deleted Files Project")
    dataset = create_dataset(client, project["id"], "Memory Deleted Files Dataset")
    data_item_id = upload_item(client, dataset["id"], "hidden.jpg")

    memory = client.post(
        "/api/v1/memory",
        json={"project_id": project["id"], "content": "知识文件", "category": "资料", "type": "permanent"},
        headers=csrf_headers(client),
    )
    assert memory.status_code == 200
    memory_id = memory.json()["id"]

    attached = client.post(
        f"/api/v1/memory/{memory_id}/files",
        json={"data_item_id": data_item_id},
        headers=csrf_headers(client),
    )
    assert attached.status_code == 200

    deleted = client.delete(
        f"/api/v1/datasets/{dataset['id']}",
        headers=csrf_headers(client),
    )
    assert deleted.status_code == 200

    detail = client.get(f"/api/v1/memory/{memory_id}")
    assert detail.status_code == 200
    assert detail.json()["files"] == []

    graph = client.get(f"/api/v1/memory?project_id={project['id']}")
    assert graph.status_code == 200
    assert all(node.get("metadata_json", {}).get("node_kind") != "file" for node in graph.json()["nodes"])


def test_reset_password_for_missing_user_is_generic_after_valid_code() -> None:
    client = TestClient(main_module.app)
    code = issue_verification_code(client, "missing-reset@example.com", "reset")

    resp = client.post(
        "/api/v1/auth/reset-password",
        json={"email": "missing-reset@example.com", "password": "newpass1234pass", "code": code},
        headers=public_headers(),
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_orchestrator_filters_private_memory_embeddings_from_prompt(monkeypatch) -> None:
    owner = TestClient(main_module.app)
    owner_info = register_user(owner, "rag-owner@example.com", "Rag Owner")
    workspace_id = owner_info["workspace"]["id"]
    project = create_project(owner, "Rag Project")

    owner_conversation = owner.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Owner Thread"},
        headers=csrf_headers(owner),
    )
    assert owner_conversation.status_code == 200

    temp_memory = owner.post(
        "/api/v1/memory",
        json={
            "project_id": project["id"],
            "content": "私有事实-不要进入别人的prompt",
            "category": "测试",
            "type": "temporary",
            "source_conversation_id": owner_conversation.json()["id"],
        },
        headers=csrf_headers(owner),
    )
    assert temp_memory.status_code == 200

    promoted = owner.post(
        f"/api/v1/memory/{temp_memory.json()['id']}/promote",
        headers=csrf_headers(owner),
    )
    assert promoted.status_code == 200
    private_memory_id = promoted.json()["id"]

    viewer = TestClient(main_module.app)
    register_user(viewer, "rag-viewer@example.com", "Rag Viewer")
    add_workspace_membership(workspace_id, "rag-viewer@example.com", "editor")

    viewer_conversation = viewer.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Viewer Thread"},
        headers=csrf_headers(viewer, workspace_id),
    )
    assert viewer_conversation.status_code == 200

    captured: dict[str, str] = {}

    async def fake_search_similar(*args, **kwargs) -> list[dict]:
        return [
            {
                "id": "embedding-1",
                "chunk_text": "私有事实-不要进入别人的prompt",
                "memory_id": private_memory_id,
                "data_item_id": None,
                "score": 0.99,
            }
        ]

    async def fake_chat_completion_detailed(messages, model=None, enable_thinking=None):
        captured["system_prompt"] = messages[0]["content"]
        return SimpleNamespace(content="ok", reasoning_content=None)

    monkeypatch.setattr(orchestrator_service, "search_similar", fake_search_similar)
    monkeypatch.setattr(orchestrator_service, "chat_completion_detailed", fake_chat_completion_detailed)

    with SessionLocal() as db:
        result = asyncio.run(
            orchestrator_service.orchestrate_inference(
                db,
                workspace_id=workspace_id,
                project_id=project["id"],
                conversation_id=viewer_conversation.json()["id"],
                user_message="你记得什么",
                recent_messages=[],
            )
        )

    assert result["content"] == "ok"
    assert "私有事实-不要进入别人的prompt" not in captured["system_prompt"]


def test_orchestrator_includes_chunks_from_memory_linked_files(monkeypatch) -> None:
    client = TestClient(main_module.app)
    owner_info = register_user(client, "linked-rag@example.com", "Linked Rag")
    workspace_id = owner_info["workspace"]["id"]
    project = create_project(client, "Linked Rag Project")

    conversation = client.post(
        "/api/v1/chat/conversations",
        json={"project_id": project["id"], "title": "Linked Thread"},
        headers=csrf_headers(client),
    )
    assert conversation.status_code == 200

    memory = client.post(
        "/api/v1/memory",
        json={"project_id": project["id"], "content": "心理学"},
        headers=csrf_headers(client),
    )
    assert memory.status_code == 200

    captured: dict[str, str] = {}

    async def fake_search_similar(*args, **kwargs) -> list[dict]:
        return [
            {
                "id": "embedding-memory-1",
                "chunk_text": "心理学",
                "memory_id": memory.json()["id"],
                "data_item_id": None,
                "score": 0.98,
            }
        ]

    async def fake_load_linked_file_chunks_for_memories(*args, **kwargs) -> list[dict]:
        return [
            {
                "id": "chunk-1",
                "chunk_text": "文件里提到：认知行为疗法适用于焦虑干预。",
                "data_item_id": "data-item-1",
                "filename": "心理学手册.pdf",
                "score": 0.91,
                "memory_ids": [memory.json()["id"]],
            }
        ]

    async def fake_chat_completion_detailed(messages, model=None, enable_thinking=None):
        captured["system_prompt"] = messages[0]["content"]
        return SimpleNamespace(content="ok", reasoning_content=None)

    monkeypatch.setattr(orchestrator_service, "search_similar", fake_search_similar)
    monkeypatch.setattr(
        orchestrator_service,
        "load_linked_file_chunks_for_memories",
        fake_load_linked_file_chunks_for_memories,
    )
    monkeypatch.setattr(orchestrator_service, "chat_completion_detailed", fake_chat_completion_detailed)

    with SessionLocal() as db:
        result = asyncio.run(
            orchestrator_service.orchestrate_inference(
                db,
                workspace_id=workspace_id,
                project_id=project["id"],
                conversation_id=conversation.json()["id"],
                user_message="请结合心理学资料回答",
                recent_messages=[],
            )
        )

    assert result["content"] == "ok"
    assert "与当前相关记忆直接关联的资料摘录" in captured["system_prompt"]
    assert "心理学手册.pdf" in captured["system_prompt"]
    assert "认知行为疗法适用于焦虑干预" in captured["system_prompt"]

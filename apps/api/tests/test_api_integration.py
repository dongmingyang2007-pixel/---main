# ruff: noqa: E402

import atexit
import asyncio
import hashlib
import importlib
import os
from pathlib import Path
import shutil
import tempfile

from botocore.exceptions import ClientError
from fastapi.testclient import TestClient
import pytest

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
import app.routers.uploads as uploads_router
import app.services.memory_file_context as memory_file_context_service
import app.services.orchestrator as orchestrator_service
from app.core.config import settings
from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models import (
    AuditLog,
    Conversation,
    DataItem,
    Dataset,
    Membership,
    MemoryFile,
    ModelVersion,
    PipelineConfig,
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
        json={"name": name, "description": "demo"},
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


def upload_item(client: TestClient, dataset_id: str, filename: str) -> str:
    payload_bytes = b"fake-image-content"
    presign = client.post(
        "/api/v1/uploads/presign",
        json={
            "dataset_id": dataset_id,
            "filename": filename,
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


def test_conversation_access_respects_role_and_creator_boundary() -> None:
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

    payload_bytes = b"fake-image-content"
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

    payload_bytes = b"fake-image-content"
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
    payload_bytes = b"fake-demo-png"
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
    payload_bytes = b"fake-demo-png"

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


def test_send_message_rate_limit_triggers_after_ten_requests() -> None:
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
    assert payload["input_modalities"] == ["text", "image"]
    assert payload["output_modalities"] == ["text"]
    assert payload["supports_function_calling"] is True
    assert payload["supports_web_search"] is True
    assert payload["supports_structured_output"] is True
    assert payload["supports_cache"] is True
    assert payload["price_unit"] == "tokens"


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

    payload_bytes = b"fake-image-content"
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


def test_pipeline_get_does_not_persist_missing_defaults() -> None:
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
        db.commit()
        assert db.query(PipelineConfig).filter(PipelineConfig.project_id == project["id"]).count() == 3

    current = client.get(f"/api/v1/pipeline?project_id={project['id']}")
    assert current.status_code == 200
    assert len(current.json()["items"]) == 4

    with SessionLocal() as db:
        assert db.query(PipelineConfig).filter(PipelineConfig.project_id == project["id"]).count() == 3


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

    async def fake_chat_completion(messages, model=None):
        captured["system_prompt"] = messages[0]["content"]
        return "ok"

    monkeypatch.setattr(orchestrator_service, "search_similar", fake_search_similar)
    monkeypatch.setattr(orchestrator_service, "chat_completion", fake_chat_completion)

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

    assert result == "ok"
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

    async def fake_chat_completion(messages, model=None):
        captured["system_prompt"] = messages[0]["content"]
        return "ok"

    monkeypatch.setattr(orchestrator_service, "search_similar", fake_search_similar)
    monkeypatch.setattr(
        orchestrator_service,
        "load_linked_file_chunks_for_memories",
        fake_load_linked_file_chunks_for_memories,
    )
    monkeypatch.setattr(orchestrator_service, "chat_completion", fake_chat_completion)

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

    assert result == "ok"
    assert "与当前相关记忆直接关联的资料摘录" in captured["system_prompt"]
    assert "心理学手册.pdf" in captured["system_prompt"]
    assert "认知行为疗法适用于焦虑干预" in captured["system_prompt"]

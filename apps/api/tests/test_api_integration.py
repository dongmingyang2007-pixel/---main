# ruff: noqa: E402

import atexit
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

from app.db.base import Base
from app.db.session import SessionLocal, engine
from app.models import AuditLog
from app.services import storage as storage_service
from app.services.runtime_state import runtime_state

ORIGIN = "http://localhost:3000"


def setup_function() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with runtime_state._memory._lock:
        runtime_state._memory._data.clear()


def public_headers() -> dict[str, str]:
    return {"origin": ORIGIN}


def csrf_headers(client: TestClient, workspace_id: str | None = None) -> dict[str, str]:
    resp = client.get("/api/v1/auth/csrf", headers=public_headers())
    assert resp.status_code == 200
    headers = {"origin": ORIGIN, "x-csrf-token": resp.json()["csrf_token"]}
    if workspace_id:
        headers["x-workspace-id"] = workspace_id
    return headers


def register_user(client: TestClient, email: str, display_name: str = "User") -> dict:
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "pass1234pass", "display_name": display_name},
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
    resp = client.post(
        "/api/v1/auth/register",
        json={"email": "u1@example.com", "password": "pass1234pass", "display_name": "U1"},
        headers=public_headers(),
    )
    assert resp.status_code == 200
    assert "access_token" in resp.cookies

    me = client.get("/api/v1/auth/me")
    assert me.status_code == 200
    data = me.json()
    assert data["email"] == "u1@example.com"


def test_unauthorized_error_shape() -> None:
    client = TestClient(main_module.app)
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 401
    err = resp.json()["error"]
    assert err["code"] == "unauthorized"
    assert isinstance(err["request_id"], str)
    assert err["request_id"]


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
        json={"email": "origin@example.com", "password": "pass1234pass", "display_name": "Origin"},
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "origin_required"


def test_csrf_required_for_authenticated_mutations() -> None:
    client = TestClient(main_module.app)
    register_user(client, "csrf@example.com", "CSRF User")
    resp = client.post("/api/v1/projects", json={"name": "P1", "description": "demo"}, headers=public_headers())
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "csrf_required"


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

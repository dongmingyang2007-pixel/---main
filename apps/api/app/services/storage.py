from __future__ import annotations

from functools import lru_cache
import json
import os
import re
from uuid import uuid4

import boto3
from botocore.client import BaseClient

from app.core.config import settings


@lru_cache(maxsize=1)
def get_s3_client() -> BaseClient:
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
    )


@lru_cache(maxsize=1)
def get_s3_presign_client() -> BaseClient:
    endpoint = settings.s3_presign_endpoint or settings.s3_endpoint
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
    )


def build_data_item_object_key(
    workspace_id: str,
    project_id: str,
    dataset_id: str,
    data_item_id: str,
    filename: str,
) -> str:
    return (
        f"workspaces/{workspace_id}/projects/{project_id}/datasets/{dataset_id}/items/"
        f"{data_item_id}/raw/{sanitize_filename(filename)}"
    )


def build_demo_object_key(request_id: str, filename: str) -> str:
    return f"demo/requests/{request_id}/input/{sanitize_filename(filename)}"


def build_run_artifact_object_key(workspace_id: str, project_id: str, run_id: str, filename: str) -> str:
    return (
        f"workspaces/{workspace_id}/projects/{project_id}/runs/{run_id}/artifacts/"
        f"{sanitize_filename(filename)}"
    )


def build_manual_model_artifact_object_key(
    workspace_id: str,
    project_id: str,
    model_id: str,
    artifact_upload_id: str,
    filename: str,
) -> str:
    return (
        f"workspaces/{workspace_id}/projects/{project_id}/models/{model_id}/manual/"
        f"{artifact_upload_id}/{sanitize_filename(filename)}"
    )


def sanitize_filename(filename: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]", "_", filename.strip())
    return cleaned or f"file-{uuid4().hex[:8]}"


def normalize_media_type(media_type: str) -> str:
    return media_type.split(";", 1)[0].strip().lower()


def create_presigned_put(
    *,
    bucket_name: str,
    object_key: str,
    media_type: str,
    expires_seconds: int | None = None,
) -> tuple[str, dict[str, str]]:
    client = get_s3_presign_client()
    put_url = client.generate_presigned_url(
        ClientMethod="put_object",
        Params={"Bucket": bucket_name, "Key": object_key, "ContentType": media_type},
        ExpiresIn=expires_seconds or settings.s3_presign_expire_seconds,
    )
    return put_url, {"Content-Type": media_type}


def create_presigned_get(
    *,
    bucket_name: str,
    object_key: str,
    download_name: str | None = None,
    expires_seconds: int | None = None,
) -> str:
    client = get_s3_presign_client()
    params = {"Bucket": bucket_name, "Key": object_key}
    if download_name:
        params["ResponseContentDisposition"] = f'attachment; filename="{sanitize_filename(download_name)}"'
    return client.generate_presigned_url(
        ClientMethod="get_object",
        Params=params,
        ExpiresIn=expires_seconds or settings.s3_presign_expire_seconds,
    )


def put_object_bytes(*, bucket_name: str, object_key: str, payload: bytes, media_type: str) -> None:
    client = get_s3_client()
    client.put_object(
        Bucket=bucket_name,
        Key=object_key,
        Body=payload,
        ContentType=media_type,
    )


def put_json_object(*, bucket_name: str, object_key: str, payload: dict) -> None:
    client = get_s3_client()
    client.put_object(
        Bucket=bucket_name,
        Key=object_key,
        Body=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        ContentType="application/json",
    )


def get_object_metadata(*, bucket_name: str, object_key: str) -> dict[str, int | str] | None:
    if settings.env == "test":
        return None

    client = get_s3_client()
    try:
        response = client.head_object(Bucket=bucket_name, Key=object_key)
    except Exception:  # noqa: BLE001
        return None
    return {
        "size_bytes": int(response.get("ContentLength", 0)),
        "media_type": normalize_media_type(response.get("ContentType", "application/octet-stream")),
    }


def uploaded_object_matches(
    metadata: dict[str, int | str] | None,
    *,
    expected_size_bytes: int,
    expected_media_type: str,
) -> bool:
    if not metadata:
        return False
    return int(metadata.get("size_bytes", 0)) == expected_size_bytes and normalize_media_type(
        str(metadata.get("media_type", "application/octet-stream"))
    ) == normalize_media_type(expected_media_type)


def object_exists(*, bucket_name: str, object_key: str) -> bool:
    if settings.env == "test":
        return True

    client = get_s3_client()
    try:
        client.head_object(Bucket=bucket_name, Key=object_key)
    except Exception:  # noqa: BLE001
        return False
    return True


def delete_object(*, bucket_name: str, object_key: str) -> None:
    if settings.env == "test":
        return
    client = get_s3_client()
    client.delete_object(Bucket=bucket_name, Key=object_key)


def build_download_name_from_object_key(object_key: str) -> str:
    basename = os.path.basename(object_key.strip("/"))
    return basename or "download.bin"


def build_upload_id() -> str:
    return str(uuid4())

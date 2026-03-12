from __future__ import annotations

from tempfile import SpooledTemporaryFile

from fastapi import Request

from app.core.errors import ApiError
from app.services.storage import delete_object, get_object_metadata, uploaded_object_matches


def ensure_uploaded_object_matches(
    *,
    bucket_name: str,
    object_key: str,
    expected_size_bytes: int,
    expected_media_type: str,
    missing_message: str,
    mismatch_message: str,
) -> None:
    metadata = get_object_metadata(bucket_name=bucket_name, object_key=object_key)
    if not metadata:
        raise ApiError("upload_incomplete", missing_message, status_code=400)
    if uploaded_object_matches(
        metadata,
        expected_size_bytes=expected_size_bytes,
        expected_media_type=expected_media_type,
    ):
        return
    delete_object(bucket_name=bucket_name, object_key=object_key)
    raise ApiError("upload_mismatch", mismatch_message, status_code=400)


async def read_upload_body(request: Request, *, expected_size: int, max_bytes: int) -> bytes:
    header_length = request.headers.get("content-length")
    if not header_length:
        raise ApiError("length_required", "Content-Length header is required", status_code=411)
    try:
        content_length = int(header_length)
    except ValueError as exc:
        raise ApiError("invalid_length", "Invalid Content-Length header", status_code=400) from exc
    if content_length <= 0:
        raise ApiError("empty_body", "Empty upload payload", status_code=400)
    if content_length != expected_size:
        raise ApiError("length_mismatch", "Content-Length does not match declared file size", status_code=400)
    if content_length > max_bytes:
        raise ApiError("payload_too_large", "Upload payload exceeds size limit", status_code=413)

    total = 0
    with SpooledTemporaryFile(max_size=max_bytes) as temp_file:
        async for chunk in request.stream():
            if not chunk:
                continue
            total += len(chunk)
            if total > max_bytes:
                raise ApiError("payload_too_large", "Upload payload exceeds size limit", status_code=413)
            temp_file.write(chunk)
        if total != expected_size:
            raise ApiError("length_mismatch", "Uploaded body size does not match declared file size", status_code=400)
        temp_file.seek(0)
        return temp_file.read()

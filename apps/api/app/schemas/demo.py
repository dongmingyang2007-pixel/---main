from typing import Literal

from pydantic import BaseModel, field_validator


class DemoInferRequest(BaseModel):
    request_id: str
    task: Literal["vqa", "ocr"]
    prompt: str
    locale: str = "zh-CN"

    @field_validator("prompt")
    @classmethod
    def _trim_prompt(cls, value: str) -> str:
        return value.strip()


class DemoInferResponse(BaseModel):
    request_id: str
    task: str
    latency_ms: int
    outputs: dict
    ui_cards: dict


class DemoUploadPresignRequest(BaseModel):
    filename: str
    media_type: str
    size_bytes: int


class DemoUploadPresignResponse(BaseModel):
    request_id: str
    upload_id: str
    put_url: str
    headers: dict[str, str]

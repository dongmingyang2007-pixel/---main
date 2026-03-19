from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db_session
from app.core.errors import ApiError
from app.models import ModelCatalog, User
from app.schemas.model_catalog import ModelCatalogDetailOut, ModelCatalogOut

router = APIRouter(prefix="/api/v1/models/catalog", tags=["model-catalog"])

PROVIDER_DISPLAY_NAMES = {
    "qwen": "千问 · 阿里云",
    "alibaba": "千问 · 阿里云",
    "deepseek": "DeepSeek",
}

MODEL_DETAIL_OVERRIDES: dict[str, dict[str, object]] = {
    "qwen3.5-flash": {
        "supports_structured_output": True,
        "supports_cache": True,
    },
    "qwen3.5-plus": {
        "supports_structured_output": True,
        "supports_cache": True,
    },
    "qwen3-max": {
        "supports_structured_output": True,
        "supports_cache": True,
    },
    "deepseek-v3.2": {
        "supports_structured_output": True,
        "supports_cache": True,
    },
    "deepseek-r1": {
        "supports_structured_output": False,
        "supports_cache": False,
    },
    "qwen3-omni-flash-realtime": {
        "supports_structured_output": False,
        "supports_cache": False,
    },
    "paraformer-v2": {
        "price_unit": "audio",
        "price_note": "免费额度",
    },
    "sensevoice-v1": {
        "price_unit": "audio",
        "price_note": "免费额度",
    },
    "cosyvoice-v1": {
        "price_unit": "characters",
        "price_note": "按字符计费",
    },
    "sambert-v1": {
        "price_unit": "characters",
        "price_note": "按字符计费",
    },
}


def _provider_display_name(provider: str) -> str:
    key = (provider or "").lower()
    for prefix, label in PROVIDER_DISPLAY_NAMES.items():
        if key.startswith(prefix) or prefix in key:
            return label
    return provider


def _derive_modalities(item: ModelCatalog) -> tuple[list[str], list[str]]:
    capabilities = set(item.capabilities or [])

    if item.category == "llm":
        input_modalities = ["text"]
        if "vision" in capabilities:
            input_modalities.append("image")
        if "video" in capabilities:
            input_modalities.append("video")
        if "audio_input" in capabilities:
            input_modalities.append("audio")
        output_modalities = ["text"]
        if "audio_output" in capabilities:
            output_modalities.append("audio")
        return input_modalities, output_modalities

    if item.category == "asr":
        return ["audio"], ["text"]

    if item.category == "tts":
        return ["text"], ["audio"]

    if item.category == "vision":
        input_modalities = ["image"]
        if "video" in capabilities:
            input_modalities.append("video")
        return input_modalities, ["text"]

    return ["text"], ["text"]


def _build_catalog_detail(item: ModelCatalog) -> ModelCatalogDetailOut:
    capabilities = set(item.capabilities or [])
    overrides = MODEL_DETAIL_OVERRIDES.get(item.model_id, {})
    input_modalities, output_modalities = _derive_modalities(item)

    supports_function_calling = "function_calling" in capabilities
    supports_web_search = "web_search" in capabilities
    supports_structured_output = bool(
        overrides.get(
            "supports_structured_output",
            item.category == "llm" and "reasoning_chain" not in capabilities,
        )
    )
    supports_cache = bool(
        overrides.get(
            "supports_cache",
            item.category == "llm" and "realtime" not in capabilities,
        )
    )

    return ModelCatalogDetailOut(
        **ModelCatalogOut.model_validate(item, from_attributes=True).model_dump(),
        provider_display=_provider_display_name(item.provider),
        input_modalities=input_modalities,
        output_modalities=output_modalities,
        supports_function_calling=supports_function_calling,
        supports_web_search=supports_web_search,
        supports_structured_output=supports_structured_output,
        supports_cache=supports_cache,
        batch_input_price=overrides.get("batch_input_price"),
        batch_output_price=overrides.get("batch_output_price"),
        cache_read_price=overrides.get("cache_read_price"),
        cache_write_price=overrides.get("cache_write_price"),
        price_unit=str(overrides.get("price_unit", "tokens")),
        price_note=overrides.get("price_note"),
    )


@router.get("", response_model=list[ModelCatalogOut])
def list_catalog(
    category: str | None = Query(default=None),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[ModelCatalogOut]:
    _ = current_user
    query = db.query(ModelCatalog).filter(ModelCatalog.is_active.is_(True))
    if category:
        query = query.filter(ModelCatalog.category == category.lower())
    items = query.order_by(ModelCatalog.sort_order).all()
    return [ModelCatalogOut.model_validate(item, from_attributes=True) for item in items]


@router.get("/{model_id}", response_model=ModelCatalogDetailOut)
def get_catalog_item(
    model_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> ModelCatalogDetailOut:
    _ = current_user
    item = (
        db.query(ModelCatalog)
        .filter(
            or_(ModelCatalog.model_id == model_id, ModelCatalog.id == model_id),
            ModelCatalog.is_active.is_(True),
        )
        .first()
    )
    if not item:
        raise ApiError("not_found", "Model not found in catalog", status_code=404)
    return _build_catalog_detail(item)

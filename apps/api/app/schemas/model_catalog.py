from datetime import datetime
from typing import Any

from pydantic import BaseModel


class ModelCatalogOut(BaseModel):
    id: str
    model_id: str
    display_name: str
    provider: str
    category: str
    description: str
    capabilities: list[Any]
    context_window: int
    max_output: int
    input_price: float
    output_price: float
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime


class ModelCatalogDetailOut(ModelCatalogOut):
    provider_display: str
    input_modalities: list[str]
    output_modalities: list[str]
    supports_function_calling: bool
    supports_web_search: bool
    supports_structured_output: bool
    supports_cache: bool
    batch_input_price: float | None = None
    batch_output_price: float | None = None
    cache_read_price: float | None = None
    cache_write_price: float | None = None
    price_unit: str
    price_note: str | None = None

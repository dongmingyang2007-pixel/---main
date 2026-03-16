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

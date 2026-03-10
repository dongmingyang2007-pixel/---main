from datetime import datetime
from typing import Any

from pydantic import BaseModel


class TrainingJobCreate(BaseModel):
    project_id: str
    dataset_version_id: str
    recipe: str
    params_json: dict[str, Any] = {}


class TrainingJobOut(BaseModel):
    id: str
    project_id: str
    dataset_version_id: str
    recipe: str
    status: str
    params_json: dict[str, Any]
    summary_json: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class TrainingEvent(BaseModel):
    event: str
    data: dict[str, Any]

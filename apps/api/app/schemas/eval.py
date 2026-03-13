from pydantic import BaseModel, ConfigDict


class EvalRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_version_a: str
    model_version_b: str
    dataset_version_id: str

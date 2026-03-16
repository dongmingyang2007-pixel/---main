from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_current_workspace_id, get_db_session, require_csrf_protection
from app.core.errors import ApiError
from app.models import ModelCatalog, PipelineConfig, Project, User
from app.schemas.pipeline import PipelineConfigOut, PipelineConfigUpdate, PipelineOut

router = APIRouter(prefix="/api/v1/pipeline", tags=["pipeline"])


def _verify_project_ownership(db: Session, project_id: str, workspace_id: str) -> Project:
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.workspace_id == workspace_id, Project.deleted_at.is_(None))
        .first()
    )
    if not project:
        raise ApiError("not_found", "Project not found", status_code=404)
    return project


@router.get("", response_model=PipelineOut)
def get_pipeline(
    project_id: str = Query(...),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
) -> PipelineOut:
    _ = current_user
    _verify_project_ownership(db, project_id, workspace_id)

    configs = (
        db.query(PipelineConfig)
        .filter(PipelineConfig.project_id == project_id)
        .order_by(PipelineConfig.model_type)
        .all()
    )
    return PipelineOut(
        items=[PipelineConfigOut.model_validate(c, from_attributes=True) for c in configs],
    )


@router.patch("", response_model=PipelineConfigOut)
def upsert_pipeline_config(
    payload: PipelineConfigUpdate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> PipelineConfigOut:
    _verify_project_ownership(db, payload.project_id, workspace_id)

    # Validate that the model_id exists in the catalog
    catalog_entry = db.query(ModelCatalog).filter(ModelCatalog.model_id == payload.model_id).first()
    if not catalog_entry:
        raise ApiError("invalid_model", "Model not found in catalog", status_code=400)

    now = datetime.now(timezone.utc)

    # Upsert using INSERT ON CONFLICT
    from uuid import uuid4

    new_id = str(uuid4())
    db.execute(
        text(
            """
            INSERT INTO pipeline_configs (id, project_id, model_type, model_id, config_json, created_at, updated_at)
            VALUES (:id, :project_id, :model_type, :model_id, :config_json::jsonb, :now, :now)
            ON CONFLICT (project_id, model_type) DO UPDATE SET
                model_id = EXCLUDED.model_id,
                config_json = EXCLUDED.config_json,
                updated_at = EXCLUDED.updated_at
            """
        ),
        {
            "id": new_id,
            "project_id": payload.project_id,
            "model_type": payload.model_type,
            "model_id": payload.model_id,
            "config_json": "{}",
            "now": now,
        },
    )

    # Auto-create vision config if setting a non-vision LLM and no vision config exists
    if payload.model_type == "llm":
        existing_vision = (
            db.query(PipelineConfig)
            .filter(PipelineConfig.project_id == payload.project_id, PipelineConfig.model_type == "vision")
            .first()
        )
        if not existing_vision:
            vision_id = str(uuid4())
            db.execute(
                text(
                    """
                    INSERT INTO pipeline_configs (id, project_id, model_type, model_id, config_json, created_at, updated_at)
                    VALUES (:id, :project_id, 'vision', 'qwen-vl-plus', '{}'::jsonb, :now, :now)
                    ON CONFLICT (project_id, model_type) DO NOTHING
                    """
                ),
                {
                    "id": vision_id,
                    "project_id": payload.project_id,
                    "now": now,
                },
            )

    db.commit()

    # Fetch the upserted row
    config = (
        db.query(PipelineConfig)
        .filter(PipelineConfig.project_id == payload.project_id, PipelineConfig.model_type == payload.model_type)
        .first()
    )
    return PipelineConfigOut.model_validate(config, from_attributes=True)

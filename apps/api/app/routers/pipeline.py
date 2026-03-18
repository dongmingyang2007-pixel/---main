from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import (
    get_current_user,
    get_current_workspace_id,
    get_db_session,
    require_csrf_protection,
    require_workspace_write_access,
)
from app.core.errors import ApiError
from app.models import ModelCatalog, PipelineConfig, Project, User
from app.schemas.pipeline import PipelineConfigOut, PipelineConfigUpdate, PipelineOut

router = APIRouter(prefix="/api/v1/pipeline", tags=["pipeline"])

PIPELINE_SLOT_ORDER = ("llm", "asr", "tts", "vision")
DEFAULT_PIPELINE_MODELS = {
    "llm": "qwen3.5-plus",
    "asr": "paraformer-v2",
    "tts": "cosyvoice-v1",
    "vision": "qwen-vl-plus",
}


def _verify_project_ownership(db: Session, project_id: str, workspace_id: str) -> Project:
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.workspace_id == workspace_id, Project.deleted_at.is_(None))
        .first()
    )
    if not project:
        raise ApiError("not_found", "Project not found", status_code=404)
    return project


def _ensure_pipeline_defaults(db: Session, project_id: str) -> bool:
    existing = {
        config.model_type: config
        for config in db.query(PipelineConfig).filter(PipelineConfig.project_id == project_id).all()
    }
    now = datetime.now(timezone.utc)
    changed = False

    for model_type in PIPELINE_SLOT_ORDER:
        if model_type in existing:
            continue
        db.add(
            PipelineConfig(
                project_id=project_id,
                model_type=model_type,
                model_id=DEFAULT_PIPELINE_MODELS[model_type],
                config_json={},
                created_at=now,
                updated_at=now,
            )
        )
        changed = True

    if changed:
        db.flush()
    return changed


def _build_pipeline_items(
    *,
    project: Project,
    configs: list[PipelineConfig],
) -> list[PipelineConfigOut]:
    now = datetime.now(timezone.utc)
    configs_by_type = {config.model_type: config for config in configs}
    items: list[PipelineConfigOut] = []
    for model_type in PIPELINE_SLOT_ORDER:
        config = configs_by_type.get(model_type)
        if config:
            items.append(PipelineConfigOut.model_validate(config, from_attributes=True))
            continue
        items.append(
            PipelineConfigOut(
                id=f"default:{project.id}:{model_type}",
                project_id=project.id,
                model_type=model_type,
                model_id=DEFAULT_PIPELINE_MODELS[model_type],
                config_json={},
                created_at=project.created_at or now,
                updated_at=project.updated_at or project.created_at or now,
            )
        )
    return items


@router.get("", response_model=PipelineOut)
def get_pipeline(
    project_id: str = Query(...),
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
) -> PipelineOut:
    _ = current_user
    project = _verify_project_ownership(db, project_id, workspace_id)

    configs = db.query(PipelineConfig).filter(PipelineConfig.project_id == project_id).all()
    return PipelineOut(items=_build_pipeline_items(project=project, configs=configs))


@router.patch("", response_model=PipelineConfigOut)
@router.put("", response_model=PipelineConfigOut)
def upsert_pipeline_config(
    payload: PipelineConfigUpdate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _: None = Depends(require_csrf_protection),
) -> PipelineConfigOut:
    _verify_project_ownership(db, payload.project_id, workspace_id)
    _ensure_pipeline_defaults(db, payload.project_id)

    # Validate that the model_id exists in the catalog
    catalog_entry = db.query(ModelCatalog).filter(ModelCatalog.model_id == payload.model_id).first()
    if not catalog_entry:
        raise ApiError("invalid_model", "Model not found in catalog", status_code=400)
    if catalog_entry.category != payload.model_type:
        raise ApiError("invalid_model_type", "Model category does not match pipeline slot", status_code=400)

    now = datetime.now(timezone.utc)
    config = (
        db.query(PipelineConfig)
        .filter(
            PipelineConfig.project_id == payload.project_id,
            PipelineConfig.model_type == payload.model_type,
        )
        .first()
    )
    if config is None:
        config = PipelineConfig(
            project_id=payload.project_id,
            model_type=payload.model_type,
            model_id=payload.model_id,
            config_json=payload.config_json or {},
        )
        config.created_at = now
        db.add(config)
    else:
        config.model_id = payload.model_id
        config.config_json = payload.config_json or {}
    config.updated_at = now

    db.commit()
    db.refresh(config)
    return PipelineConfigOut.model_validate(config, from_attributes=True)

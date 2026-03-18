from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import (
    get_current_user,
    get_current_workspace_id,
    get_db_session,
    require_csrf_protection,
    require_workspace_write_access,
)
from app.core.errors import ApiError
from app.models import PipelineConfig, Project, User
from app.schemas.project import PaginatedProjects, ProjectCreate, ProjectOut, ProjectUpdate
from app.services.audit import write_audit_log
from app.tasks.worker_tasks import cleanup_deleted_project


router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


@router.get("", response_model=PaginatedProjects)
def list_projects(
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
) -> PaginatedProjects:
    _ = current_user
    query = db.query(Project).filter(Project.workspace_id == workspace_id, Project.deleted_at.is_(None))
    items = query.order_by(Project.created_at.desc()).all()
    return PaginatedProjects(
        items=[ProjectOut.model_validate(item, from_attributes=True) for item in items],
        total=len(items),
    )


@router.post("", response_model=ProjectOut)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _: None = Depends(require_csrf_protection),
) -> ProjectOut:
    project = Project(workspace_id=workspace_id, name=payload.name, description=payload.description)
    db.add(project)
    db.flush()

    db.add_all(
        [
            PipelineConfig(
                project_id=project.id,
                model_type="llm",
                model_id="qwen3.5-plus",
                config_json={},
            ),
            PipelineConfig(
                project_id=project.id,
                model_type="asr",
                model_id="paraformer-v2",
                config_json={},
            ),
            PipelineConfig(
                project_id=project.id,
                model_type="tts",
                model_id="cosyvoice-v1",
                config_json={},
            ),
            PipelineConfig(
                project_id=project.id,
                model_type="vision",
                model_id="qwen-vl-plus",
                config_json={},
            ),
        ]
    )
    write_audit_log(
        db,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        action="project.create",
        target_type="project",
        target_id=project.id,
    )
    db.commit()
    db.refresh(project)
    return ProjectOut.model_validate(project, from_attributes=True)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: str,
    db: Session = Depends(get_db_session),
    workspace_id: str = Depends(get_current_workspace_id),
) -> ProjectOut:
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.workspace_id == workspace_id, Project.deleted_at.is_(None))
        .first()
    )
    if not project:
        raise ApiError("not_found", "Project not found", status_code=404)
    return ProjectOut.model_validate(project, from_attributes=True)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: str,
    payload: ProjectUpdate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _: None = Depends(require_csrf_protection),
) -> ProjectOut:
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.workspace_id == workspace_id, Project.deleted_at.is_(None))
        .first()
    )
    if not project:
        raise ApiError("not_found", "Project not found", status_code=404)

    if payload.name is not None:
        project.name = payload.name
    if payload.description is not None:
        project.description = payload.description
    project.updated_at = datetime.now(timezone.utc)

    write_audit_log(
        db,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        action="project.update",
        target_type="project",
        target_id=project.id,
    )
    db.commit()
    db.refresh(project)
    return ProjectOut.model_validate(project, from_attributes=True)


@router.delete("/{project_id}")
def delete_project(
    project_id: str,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _: None = Depends(require_csrf_protection),
) -> dict:
    project = (
        db.query(Project)
        .filter(Project.id == project_id, Project.workspace_id == workspace_id, Project.deleted_at.is_(None))
        .first()
    )
    if not project:
        raise ApiError("not_found", "Project not found", status_code=404)

    project.deleted_at = datetime.now(timezone.utc)
    project.cleanup_status = "pending"
    write_audit_log(
        db,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        action="project.delete_requested",
        target_type="project",
        target_id=project.id,
    )
    db.commit()
    try:
        cleanup_deleted_project.delay(project.id)
    except Exception:  # noqa: BLE001
        cleanup_deleted_project(project.id)
    return {"ok": True, "status": "accepted"}

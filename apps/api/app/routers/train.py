import asyncio
import json
import os

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import (
    enforce_rate_limit,
    get_client_ip,
    get_current_user,
    get_current_workspace_id,
    get_db_session,
    require_csrf_protection,
)
from app.core.errors import ApiError
from app.core.sanitize import strip_object_key_fields
from app.models import Artifact, Dataset, Metric, Project, TrainingJob, TrainingRun, User
from app.routers.utils import (
    get_dataset_in_workspace,
    get_dataset_version_in_workspace,
    get_project_in_workspace,
    get_training_job_in_workspace,
    get_training_run_in_workspace,
)
from app.schemas.train import TrainingJobCreate
from app.services.audit import write_audit_log
from app.services.storage import create_presigned_get
from app.tasks.worker_tasks import run_training_job


router = APIRouter(prefix="/api/v1/train", tags=["train"])


def _job_to_dict(db: Session, job: TrainingJob, workspace_id: str) -> dict:
    run = (
        db.query(TrainingRun)
        .filter(TrainingRun.training_job_id == job.id)
        .order_by(TrainingRun.created_at.desc())
        .first()
    )
    metrics = []
    artifacts = []
    if run:
        metrics = (
            db.query(Metric)
            .filter(Metric.run_id == run.id)
            .order_by(Metric.step.asc())
            .all()
        )
        artifacts = (
            db.query(Artifact)
            .filter(Artifact.run_id == run.id)
            .order_by(Artifact.created_at.desc())
            .all()
        )
    return {
        "id": job.id,
        "project_id": job.project_id,
        "dataset_version_id": job.dataset_version_id,
        "recipe": job.recipe,
        "status": job.status,
        "params_json": job.params_json,
        "summary_json": {
            **(job.summary_json or {}),
            "run_id": run.id if run else None,
            "run_status": run.status if run else None,
            "metrics": [{"key": m.key, "value": m.value, "step": m.step} for m in metrics],
            "artifacts": [
                {
                    "id": a.id,
                    "name": a.name,
                    "download_url": create_presigned_get(
                        bucket_name=settings.s3_private_bucket,
                        object_key=a.object_key,
                        download_name=a.name or os.path.basename(a.object_key),
                    ),
                    "meta_json": strip_object_key_fields(a.meta_json or {}),
                }
                for a in artifacts
            ],
        },
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


@router.post("/jobs")
def create_job(
    payload: TrainingJobCreate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> dict:
    project = get_project_in_workspace(db, project_id=payload.project_id, workspace_id=workspace_id)
    if not project:
        raise ApiError("not_found", "Project not found", status_code=404)

    dataset_version = get_dataset_version_in_workspace(
        db,
        dataset_version_id=payload.dataset_version_id,
        workspace_id=workspace_id,
    )
    if not dataset_version:
        raise ApiError("not_found", "Dataset version not found", status_code=404)

    dataset = get_dataset_in_workspace(db, dataset_id=dataset_version.dataset_id, workspace_id=workspace_id)
    if not dataset:
        raise ApiError("not_found", "Dataset not found", status_code=404)
    if dataset.project_id != payload.project_id:
        raise ApiError("mismatch", "Dataset version does not belong to selected project", status_code=400)

    job = TrainingJob(
        project_id=payload.project_id,
        dataset_version_id=payload.dataset_version_id,
        recipe=payload.recipe,
        status="pending",
        params_json=payload.params_json,
        summary_json={"logs": []},
        created_by=current_user.id,
    )
    db.add(job)
    write_audit_log(
        db,
        workspace_id=workspace_id,
        actor_user_id=current_user.id,
        action="training_job.create",
        target_type="training_job",
        target_id=job.id,
        meta_json={"recipe": job.recipe},
    )
    db.commit()
    db.refresh(job)

    try:
        if settings.env == "test" or payload.params_json.get("sync"):
            raise RuntimeError("execute_inline")
        run_training_job.delay(job.id)
    except Exception:  # noqa: BLE001
        try:
            run_training_job(job.id)
        except Exception:  # noqa: BLE001
            # Fallback execution is best-effort; task writes failed status itself.
            pass

    return {"job": _job_to_dict(db, job, workspace_id)}


@router.get("/jobs")
def list_jobs(
    project_id: str | None = Query(default=None),
    db: Session = Depends(get_db_session),
    workspace_id: str = Depends(get_current_workspace_id),
) -> dict:
    query = db.query(TrainingJob).join(Project, Project.id == TrainingJob.project_id)
    query = query.filter(Project.workspace_id == workspace_id, Project.deleted_at.is_(None))
    if project_id:
        project = get_project_in_workspace(db, project_id=project_id, workspace_id=workspace_id)
        if not project:
            raise ApiError("not_found", "Project not found", status_code=404)
        query = query.filter(TrainingJob.project_id == project_id)

    jobs = query.order_by(TrainingJob.created_at.desc()).all()
    return {"items": [_job_to_dict(db, job, workspace_id) for job in jobs]}


@router.get("/jobs/{job_id}")
def get_job(
    job_id: str,
    db: Session = Depends(get_db_session),
    workspace_id: str = Depends(get_current_workspace_id),
) -> dict:
    job = get_training_job_in_workspace(db, job_id=job_id, workspace_id=workspace_id)
    if not job:
        raise ApiError("not_found", "Job not found", status_code=404)
    return {"job": _job_to_dict(db, job, workspace_id)}


@router.get("/jobs/{job_id}/events")
async def job_events(
    job_id: str,
    request: Request,
    db: Session = Depends(get_db_session),
    workspace_id: str = Depends(get_current_workspace_id),
):
    enforce_rate_limit(
        request,
        scope="sse",
        identifier=get_client_ip(request),
        limit=settings.sse_rate_limit_max,
        window_seconds=settings.sse_rate_limit_window_seconds,
    )
    job = get_training_job_in_workspace(db, job_id=job_id, workspace_id=workspace_id)
    if not job:
        raise ApiError("not_found", "Job not found", status_code=404)

    async def event_stream():
        sent_logs = 0
        sent_metric_ids: set[int] = set()
        sent_artifact_ids: set[str] = set()
        for _ in range(30):
            db.expire_all()
            current_job = get_training_job_in_workspace(db, job_id=job_id, workspace_id=workspace_id)
            if not current_job:
                break

            yield f"event: status\ndata: {json.dumps({'status': current_job.status})}\n\n"

            logs = current_job.summary_json.get("logs", []) if current_job.summary_json else []
            for line in logs[sent_logs:]:
                yield f"event: log\ndata: {json.dumps({'line': line})}\n\n"
            sent_logs = len(logs)

            run = (
                db.query(TrainingRun)
                .filter(TrainingRun.training_job_id == current_job.id)
                .order_by(TrainingRun.created_at.desc())
                .first()
            )
            if run:
                scoped_run = get_training_run_in_workspace(db, run_id=run.id, workspace_id=workspace_id)
                if not scoped_run:
                    break
                metrics = db.query(Metric).filter(Metric.run_id == run.id).all()
                for metric in metrics:
                    if metric.id in sent_metric_ids:
                        continue
                    sent_metric_ids.add(metric.id)
                    payload = {"key": metric.key, "value": metric.value, "step": metric.step}
                    yield f"event: metric\ndata: {json.dumps(payload)}\n\n"
                artifacts = db.query(Artifact).filter(Artifact.run_id == run.id).all()
                for artifact in artifacts:
                    if artifact.id in sent_artifact_ids:
                        continue
                    sent_artifact_ids.add(artifact.id)
                    payload = {
                        "id": artifact.id,
                        "name": artifact.name,
                        "download_url": create_presigned_get(
                            bucket_name=settings.s3_private_bucket,
                            object_key=artifact.object_key,
                            download_name=artifact.name or os.path.basename(artifact.object_key),
                        ),
                    }
                    yield f"event: artifact\ndata: {json.dumps(payload)}\n\n"

            if current_job.status in {"succeeded", "failed", "canceled"}:
                break
            await asyncio.sleep(1)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store"},
    )

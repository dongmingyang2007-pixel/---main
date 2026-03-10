from __future__ import annotations

import hashlib
import time
from datetime import datetime, timezone

from sqlalchemy import func

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Artifact, DataItem, Dataset, Model, ModelVersion, Project, TrainingJob, TrainingRun
from app.services.audit import write_audit_log
from app.services.storage import build_run_artifact_object_key, put_json_object
from app.services.train import append_job_log, append_metric, generate_mock_loss
from app.tasks.celery_app import celery_app


@celery_app.task(name="app.tasks.worker_tasks.process_data_item")
def process_data_item(data_item_id: str) -> None:
    db = SessionLocal()
    try:
        item = db.get(DataItem, data_item_id)
        if not item or item.deleted_at is not None:
            return

        pseudo = f"{item.dataset_id}:{item.filename}:{item.size_bytes}".encode()
        item.sha256 = hashlib.sha256(pseudo).hexdigest()

        if item.media_type.startswith("image/"):
            item.width = item.width or 1024
            item.height = item.height or 768

        item.meta_json = {**(item.meta_json or {}), "processed": True}

        write_audit_log(
            db,
            workspace_id=None,
            actor_user_id=None,
            action="data_item.processed",
            target_type="data_item",
            target_id=item.id,
            meta_json={"dataset_id": item.dataset_id},
        )
        db.commit()
    finally:
        db.close()


@celery_app.task(name="app.tasks.worker_tasks.run_training_job")
def run_training_job(job_id: str) -> None:
    db = SessionLocal()
    try:
        job = db.get(TrainingJob, job_id)
        if not job:
            return

        if job.status in {"running", "succeeded", "failed", "canceled"}:
            return

        now = datetime.now(timezone.utc)
        job.status = "running"
        job.updated_at = now
        run = TrainingRun(training_job_id=job.id, status="running", started_at=now, summary_json={"logs": []})
        db.add(run)
        db.flush()

        for step in range(1, 8):
            append_job_log(db, job, f"step={step}: running mock recipe={job.recipe}")
            append_metric(db, run.id, "loss", generate_mock_loss(step), step)
            if step % 2 == 0:
                append_metric(db, run.id, "acc", min(0.99, 0.4 + 0.08 * step), step)
            db.flush()
            time.sleep(0.2)

        if job.params_json.get("force_fail"):
            raise RuntimeError("forced_fail_for_debug")

        project = db.get(Project, job.project_id)
        artifact_key = build_run_artifact_object_key(
            workspace_id=project.workspace_id if project else "unknown",
            project_id=job.project_id,
            run_id=run.id,
            filename="report.json",
        )
        report_payload = {
            "run_id": run.id,
            "training_job_id": job.id,
            "status": "succeeded",
            "recipe": job.recipe,
            "params_json": job.params_json,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        try:
            if settings.env != "test":
                put_json_object(
                    bucket_name=settings.s3_private_bucket,
                    object_key=artifact_key,
                    payload=report_payload,
                )
        except Exception:  # noqa: BLE001
            # v0.1 keeps training status independent from object storage transient errors.
            pass

        artifact = Artifact(
            run_id=run.id,
            name="report.json",
            object_key=artifact_key,
            meta_json={"recipe": job.recipe, "type": "training_report"},
        )
        db.add(artifact)

        run.status = "succeeded"
        run.finished_at = datetime.now(timezone.utc)
        run.summary_json = {
            "logs": job.summary_json.get("logs", []),
            "artifact": artifact_key,
        }

        job.status = "succeeded"
        job.updated_at = datetime.now(timezone.utc)
        model = (
            db.query(Model)
            .filter(Model.project_id == job.project_id, Model.deleted_at.is_(None))
            .order_by(Model.created_at.asc())
            .first()
        )
        if not model:
            model = Model(project_id=job.project_id, name="Default Model", task_type="general")
            db.add(model)
            db.flush()

        max_version = (
            db.query(func.max(ModelVersion.version)).filter(ModelVersion.model_id == model.id).scalar() or 0
        )
        model_version = ModelVersion(
            model_id=model.id,
            version=max_version + 1,
            run_id=run.id,
            metrics_json={"final_loss": 0.08},
            artifact_object_key=artifact_key,
            notes="auto-created from training job",
        )
        db.add(model_version)

        write_audit_log(
            db,
            workspace_id=project.workspace_id if project else None,
            actor_user_id=job.created_by,
            action="training_job.succeeded",
            target_type="training_job",
            target_id=job.id,
            meta_json={"run_id": run.id},
        )
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        job = db.get(TrainingJob, job_id)
        if job:
            job.status = "failed"
            job.updated_at = datetime.now(timezone.utc)
            run = (
                db.query(TrainingRun)
                .filter(TrainingRun.training_job_id == job.id)
                .order_by(TrainingRun.created_at.desc())
                .first()
            )
            if run:
                run.status = "failed"
                run.finished_at = datetime.now(timezone.utc)
                run.summary_json = {**(run.summary_json or {}), "error": str(exc)}
            project = db.get(Project, job.project_id)
            write_audit_log(
                db,
                workspace_id=project.workspace_id if project else None,
                actor_user_id=job.created_by,
                action="training_job.failed",
                target_type="training_job",
                target_id=job.id,
                meta_json={"error": str(exc)},
            )
            db.commit()
        raise
    finally:
        db.close()


@celery_app.task(name="app.tasks.worker_tasks.cleanup_deleted_dataset")
def cleanup_deleted_dataset(dataset_id: str) -> None:
    db = SessionLocal()
    try:
        dataset = db.get(Dataset, dataset_id)
        if not dataset:
            return
        dataset.cleanup_status = "running"
        db.flush()

        items = db.query(DataItem).filter(DataItem.dataset_id == dataset_id).all()
        for item in items:
            if item.deleted_at is None:
                item.deleted_at = datetime.now(timezone.utc)
            item.meta_json = {**(item.meta_json or {}), "cleanup_marked": True}

        dataset.cleanup_status = "done"
        db.commit()
    finally:
        db.close()


@celery_app.task(name="app.tasks.worker_tasks.cleanup_deleted_project")
def cleanup_deleted_project(project_id: str) -> None:
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if not project:
            return
        project.cleanup_status = "running"
        db.flush()

        datasets = db.query(Dataset).filter(Dataset.project_id == project_id).all()
        for dataset in datasets:
            if dataset.deleted_at is None:
                dataset.deleted_at = datetime.now(timezone.utc)
            dataset.cleanup_status = "pending"
            items = db.query(DataItem).filter(DataItem.dataset_id == dataset.id).all()
            for item in items:
                if item.deleted_at is None:
                    item.deleted_at = datetime.now(timezone.utc)
                item.meta_json = {**(item.meta_json or {}), "cleanup_marked": True}
        project.cleanup_status = "done"
        db.commit()
    finally:
        db.close()

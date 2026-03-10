from __future__ import annotations

from datetime import datetime, timezone
from random import random

from sqlalchemy.orm import Session

from app.models import Metric, TrainingJob


def append_job_log(db: Session, job: TrainingJob, line: str) -> None:
    logs = list(job.summary_json.get("logs", []))
    logs.append(line)
    job.summary_json = {**job.summary_json, "logs": logs}


def append_metric(db: Session, run_id: str, key: str, value: float, step: int) -> None:
    metric = Metric(run_id=run_id, key=key, value=value, step=step, ts=datetime.now(timezone.utc))
    db.add(metric)


def generate_mock_loss(step: int) -> float:
    return max(0.02, 1.0 / (step + 1) + random() * 0.03)

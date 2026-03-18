from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import (
    get_current_user,
    get_current_workspace_id,
    get_db_session,
    require_csrf_protection,
    require_workspace_write_access,
)
from app.core.errors import ApiError
from app.models import User
from app.routers.utils import get_dataset_version_in_workspace, get_model_version_in_workspace
from app.schemas.eval import EvalRunCreate
from app.services.runtime_state import runtime_state


router = APIRouter(prefix="/api/v1/eval", tags=["eval"])


@router.post("/runs")
def create_eval_run(
    payload: EvalRunCreate,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _write_guard: None = Depends(require_workspace_write_access),
    _: None = Depends(require_csrf_protection),
) -> dict:
    model_version_a = get_model_version_in_workspace(
        db,
        model_version_id=payload.model_version_a,
        workspace_id=workspace_id,
    )
    model_version_b = get_model_version_in_workspace(
        db,
        model_version_id=payload.model_version_b,
        workspace_id=workspace_id,
    )
    dataset_version = get_dataset_version_in_workspace(
        db,
        dataset_version_id=payload.dataset_version_id,
        workspace_id=workspace_id,
    )
    if not model_version_a or not model_version_b or not dataset_version:
        raise ApiError("not_found", "Eval inputs not found", status_code=404)

    eval_id = str(uuid4())
    runtime_state.set_json(
        "eval",
        eval_id,
        {
            "eval_id": eval_id,
            "status": "succeeded",
            "created_by": current_user.id,
            "workspace_id": workspace_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "payload": payload.model_dump(),
            "samples": [
                {"input": "sample-1", "a": "result-a", "b": "result-b", "winner": "a"},
                {"input": "sample-2", "a": "result-a2", "b": "result-b2", "winner": "b"},
            ],
        },
        ttl_seconds=settings.eval_run_ttl_seconds,
    )
    return {"eval_id": eval_id}


@router.get("/runs/{eval_id}")
def get_eval_run(
    eval_id: str,
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
) -> dict:
    _ = current_user
    run = runtime_state.get_json("eval", eval_id)
    if not run:
        raise ApiError("not_found", "Eval run not found", status_code=404)
    if run.get("workspace_id") != workspace_id:
        raise ApiError("not_found", "Eval run not found", status_code=404)
    return run

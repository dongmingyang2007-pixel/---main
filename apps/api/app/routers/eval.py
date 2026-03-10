from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends

from app.core.config import settings
from app.core.deps import get_current_user, get_current_workspace_id, require_csrf_protection
from app.core.errors import ApiError
from app.models import User
from app.services.runtime_state import runtime_state


router = APIRouter(prefix="/api/v1/eval", tags=["eval"])


@router.post("/runs")
def create_eval_run(
    payload: dict,
    current_user: User = Depends(get_current_user),
    workspace_id: str = Depends(get_current_workspace_id),
    _: None = Depends(require_csrf_protection),
) -> dict:
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
            "payload": payload,
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

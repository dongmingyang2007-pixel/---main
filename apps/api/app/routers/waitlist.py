from fastapi import APIRouter, Depends, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import enforce_rate_limit, get_client_ip, require_allowed_origin
from app.core.deps import get_db_session
from app.models import Waitlist
from app.schemas.waitlist import OkResponse, WaitlistCreate


router = APIRouter(prefix="/api/v1/waitlist", tags=["waitlist"])


@router.post("", response_model=OkResponse)
def join_waitlist(
    payload: WaitlistCreate,
    request: Request,
    db: Session = Depends(get_db_session),
) -> OkResponse:
    require_allowed_origin(request)
    enforce_rate_limit(
        request,
        scope="waitlist",
        identifier=get_client_ip(request),
        limit=settings.waitlist_rate_limit_max,
        window_seconds=settings.waitlist_rate_limit_window_seconds,
    )
    item = db.query(Waitlist).filter(Waitlist.email == payload.email).first()
    if not item:
        try:
            db.add(Waitlist(email=payload.email, source=payload.source))
            db.commit()
        except IntegrityError:
            db.rollback()
    return OkResponse(ok=True)

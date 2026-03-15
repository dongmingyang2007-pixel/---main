import hashlib
import secrets
from collections.abc import Generator
from urllib.parse import urlparse

from fastapi import Cookie, Depends, Request, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import ApiError
from app.core.security import decode_token
from app.db.session import get_db
from app.models import Membership, User
from app.services.runtime_state import runtime_state


def get_db_session() -> Generator[Session, None, None]:
    yield from get_db()


def get_current_user(
    request: Request,
    db: Session = Depends(get_db_session),
    access_token: str | None = Cookie(default=None, alias=settings.access_cookie_name),
) -> User:
    if not access_token:
        raise ApiError("unauthorized", "Authentication required", status_code=401)
    try:
        payload = decode_token(access_token)
    except ValueError as exc:
        raise ApiError("unauthorized", "Invalid token", status_code=401) from exc
    user_id = payload.get("sub")
    user = db.get(User, user_id)
    if not user:
        raise ApiError("unauthorized", "User not found", status_code=401)
    request.state.access_token = access_token
    request.state.current_user_id = user.id
    return user


def get_current_workspace_id(
    request: Request,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> str:
    workspace_id = request.headers.get("x-workspace-id")
    membership_query = db.query(Membership).filter(Membership.user_id == current_user.id)
    if workspace_id:
        membership = membership_query.filter(Membership.workspace_id == workspace_id).first()
        if not membership:
            raise ApiError("forbidden", "Workspace access denied", status_code=403)
        return workspace_id

    first_membership = membership_query.first()
    if not first_membership:
        raise ApiError("forbidden", "No workspace membership", status_code=403)
    return first_membership.workspace_id


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if settings.trust_forwarded_for and forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def require_allowed_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin:
        normalized_origin = settings.normalize_origin(origin)
    else:
        referer = request.headers.get("referer")
        if not referer:
            raise ApiError("origin_required", "Origin or Referer header is required", status_code=403)
        parsed = urlparse(referer)
        normalized_origin = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")

    if not settings.is_origin_allowed(normalized_origin):
        raise ApiError("forbidden_origin", "Origin not allowed", status_code=403)


def _build_access_token_hash(access_token: str) -> str:
    return hashlib.sha256(access_token.encode("utf-8")).hexdigest()


def set_auth_cookie(response: Response, token: str) -> None:
    cookie_kwargs = {
        "key": settings.access_cookie_name,
        "value": token,
        "httponly": True,
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "max_age": settings.jwt_expire_minutes * 60,
        "path": "/",
    }
    if settings.cookie_domain and settings.cookie_domain not in {"localhost", "testserver"}:
        cookie_kwargs["domain"] = settings.cookie_domain
    response.set_cookie(**cookie_kwargs)


def set_csrf_cookie(response: Response, csrf_token: str) -> None:
    cookie_kwargs = {
        "key": settings.csrf_cookie_name,
        "value": csrf_token,
        "httponly": False,
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "max_age": settings.csrf_ttl_seconds,
        "path": "/",
    }
    if settings.cookie_domain and settings.cookie_domain not in {"localhost", "testserver"}:
        cookie_kwargs["domain"] = settings.cookie_domain
    response.set_cookie(**cookie_kwargs)


def clear_auth_cookie(response: Response) -> None:
    if settings.cookie_domain and settings.cookie_domain not in {"localhost", "testserver"}:
        response.delete_cookie(
            key=settings.access_cookie_name,
            domain=settings.cookie_domain,
            path="/",
        )
    else:
        response.delete_cookie(
            key=settings.access_cookie_name,
            path="/",
        )


def clear_csrf_cookie(response: Response) -> None:
    if settings.cookie_domain and settings.cookie_domain not in {"localhost", "testserver"}:
        response.delete_cookie(
            key=settings.csrf_cookie_name,
            domain=settings.cookie_domain,
            path="/",
        )
    else:
        response.delete_cookie(
            key=settings.csrf_cookie_name,
            path="/",
        )


def issue_csrf_token(response: Response, access_token: str, user_id: str) -> str:
    csrf_token = secrets.token_urlsafe(32)
    runtime_state.set_json(
        "csrf",
        _build_access_token_hash(access_token),
        {"token": csrf_token, "user_id": user_id},
        ttl_seconds=settings.csrf_ttl_seconds,
    )
    set_csrf_cookie(response, csrf_token)
    return csrf_token


def require_csrf_protection(
    request: Request,
    current_user: User = Depends(get_current_user),
    access_token: str | None = Cookie(default=None, alias=settings.access_cookie_name),
    csrf_cookie: str | None = Cookie(default=None, alias=settings.csrf_cookie_name),
) -> None:
    _ = current_user
    require_allowed_origin(request)
    header_token = request.headers.get("x-csrf-token")
    if not access_token or not csrf_cookie or not header_token:
        raise ApiError("csrf_required", "CSRF token is required", status_code=403)
    if header_token != csrf_cookie:
        raise ApiError("csrf_mismatch", "CSRF token mismatch", status_code=403)
    csrf_state = runtime_state.get_json("csrf", _build_access_token_hash(access_token))
    if not csrf_state or csrf_state.get("token") != header_token:
        raise ApiError("csrf_invalid", "CSRF token is invalid or expired", status_code=403)


def enforce_rate_limit(
    request: Request,
    *,
    scope: str,
    identifier: str,
    limit: int,
    window_seconds: int,
) -> None:
    hashed_identifier = hashlib.sha256(identifier.encode("utf-8")).hexdigest()
    current = runtime_state.incr(scope, hashed_identifier, ttl_seconds=window_seconds)
    if current > limit:
        raise ApiError("rate_limited", "Too many requests", status_code=429)

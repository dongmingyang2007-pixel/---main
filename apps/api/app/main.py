from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings
from app.core.errors import (
    ApiError,
    api_error_handler,
    http_exception_handler,
    unhandled_error_handler,
    validation_exception_handler,
)
from app.core.http_security import SecurityHeadersMiddleware
from app.core.request_id import RequestIDMiddleware
from app.db.base import Base
from app.db.session import engine
from app.routers import auth, datasets, demo, eval, models, projects, train, uploads, waitlist
from app.services.runtime_state import runtime_state


app = FastAPI(
    title="QIHANG API",
    version="0.1.0",
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)

app.add_middleware(RequestIDMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
if settings.allowed_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Workspace-ID", "X-CSRF-Token"],
)

app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, unhandled_error_handler)


@app.on_event("startup")
def startup() -> None:
    settings.validate_runtime_configuration()
    runtime_state.ensure_available()
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "api"}


app.include_router(auth.router)
app.include_router(waitlist.router)
app.include_router(projects.router)
app.include_router(datasets.router)
app.include_router(uploads.router)
app.include_router(train.router)
app.include_router(models.router)
app.include_router(demo.router)
app.include_router(eval.router)

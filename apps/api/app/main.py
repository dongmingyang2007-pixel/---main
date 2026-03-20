from contextlib import asynccontextmanager

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
from app.db.session import SessionLocal, engine
from app.routers import auth, chat, datasets, demo, eval, memory, memory_stream, model_catalog, models, pipeline, projects, realtime, train, uploads, waitlist
from app.services.chat_modes import ensure_project_chat_mode_schema
from app.services.model_catalog_seed import seed_model_catalog
from app.services.memory_roots import ensure_project_memory_root_schema
from app.services.runtime_state import runtime_state


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.validate_runtime_configuration()
    runtime_state.ensure_available()
    Base.metadata.create_all(bind=engine)
    ensure_project_chat_mode_schema(engine)
    ensure_project_memory_root_schema(engine)
    db = SessionLocal()
    try:
        seed_model_catalog(db)
    finally:
        db.close()
    yield


app = FastAPI(
    title="QIHANG API",
    version="0.1.0",
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(RequestIDMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
if settings.allowed_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Workspace-ID", "X-CSRF-Token"],
)

app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(Exception, unhandled_error_handler)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "api"}


app.include_router(auth.router)
app.include_router(waitlist.router)
app.include_router(projects.router)
app.include_router(datasets.router)
app.include_router(uploads.router)
app.include_router(train.router)
app.include_router(model_catalog.router)
app.include_router(models.router)
app.include_router(pipeline.router)
app.include_router(demo.router)
app.include_router(eval.router)
app.include_router(memory_stream.router)
app.include_router(memory.router)
app.include_router(chat.router)
app.include_router(realtime.router)

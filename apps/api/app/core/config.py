from functools import lru_cache
from typing import Annotated
from urllib.parse import urlparse

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

LOOPBACK_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: str = "local"
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/qihang"

    jwt_secret: str = "CHANGE_ME"
    jwt_expire_minutes: int = 60
    jwt_refresh_expire_days: int = 14
    cookie_domain: str = "localhost"
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    access_cookie_name: str = "access_token"
    csrf_cookie_name: str = "csrf_token"
    csrf_ttl_seconds: int = 3600

    redis_url: str = "redis://localhost:6379/0"
    redis_namespace: str = "qihang"
    redis_connect_timeout_seconds: float = 1.0
    trust_forwarded_for: bool = False

    s3_endpoint: str = "http://localhost:9000"
    s3_presign_endpoint: str = ""
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_private_bucket: str = "qihang-private"
    s3_demo_bucket: str = "qihang-demo"
    s3_region: str = "us-east-1"
    s3_presign_expire_seconds: int = 900

    demo_mode: bool = True
    demo_infer_enabled: bool = False
    inference_endpoint: str = ""
    upload_max_mb: int = 50
    upload_put_proxy: bool = False
    upload_session_ttl_seconds: int = 900
    demo_request_ttl_seconds: int = 900
    eval_run_ttl_seconds: int = 3600
    demo_prompt_max_chars: int = 400
    demo_max_infer_count: int = 3
    demo_max_concurrent_sessions_per_ip: int = 5

    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_address: str = ""
    smtp_from_name: str = "铭润科技"
    verification_code_ttl_seconds: int = 600
    verification_code_length: int = 6
    verification_rate_limit_window_seconds: int = 60
    verification_rate_limit_max: int = 3
    demo_allowed_media_types: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["image/jpeg", "image/png", "image/webp"]
    )

    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"])
    allowed_hosts: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["localhost", "127.0.0.1", "testserver"]
    )

    auth_rate_limit_window_seconds: int = 300
    auth_rate_limit_ip_max: int = 10
    auth_rate_limit_email_ip_max: int = 5
    waitlist_rate_limit_window_seconds: int = 300
    waitlist_rate_limit_max: int = 20
    demo_presign_rate_limit_window_seconds: int = 300
    demo_presign_rate_limit_max: int = 20
    demo_infer_rate_limit_window_seconds: int = 300
    demo_infer_rate_limit_max: int = 30
    sse_rate_limit_window_seconds: int = 60
    sse_rate_limit_max: int = 10

    @field_validator("cors_origins", "allowed_hosts", "demo_allowed_media_types", mode="before")
    @classmethod
    def _parse_list_settings(cls, value):
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.env.lower() == "production"

    @property
    def normalized_cors_origins(self) -> set[str]:
        return {self.normalize_origin(origin) for origin in self.cors_origins}

    @property
    def cors_origin_regex(self) -> str | None:
        if self.is_production:
            return None
        return LOOPBACK_ORIGIN_REGEX

    def should_use_proxy_uploads(self) -> bool:
        return self.env in {"local", "test"} or self.upload_put_proxy

    @staticmethod
    def normalize_origin(value: str) -> str:
        parsed = urlparse(value)
        if not parsed.scheme or not parsed.netloc:
            return value.rstrip("/")
        return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")

    def is_origin_allowed(self, origin: str) -> bool:
        normalized_origin = self.normalize_origin(origin)
        if normalized_origin in self.normalized_cors_origins:
            return True

        if self.is_production:
            return False

        parsed = urlparse(normalized_origin)
        return parsed.scheme in {"http", "https"} and parsed.hostname in {"localhost", "127.0.0.1", "::1"}

    def validate_runtime_configuration(self) -> None:
        if not self.is_production:
            return

        problems: list[str] = []
        if self.jwt_secret == "CHANGE_ME" or len(self.jwt_secret) < 32:
            problems.append("JWT_SECRET must be a strong non-default secret in production")
        if not self.cookie_secure:
            problems.append("COOKIE_SECURE must be true in production")
        if not self.allowed_hosts or "*" in self.allowed_hosts:
            problems.append("ALLOWED_HOSTS must be explicitly configured in production")
        if not self.cors_origins or "*" in self.cors_origins:
            problems.append("CORS origins must be explicitly configured in production")
        if self.s3_access_key == "minioadmin" or self.s3_secret_key == "minioadmin":
            problems.append("Default object storage credentials must not be used in production")
        if self.s3_private_bucket == self.s3_demo_bucket:
            problems.append("Private and demo buckets must be isolated")
        if self.demo_infer_enabled and not self.inference_endpoint:
            problems.append("INFERENCE_ENDPOINT is required when demo inference proxy is enabled")

        if problems:
            raise RuntimeError("Invalid production configuration: " + "; ".join(problems))


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

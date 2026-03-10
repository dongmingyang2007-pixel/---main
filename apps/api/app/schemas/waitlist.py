from pydantic import BaseModel, EmailStr


class WaitlistCreate(BaseModel):
    email: EmailStr
    source: str | None = None


class OkResponse(BaseModel):
    ok: bool = True

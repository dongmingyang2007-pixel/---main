from datetime import datetime

from pydantic import BaseModel


class ConversationCreate(BaseModel):
    project_id: str
    title: str = ""


class ConversationOut(BaseModel):
    id: str
    workspace_id: str
    project_id: str
    title: str
    created_by: str | None
    created_at: datetime
    updated_at: datetime


class MessageCreate(BaseModel):
    content: str
    enable_thinking: bool | None = None


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    reasoning_content: str | None = None
    created_at: datetime

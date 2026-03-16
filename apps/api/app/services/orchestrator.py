from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.models.entities import Memory, Project
from app.services.dashscope_client import chat_completion
from app.services.embedding import search_similar


async def orchestrate_inference(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    user_message: str,
    recent_messages: list[dict[str, str]],
) -> str:
    """Orchestrate a full inference call:
    1. Retrieve RAG knowledge (semantic search)
    2. Load relevant memories (permanent + conversation temporary)
    3. Load project personality
    4. Assemble system prompt
    5. Call model API
    """
    # 1. Retrieve RAG knowledge
    knowledge_chunks: list[dict] = []
    try:
        knowledge_chunks = await search_similar(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            query=user_message,
            limit=5,
        )
    except Exception:  # noqa: BLE001
        pass  # RAG failure is non-fatal, continue without knowledge

    # 2. Load memories
    permanent_memories = (
        db.query(Memory)
        .filter(
            Memory.project_id == project_id,
            Memory.type == "permanent",
        )
        .order_by(Memory.updated_at.desc())
        .limit(20)
        .all()
    )

    temporary_memories = (
        db.query(Memory)
        .filter(
            Memory.project_id == project_id,
            Memory.type == "temporary",
            Memory.source_conversation_id == conversation_id,
        )
        .all()
    )

    # 3. Load project personality
    project = db.query(Project).filter(Project.id == project_id).first()
    personality = ""
    if project and project.description:
        desc = project.description
        match = re.search(r"\[personality:(.*?)\]", desc, re.DOTALL)
        if match:
            personality = match.group(1).strip()
        else:
            personality = desc  # fallback: use raw description as personality

    # 4. Assemble system prompt
    system_parts: list[str] = []

    if personality:
        system_parts.append(f"你的人格设定：\n{personality}")

    if permanent_memories or temporary_memories:
        memory_lines: list[str] = []
        for m in permanent_memories:
            memory_lines.append(f"- [永久] {m.content}")
        for m in temporary_memories:
            memory_lines.append(f"- [本次对话] {m.content}")
        system_parts.append("你记住的关于用户的信息：\n" + "\n".join(memory_lines))

    if knowledge_chunks:
        knowledge_text = "\n---\n".join([c["chunk_text"] for c in knowledge_chunks])
        system_parts.append(f"相关知识参考（来自用户上传的资料）：\n{knowledge_text}")

    system_prompt = "\n\n".join(system_parts) if system_parts else "你是一个有帮助的 AI 助手。"

    # 5. Call model API
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    messages.extend(recent_messages[-20:])  # Last 20 messages for context
    messages.append({"role": "user", "content": user_message})

    try:
        response = await chat_completion(messages)
        return response
    except Exception as e:  # noqa: BLE001
        return f"抱歉，AI 暂时无法响应。错误信息：{e!s}"

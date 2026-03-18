from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import Conversation, DataItem, Dataset, Memory, ModelCatalog, PipelineConfig, Project
from app.services.dashscope_client import chat_completion, omni_completion
from app.services.embedding import search_similar
from app.services.memory_file_context import load_linked_file_chunks_for_memories
from app.services.memory_visibility import get_memory_owner_user_id, is_private_memory


# ---------------------------------------------------------------------------
# Shared helper: build system prompt + call LLM
# ---------------------------------------------------------------------------


def _load_active_conversation_context(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
) -> tuple[Project, Conversation]:
    project = (
        db.query(Project)
        .filter(
            Project.id == project_id,
            Project.workspace_id == workspace_id,
            Project.deleted_at.is_(None),
        )
        .first()
    )
    if not project:
        raise RuntimeError("project_not_found")

    conversation = (
        db.query(Conversation)
        .join(Project, Project.id == Conversation.project_id)
        .filter(
            Conversation.id == conversation_id,
            Conversation.workspace_id == workspace_id,
            Conversation.project_id == project_id,
            Project.deleted_at.is_(None),
        )
        .first()
    )
    if not conversation:
        raise RuntimeError("conversation_not_found")
    return project, conversation


def _filter_knowledge_chunks_for_prompt(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    results: list[dict],
) -> list[dict]:
    data_item_ids = [result["data_item_id"] for result in results if result.get("data_item_id")]
    if not data_item_ids:
        return [result for result in results if not result.get("memory_id")]

    visible_data_item_ids = {
        data_item_id
        for data_item_id, in db.query(DataItem.id)
        .join(Dataset, Dataset.id == DataItem.dataset_id)
        .join(Project, Project.id == Dataset.project_id)
        .filter(
            DataItem.id.in_(data_item_ids),
            DataItem.deleted_at.is_(None),
            Dataset.deleted_at.is_(None),
            Project.id == project_id,
            Project.workspace_id == workspace_id,
            Project.deleted_at.is_(None),
        )
        .all()
    }
    return [
        result
        for result in results
        if result.get("memory_id") is None and result.get("data_item_id") in visible_data_item_ids
    ]


def _load_visible_permanent_memories(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_created_by: str | None,
) -> list[Memory]:
    permanent_memories = (
        db.query(Memory)
        .filter(
            Memory.workspace_id == workspace_id,
            Memory.project_id == project_id,
            Memory.type == "permanent",
        )
        .order_by(Memory.updated_at.desc())
        .limit(20)
        .all()
    )
    return [
        memory
        for memory in permanent_memories
        if not is_private_memory(memory) or get_memory_owner_user_id(memory) == conversation_created_by
    ]


def _filter_relevant_memory_ids_for_prompt(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    conversation_created_by: str | None,
    results: list[dict],
) -> list[str]:
    memory_ids = [result["memory_id"] for result in results if result.get("memory_id")]
    if not memory_ids:
        return []

    memories = (
        db.query(Memory)
        .filter(
            Memory.id.in_(memory_ids),
            Memory.workspace_id == workspace_id,
            Memory.project_id == project_id,
        )
        .all()
    )

    visible_memory_ids: list[str] = []
    for memory in memories:
        if memory.type == "temporary":
            if memory.source_conversation_id != conversation_id:
                continue
            visible_memory_ids.append(memory.id)
            continue
        if not is_private_memory(memory) or get_memory_owner_user_id(memory) == conversation_created_by:
            visible_memory_ids.append(memory.id)
    return visible_memory_ids


def _memory_matches_query(memory: Memory, query: str) -> bool:
    normalized_query = query.strip().lower()
    normalized_memory = memory.content.strip().lower()
    if not normalized_query or not normalized_memory:
        return False
    if normalized_memory in normalized_query:
        return True

    tokens = re.findall(r"[\w\u4e00-\u9fff]{2,}", normalized_memory)
    return any(token in normalized_query for token in tokens[:6])


async def _build_and_call_llm(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    user_message: str,
    recent_messages: list[dict[str, str]],
    llm_model_id: str,
    image_bytes: bytes | None = None,
) -> str:
    """Shared logic used by both text and voice pipelines.

    1. Retrieve RAG knowledge (semantic search)
    2. Load relevant memories (permanent + conversation temporary)
    3. Load project personality
    4. Assemble system prompt
    5. Call model API (text-only or multimodal if *image_bytes* provided)
    """
    # 1. Retrieve RAG knowledge
    knowledge_chunks: list[dict] = []
    linked_file_chunks: list[dict] = []
    semantic_results: list[dict] = []
    relevant_memory_ids: list[str] = []

    # 2. Load memories
    project, conversation_record = _load_active_conversation_context(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_id=conversation_id,
    )
    permanent_memories = _load_visible_permanent_memories(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_created_by=conversation_record.created_by,
    )

    temporary_memories = (
        db.query(Memory)
        .filter(
            Memory.workspace_id == workspace_id,
            Memory.project_id == project_id,
            Memory.type == "temporary",
            Memory.source_conversation_id == conversation_id,
        )
        .all()
    )

    try:
        semantic_results = await search_similar(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            query=user_message,
            limit=12,
        )
        relevant_memory_ids = _filter_relevant_memory_ids_for_prompt(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            conversation_id=conversation_id,
            conversation_created_by=conversation_record.created_by,
            results=semantic_results,
        )
        knowledge_chunks = _filter_knowledge_chunks_for_prompt(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            results=semantic_results,
        )
        relevant_memory_ids.extend(
            memory.id
            for memory in [*permanent_memories, *temporary_memories]
            if _memory_matches_query(memory, user_message)
        )
        relevant_memory_ids = list(dict.fromkeys(relevant_memory_ids))
        if relevant_memory_ids:
            linked_file_chunks = await load_linked_file_chunks_for_memories(
                db,
                workspace_id=workspace_id,
                project_id=project_id,
                memory_ids=relevant_memory_ids,
                query=user_message,
                limit=4,
            )
    except Exception:  # noqa: BLE001
        pass  # RAG failure is non-fatal, continue without knowledge

    # 3. Load project personality
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

    linked_seen = {
        (chunk.get("data_item_id"), chunk.get("chunk_text"))
        for chunk in knowledge_chunks
    }
    linked_file_chunks = [
        chunk
        for chunk in linked_file_chunks
        if (chunk.get("data_item_id"), chunk.get("chunk_text")) not in linked_seen
    ]
    if linked_file_chunks:
        linked_text = "\n---\n".join(
            [
                f"[{chunk.get('filename') or '未命名资料'}]\n{chunk['chunk_text']}"
                for chunk in linked_file_chunks
            ]
        )
        system_parts.append(f"与当前相关记忆直接关联的资料摘录：\n{linked_text}")

    system_prompt = "\n\n".join(system_parts) if system_parts else "你是一个有帮助的 AI 助手。"

    # 5. Call model API
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    messages.extend(recent_messages[-20:])  # Last 20 messages for context
    messages.append({"role": "user", "content": user_message})

    if image_bytes:
        # Multimodal call – pass image directly to a vision-capable LLM
        from app.services.vision_client import chat_with_image

        return await chat_with_image(image_bytes, messages, model=llm_model_id)
    return await chat_completion(messages, model=llm_model_id)


# ---------------------------------------------------------------------------
# Public API: text-only inference (original interface, now delegates)
# ---------------------------------------------------------------------------


async def orchestrate_inference(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    user_message: str,
    recent_messages: list[dict[str, str]],
) -> str:
    """Orchestrate a full inference call (text → text).

    This is the original entry-point used by the chat endpoint.
    """
    # Resolve per-project LLM model
    llm_model_id: str = settings.dashscope_model
    llm_pipeline = (
        db.query(PipelineConfig)
        .filter(PipelineConfig.project_id == project_id, PipelineConfig.model_type == "llm")
        .first()
    )
    if llm_pipeline:
        llm_model_id = llm_pipeline.model_id

    return await _build_and_call_llm(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_id=conversation_id,
        user_message=user_message,
        recent_messages=recent_messages,
        llm_model_id=llm_model_id,
    )


# ---------------------------------------------------------------------------
# Public API: full voice pipeline (ASR → LLM → TTS)
# ---------------------------------------------------------------------------


async def orchestrate_voice_inference(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    audio_bytes: bytes | None = None,
    image_bytes: bytes | None = None,
    text_input: str | None = None,
    return_audio: bool = True,
) -> dict:
    """Full voice pipeline orchestration.

    Returns:
        {
            "text_input": str,          # What the user said (after ASR)
            "text_response": str,       # AI's text response
            "audio_response": bytes | None,  # AI's voice (after TTS)
        }
    """
    from app.models.entities import Message
    from app.services.asr_client import transcribe_audio, transcribe_audio_realtime
    from app.services.tts_client import synthesize_speech, synthesize_speech_realtime
    from app.services.vision_client import describe_image

    # ⓪ Check for omni model (handles audio in/out directly)  -------------
    llm_config = (
        db.query(PipelineConfig)
        .filter(
            PipelineConfig.project_id == project_id,
            PipelineConfig.model_type == "llm",
        )
        .first()
    )
    llm_model_id = llm_config.model_id if llm_config else settings.dashscope_model

    model_info = (
        db.query(ModelCatalog)
        .filter(ModelCatalog.model_id == llm_model_id)
        .first()
    )
    capabilities = model_info.capabilities if model_info else []
    is_omni = "audio_input" in capabilities and "audio_output" in capabilities

    if is_omni and (audio_bytes or image_bytes):
        project, conversation = _load_active_conversation_context(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            conversation_id=conversation_id,
        )
        # Omni mode: skip ASR (model understands audio directly)
        # Build context from recent messages
        recent = (
            db.query(Message)
            .filter(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc())
            .limit(20)
            .all()
        )
        recent_msgs = [{"role": m.role, "content": m.content} for m in reversed(recent)]

        user_text = text_input or "(audio input)"

        # Build system prompt via shared helper internals
        # We reuse _build_and_call_llm logic but need multimodal input,
        # so we assemble system prompt here and call omni_completion directly.
        knowledge_chunks: list[dict] = []
        try:
            knowledge_chunks = await search_similar(
                db,
                workspace_id=workspace_id,
                project_id=project_id,
                query=user_text if text_input else "voice conversation",
                limit=5,
            )
            knowledge_chunks = _filter_knowledge_chunks_for_prompt(
                db,
                workspace_id=workspace_id,
                project_id=project_id,
                results=knowledge_chunks,
            )
        except Exception:  # noqa: BLE001
            pass

        permanent_memories = _load_visible_permanent_memories(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            conversation_created_by=conversation.created_by,
        )
        temporary_memories = (
            db.query(Memory)
            .filter(
                Memory.workspace_id == workspace_id,
                Memory.project_id == project_id,
                Memory.type == "temporary",
                Memory.source_conversation_id == conversation_id,
            )
            .all()
        )
        personality = ""
        if project and project.description:
            desc = project.description
            match = re.search(r"\[personality:(.*?)\]", desc, re.DOTALL)
            personality = match.group(1).strip() if match else desc

        system_parts: list[str] = []
        if personality:
            system_parts.append(f"你的人格设定：\n{personality}")
        if permanent_memories or temporary_memories:
            memory_lines = [f"- [永久] {m.content}" for m in permanent_memories]
            memory_lines += [f"- [本次对话] {m.content}" for m in temporary_memories]
            system_parts.append("你记住的关于用户的信息：\n" + "\n".join(memory_lines))
        if knowledge_chunks:
            knowledge_text = "\n---\n".join([c["chunk_text"] for c in knowledge_chunks])
            system_parts.append(f"相关知识参考（来自用户上传的资料）：\n{knowledge_text}")

        system_prompt = "\n\n".join(system_parts) if system_parts else "你是一个有帮助的 AI 助手。"

        messages: list[dict] = [{"role": "system", "content": system_prompt}]
        messages.extend(recent_msgs[-20:])
        messages.append({"role": "user", "content": user_text})

        omni_result = await omni_completion(
            messages,
            audio_bytes=audio_bytes,
            image_bytes=image_bytes,
            model=llm_model_id,
        )
        text_response = omni_result["text"]

        # TTS: still separate for now (omni audio output requires WebSocket streaming)
        audio_response: bytes | None = None
        if return_audio and text_response:
            try:
                tts_config = (
                    db.query(PipelineConfig)
                    .filter(
                        PipelineConfig.project_id == project_id,
                        PipelineConfig.model_type == "tts",
                    )
                    .first()
                )
                tts_model = tts_config.model_id if tts_config else "cosyvoice-v1"
                tts_model_info = (
                    db.query(ModelCatalog).filter(ModelCatalog.model_id == tts_model).first()
                )
                tts_is_realtime = tts_model_info and "realtime" in (
                    tts_model_info.capabilities or []
                )

                if tts_is_realtime:
                    audio_response = await synthesize_speech_realtime(
                        text_response, model=tts_model
                    )
                else:
                    audio_response = await synthesize_speech(text_response, model=tts_model)
            except Exception:  # noqa: BLE001
                pass

        return {
            "text_input": user_text,
            "text_response": text_response,
            "audio_response": audio_response,
        }

    # ① ASR: audio → text  ------------------------------------------------
    user_text = text_input or ""
    if audio_bytes and not text_input:
        asr_config = (
            db.query(PipelineConfig)
            .filter(
                PipelineConfig.project_id == project_id,
                PipelineConfig.model_type == "asr",
            )
            .first()
        )
        asr_model = asr_config.model_id if asr_config else "paraformer-v2"
        asr_model_info = (
            db.query(ModelCatalog).filter(ModelCatalog.model_id == asr_model).first()
        )
        asr_is_realtime = asr_model_info and "realtime" in (asr_model_info.capabilities or [])

        if asr_is_realtime:
            user_text = await transcribe_audio_realtime(audio_bytes, model=asr_model)
        else:
            user_text = await transcribe_audio(audio_bytes, model=asr_model)

    if not user_text.strip():
        return {"text_input": "", "text_response": "未检测到语音内容", "audio_response": None}

    # ② Get LLM config and capabilities  ----------------------------------
    llm_config = (
        db.query(PipelineConfig)
        .filter(
            PipelineConfig.project_id == project_id,
            PipelineConfig.model_type == "llm",
        )
        .first()
    )
    llm_model_id = llm_config.model_id if llm_config else settings.dashscope_model

    model_info = (
        db.query(ModelCatalog)
        .filter(ModelCatalog.model_id == llm_model_id)
        .first()
    )
    llm_supports_vision = model_info is not None and "vision" in (model_info.capabilities or [])

    # ③ Handle image input  ------------------------------------------------
    image_description: str | None = None
    use_multimodal_llm = False

    if image_bytes:
        if llm_supports_vision:
            use_multimodal_llm = True  # Pass image directly to LLM
        else:
            # Use separate Vision model
            vision_config = (
                db.query(PipelineConfig)
                .filter(
                    PipelineConfig.project_id == project_id,
                    PipelineConfig.model_type == "vision",
                )
                .first()
            )
            vision_model = vision_config.model_id if vision_config else "qwen-vl-plus"
            image_description = await describe_image(image_bytes, model=vision_model)

    # ④ Build context  -----------------------------------------------------
    # Get recent messages for conversation history
    recent = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(20)
        .all()
    )
    recent_msgs = [{"role": m.role, "content": m.content} for m in reversed(recent)]

    # If we have an image description from a separate Vision model, prepend
    enriched_text = user_text
    if image_description:
        enriched_text = f"[用户发送了一张图片，内容是：{image_description}]\n{user_text}"

    # ⑤ Call LLM (reuses shared helper)  -----------------------------------
    text_response = await _build_and_call_llm(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_id=conversation_id,
        user_message=enriched_text,
        recent_messages=recent_msgs,
        llm_model_id=llm_model_id,
        image_bytes=image_bytes if use_multimodal_llm else None,
    )

    # ⑥ TTS: text → audio  ------------------------------------------------
    audio_response: bytes | None = None
    if return_audio and text_response:
        try:
            tts_config = (
                db.query(PipelineConfig)
                .filter(
                    PipelineConfig.project_id == project_id,
                    PipelineConfig.model_type == "tts",
                )
                .first()
            )
            tts_model = tts_config.model_id if tts_config else "cosyvoice-v1"
            tts_model_info = (
                db.query(ModelCatalog).filter(ModelCatalog.model_id == tts_model).first()
            )
            tts_is_realtime = tts_model_info and "realtime" in (
                tts_model_info.capabilities or []
            )

            if tts_is_realtime:
                audio_response = await synthesize_speech_realtime(
                    text_response, model=tts_model
                )
            else:
                audio_response = await synthesize_speech(text_response, model=tts_model)
        except Exception:  # noqa: BLE001
            pass  # TTS failure is non-fatal

    return {
        "text_input": user_text,
        "text_response": text_response,
        "audio_response": audio_response,
    }

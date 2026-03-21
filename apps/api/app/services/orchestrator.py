from __future__ import annotations

import logging
import re
from typing import AsyncIterator

from sqlalchemy.orm import Session

from app.models.entities import Conversation, DataItem, Dataset, Memory, ModelCatalog, PipelineConfig, Project
from app.services.context_loader import (
    extract_personality,
    filter_knowledge_chunks,
    load_conversation_context,
    load_permanent_memories,
    load_recent_messages,
)
from app.services.dashscope_client import (
    chat_completion_detailed,
    chat_completion_multimodal_detailed,
    omni_completion,
)
from app.services.dashscope_stream import chat_completion_stream
from app.services.embedding import search_similar
from app.services.memory_file_context import load_linked_file_chunks_for_memories
from app.services.memory_visibility import get_memory_owner_user_id, is_private_memory
from app.services.pipeline_models import resolve_pipeline_model_id

logger = logging.getLogger(__name__)

_OPENAI_COMPATIBLE_ASR_PREFIXES = ("qwen3-asr-",)
_OPENAI_COMPATIBLE_TTS_PREFIXES = ("qwen3-tts-",)


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
    return load_conversation_context(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_id=conversation_id,
    )


def _filter_knowledge_chunks_for_prompt(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    results: list[dict],
) -> list[dict]:
    # Filter out memory-sourced results first (handled separately),
    # then delegate dataset visibility check to shared context_loader.
    non_memory_results = [r for r in results if r.get("memory_id") is None]
    return filter_knowledge_chunks(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        results=non_memory_results,
    )


def _load_visible_permanent_memories(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_created_by: str | None,
) -> list[Memory]:
    return load_permanent_memories(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_created_by=conversation_created_by,
    )


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


async def _assemble_llm_context(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    user_message: str,
    recent_messages: list[dict[str, str]],
) -> list[dict[str, str]]:
    """Assemble the full messages list (system + history + user) for an LLM call.

    Shared by both the blocking ``_build_and_call_llm`` and the streaming
    ``orchestrate_inference_stream`` paths so that context assembly logic is
    not duplicated.

    Returns a list of message dicts ready to pass to the model API.
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
        with db.begin_nested():
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
        logger.exception("RAG context assembly failed; continuing without semantic context")

    # 3. Load project personality
    personality = extract_personality(project.description) if project else ""

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

    # 5. Build messages list
    messages: list[dict[str, str]] = [{"role": "system", "content": system_prompt}]
    messages.extend(recent_messages[-20:])  # Last 20 messages for context
    messages.append({"role": "user", "content": user_message})

    return messages


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
    image_mime_type: str = "image/jpeg",
    video_bytes: bytes | None = None,
    video_mime_type: str = "video/mp4",
    enable_thinking: bool | None = None,
) -> dict[str, str | None]:
    """Shared logic used by both text and voice pipelines.

    1. Retrieve RAG knowledge (semantic search)
    2. Load relevant memories (permanent + conversation temporary)
    3. Load project personality
    4. Assemble system prompt
    5. Call model API (text-only or multimodal if *image_bytes* provided)
    """
    messages = await _assemble_llm_context(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_id=conversation_id,
        user_message=user_message,
        recent_messages=recent_messages,
    )

    if image_bytes or video_bytes:
        result = await chat_completion_multimodal_detailed(
            messages,
            model=llm_model_id,
            image_bytes=image_bytes,
            image_mime_type=image_mime_type,
            video_bytes=video_bytes,
            video_mime_type=video_mime_type,
            enable_thinking=enable_thinking,
        )
    else:
        result = await chat_completion_detailed(
            messages,
            model=llm_model_id,
            enable_thinking=enable_thinking,
        )
    reasoning_content = result.reasoning_content if enable_thinking is True else None
    return {
        "content": result.content,
        "reasoning_content": reasoning_content,
    }


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
    enable_thinking: bool | None = None,
) -> dict[str, str | None]:
    """Orchestrate a full inference call (text → text).

    This is the original entry-point used by the chat endpoint.
    """
    # Resolve per-project LLM model
    llm_model_id = resolve_pipeline_model_id(db, project_id=project_id, model_type="llm")

    return await _build_and_call_llm(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_id=conversation_id,
        user_message=user_message,
        recent_messages=recent_messages,
        llm_model_id=llm_model_id,
        enable_thinking=enable_thinking,
    )


# ---------------------------------------------------------------------------
# Public API: streaming text inference (SSE)
# ---------------------------------------------------------------------------


async def orchestrate_inference_stream(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    user_message: str,
    recent_messages: list[dict[str, str]],
    enable_thinking: bool | None = None,
    user_id: str | None = None,
) -> AsyncIterator[dict]:
    """Streaming variant of :func:`orchestrate_inference`.

    Yields SSE-style event dicts as tokens arrive from the model:

    * ``{"event": "message_start", "data": {"role": "assistant"}}``
    * ``{"event": "token", "data": {"content": "..."}}``
    * ``{"event": "reasoning", "data": {"content": "..."}}``
    * ``{"event": "message_done", "data": {"content": ..., "reasoning_content": ...}}``

    On error an ``{"event": "error", "data": {"message": ...}}`` is emitted.
    """
    llm_model_id = resolve_pipeline_model_id(db, project_id=project_id, model_type="llm")

    messages = await _assemble_llm_context(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_id=conversation_id,
        user_message=user_message,
        recent_messages=recent_messages,
    )

    yield {"event": "message_start", "data": {"role": "assistant"}}

    full_content = ""
    full_reasoning = ""
    should_emit_reasoning = enable_thinking is True

    try:
        async for chunk in chat_completion_stream(
            messages,
            model=llm_model_id,
            enable_thinking=enable_thinking,
        ):
            if should_emit_reasoning and chunk.reasoning_content:
                full_reasoning += chunk.reasoning_content
                yield {"event": "reasoning", "data": {"content": chunk.reasoning_content}}
            if chunk.content:
                full_content += chunk.content
                yield {"event": "token", "data": {"content": chunk.content}}
    except Exception as exc:  # noqa: BLE001
        logger.exception("Streaming inference error")
        yield {"event": "error", "data": {"message": str(exc)}}
        return

    yield {
        "event": "message_done",
        "data": {
            "content": full_content,
            "reasoning_content": (full_reasoning or None) if should_emit_reasoning else None,
        },
    }


async def transcribe_audio_input_for_project(
    db: Session,
    *,
    project_id: str,
    audio_bytes: bytes,
    filename: str = "audio.wav",
    content_type: str | None = None,
) -> str:
    from app.services.asr_client import transcribe_audio, transcribe_audio_realtime

    asr_model_id = resolve_pipeline_model_id(db, project_id=project_id, model_type="asr")
    asr_model_info = (
        db.query(ModelCatalog).filter(ModelCatalog.model_id == asr_model_id).first()
    )
    asr_is_realtime = asr_model_info is not None and "realtime" in (asr_model_info.capabilities or [])
    runtime_model_id = (
        asr_model_id
        if asr_model_id.startswith(_OPENAI_COMPATIBLE_ASR_PREFIXES)
        else "qwen3-asr-flash"
    )

    if asr_is_realtime:
        return await transcribe_audio_realtime(audio_bytes, model=asr_model_id)
    return await transcribe_audio(audio_bytes, filename=filename, model=runtime_model_id, content_type=content_type)


async def synthesize_speech_for_project(
    db: Session,
    *,
    project_id: str,
    text: str,
) -> bytes:
    from app.services.tts_client import synthesize_speech, synthesize_speech_realtime

    tts_model_id = resolve_pipeline_model_id(db, project_id=project_id, model_type="tts")
    tts_model_info = (
        db.query(ModelCatalog).filter(ModelCatalog.model_id == tts_model_id).first()
    )
    tts_is_realtime = tts_model_info is not None and "realtime" in (tts_model_info.capabilities or [])
    runtime_model_id = (
        tts_model_id
        if tts_model_id.startswith(_OPENAI_COMPATIBLE_TTS_PREFIXES)
        else "qwen3-tts-flash"
    )

    if tts_is_realtime:
        return await synthesize_speech_realtime(text, model=tts_model_id)
    return await synthesize_speech(text, model=runtime_model_id)


async def transcribe_realtime_audio_input_for_project(
    db: Session,
    *,
    project_id: str,
    audio_bytes: bytes,
) -> str:
    from app.services.asr_client import transcribe_audio_realtime

    asr_model_id = resolve_pipeline_model_id(db, project_id=project_id, model_type="realtime_asr")
    return await transcribe_audio_realtime(audio_bytes, model=asr_model_id)


async def synthesize_realtime_speech_for_project(
    db: Session,
    *,
    project_id: str,
    text: str,
) -> bytes:
    from app.services.tts_client import synthesize_speech_realtime

    tts_model_id = resolve_pipeline_model_id(db, project_id=project_id, model_type="realtime_tts")
    return await synthesize_speech_realtime(text, model=tts_model_id)


async def orchestrate_synthetic_realtime_turn(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    audio_bytes: bytes,
    image_bytes: bytes | None = None,
    image_mime_type: str = "image/jpeg",
    video_bytes: bytes | None = None,
    video_mime_type: str = "video/mp4",
    enable_thinking: bool | None = None,
) -> dict[str, str | None]:
    user_text = await transcribe_realtime_audio_input_for_project(
        db,
        project_id=project_id,
        audio_bytes=audio_bytes,
    )
    return await orchestrate_synthetic_realtime_turn_from_text(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_id=conversation_id,
        user_text=user_text,
        image_bytes=image_bytes,
        image_mime_type=image_mime_type,
        video_bytes=video_bytes,
        video_mime_type=video_mime_type,
        enable_thinking=enable_thinking,
    )


async def orchestrate_synthetic_realtime_turn_from_text(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    user_text: str,
    image_bytes: bytes | None = None,
    image_mime_type: str = "image/jpeg",
    video_bytes: bytes | None = None,
    video_mime_type: str = "video/mp4",
    enable_thinking: bool | None = None,
) -> dict[str, str | None]:
    normalized_user_text = user_text.strip()
    if not normalized_user_text:
        return {"text_input": "", "text_response": ""}

    llm_model_id = resolve_pipeline_model_id(db, project_id=project_id, model_type="llm")
    recent_msgs = load_recent_messages(db, conversation_id=conversation_id, limit=20)
    llm_result = await _build_and_call_llm(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_id=conversation_id,
        user_message=normalized_user_text,
        recent_messages=recent_msgs,
        llm_model_id=llm_model_id,
        image_bytes=image_bytes,
        image_mime_type=image_mime_type,
        video_bytes=video_bytes,
        video_mime_type=video_mime_type,
        enable_thinking=enable_thinking,
    )
    return {
        "text_input": normalized_user_text,
        "text_response": llm_result["content"] or "",
        "reasoning_content": llm_result["reasoning_content"],
    }


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
    audio_filename: str | None = None,
    image_bytes: bytes | None = None,
    image_mime_type: str = "image/jpeg",
    text_input: str | None = None,
    return_audio: bool = True,
    enable_thinking: bool | None = None,
) -> dict:
    """Full voice pipeline orchestration.

    Returns:
        {
            "text_input": str,          # What the user said (after ASR)
            "text_response": str,       # AI's text response
            "audio_response": bytes | None,  # AI's voice (after TTS)
            "reasoning_content": str | None,
        }
    """
    from app.services.vision_client import describe_image

    # ⓪ Check for omni model (handles audio in/out directly)  -------------
    llm_model_id = resolve_pipeline_model_id(db, project_id=project_id, model_type="llm")

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
        recent_msgs = load_recent_messages(db, conversation_id=conversation_id, limit=20)

        user_text = text_input or "(audio input)"

        # Build system prompt via shared helper internals
        # We reuse _build_and_call_llm logic but need multimodal input,
        # so we assemble system prompt here and call omni_completion directly.
        knowledge_chunks: list[dict] = []
        try:
            with db.begin_nested():
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
            logger.exception("Omni RAG lookup failed; continuing without semantic context")

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
        personality = extract_personality(project.description) if project else ""

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
            image_mime_type=image_mime_type,
            model=llm_model_id,
            enable_thinking=enable_thinking,
        )
        text_response = omni_result["text"]

        # TTS: still separate for now (omni audio output requires WebSocket streaming)
        audio_response: bytes | None = None
        if return_audio and text_response:
            try:
                with db.begin_nested():
                    audio_response = await synthesize_speech_for_project(
                        db,
                        project_id=project_id,
                        text=text_response,
                    )
            except Exception:  # noqa: BLE001
                logger.warning("Realtime TTS failed in omni pipeline", exc_info=True)

        return {
            "text_input": user_text,
            "text_response": text_response,
            "audio_response": audio_response,
            "reasoning_content": omni_result.get("reasoning_content"),
        }

    # ① ASR: audio → text  ------------------------------------------------
    user_text = text_input or ""
    if audio_bytes and not text_input:
        user_text = await transcribe_audio_input_for_project(
            db,
            project_id=project_id,
            audio_bytes=audio_bytes,
            filename=audio_filename or "audio.wav",
        )

    if not user_text.strip():
        return {"text_input": "", "text_response": "未检测到语音内容", "audio_response": None}

    # ② Get LLM config and capabilities  ----------------------------------
    llm_model_id = resolve_pipeline_model_id(db, project_id=project_id, model_type="llm")

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
    recent_msgs = load_recent_messages(db, conversation_id=conversation_id, limit=20)

    # If we have an image description from a separate Vision model, prepend
    enriched_text = user_text
    if image_description:
        enriched_text = f"[用户发送了一张图片，内容是：{image_description}]\n{user_text}"

    # ⑤ Call LLM (reuses shared helper)  -----------------------------------
    llm_result = await _build_and_call_llm(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_id=conversation_id,
        user_message=enriched_text,
        recent_messages=recent_msgs,
        llm_model_id=llm_model_id,
        image_bytes=image_bytes if use_multimodal_llm else None,
        image_mime_type=image_mime_type,
        enable_thinking=enable_thinking,
    )
    text_response = llm_result["content"] or ""

    # ⑥ TTS: text → audio  ------------------------------------------------
    audio_response: bytes | None = None
    if return_audio and text_response:
        try:
            with db.begin_nested():
                audio_response = await synthesize_speech_for_project(
                    db,
                    project_id=project_id,
                    text=text_response,
                )
        except Exception:  # noqa: BLE001
            logger.warning("TTS failed in voice pipeline", exc_info=True)

    return {
        "text_input": user_text,
        "text_response": text_response,
        "audio_response": audio_response,
        "reasoning_content": llm_result["reasoning_content"],
    }

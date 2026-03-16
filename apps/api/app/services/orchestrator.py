from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.entities import Memory, ModelCatalog, PipelineConfig, Project
from app.services.dashscope_client import chat_completion, omni_completion
from app.services.embedding import search_similar


# ---------------------------------------------------------------------------
# Shared helper: build system prompt + call LLM
# ---------------------------------------------------------------------------


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
        if image_bytes:
            # Multimodal call – pass image directly to a vision-capable LLM
            from app.services.vision_client import chat_with_image

            response = await chat_with_image(image_bytes, messages, model=llm_model_id)
        else:
            response = await chat_completion(messages, model=llm_model_id)
        return response
    except Exception as e:  # noqa: BLE001
        return f"抱歉，AI 暂时无法响应。错误信息：{e!s}"


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
    from app.services.asr_client import transcribe_audio
    from app.services.tts_client import synthesize_speech
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
        except Exception:  # noqa: BLE001
            pass

        permanent_memories = (
            db.query(Memory)
            .filter(Memory.project_id == project_id, Memory.type == "permanent")
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
        project = db.query(Project).filter(Project.id == project_id).first()
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

        try:
            omni_result = await omni_completion(
                messages,
                audio_bytes=audio_bytes,
                image_bytes=image_bytes,
                model=llm_model_id,
            )
            text_response = omni_result["text"]
        except Exception as e:  # noqa: BLE001
            text_response = f"抱歉，AI 暂时无法响应。错误信息：{e!s}"

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
            audio_response = await synthesize_speech(text_response, model=tts_model)
        except Exception:  # noqa: BLE001
            pass  # TTS failure is non-fatal

    return {
        "text_input": user_text,
        "text_response": text_response,
        "audio_response": audio_response,
    }

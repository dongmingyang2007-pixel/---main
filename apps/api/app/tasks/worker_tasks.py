from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import text as sql_text

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import (
    Artifact,
    Conversation,
    DataItem,
    Dataset,
    Embedding,
    Memory,
    MemoryEdge,
    MemoryFile,
    Message,
    Model,
    ModelVersion,
    PipelineConfig,
    Project,
    TrainingJob,
    TrainingRun,
)
from app.services.audit import write_audit_log
from app.services.memory_metadata import normalize_memory_metadata
from app.services.memory_roots import ensure_project_assistant_root
from app.services.memory_visibility import build_private_memory_metadata
from app.services.runtime_state import runtime_state
from app.services.storage import delete_object
from app.services import dashscope_client
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.worker_tasks.process_data_item")
def process_data_item(data_item_id: str) -> None:
    db = SessionLocal()
    try:
        item = db.get(DataItem, data_item_id)
        if not item or item.deleted_at is not None:
            return

        # v0.1 keeps dataset processing mock-only until object content inspection is wired up.
        pseudo = f"{item.dataset_id}:{item.filename}:{item.size_bytes}".encode()
        item.sha256 = hashlib.sha256(pseudo).hexdigest()

        if item.media_type.startswith("image/"):
            item.width = item.width or 1024
            item.height = item.height or 768

        item.meta_json = {**(item.meta_json or {}), "processed": True, "mock": True}

        write_audit_log(
            db,
            workspace_id=None,
            actor_user_id=None,
            action="data_item.processed",
            target_type="data_item",
            target_id=item.id,
            meta_json={"dataset_id": item.dataset_id},
        )
        db.commit()
    finally:
        db.close()


def _delete_object_keys(object_keys: set[str]) -> bool:
    success = True
    for object_key in sorted(object_keys):
        if not object_key:
            continue
        try:
            delete_object(bucket_name=settings.s3_private_bucket, object_key=object_key)
        except Exception:  # noqa: BLE001
            success = False
    return success


def _delete_object_if_present(*, bucket_name: str, object_key: str | None) -> bool:
    if not object_key:
        return True
    try:
        delete_object(bucket_name=bucket_name, object_key=object_key)
    except Exception:  # noqa: BLE001
        return False
    return True


@celery_app.task(name="app.tasks.worker_tasks.cleanup_pending_upload_session")
def cleanup_pending_upload_session(
    upload_id: str,
    object_key: str | None = None,
    data_item_id: str | None = None,
) -> None:
    session = runtime_state.get_json(f"upload:{upload_id}", "session")
    clear_session = True
    db = SessionLocal()
    try:
        resolved_data_item_id = data_item_id
        resolved_object_key = object_key
        if session:
            session_data_item_id = session.get("data_item_id")
            if isinstance(session_data_item_id, str) and session_data_item_id:
                resolved_data_item_id = session_data_item_id
            session_object_key = session.get("object_key")
            if isinstance(session_object_key, str) and session_object_key:
                resolved_object_key = session_object_key

        item = None
        if isinstance(resolved_data_item_id, str) and resolved_data_item_id:
            item = db.get(DataItem, resolved_data_item_id)
            if item and (item.meta_json or {}).get("upload_status") != "completed":
                if item.deleted_at is None:
                    item.deleted_at = datetime.now(timezone.utc)
                item.meta_json = {
                    **(item.meta_json or {}),
                    "cleanup_marked": True,
                    "upload_status": "abandoned",
                }
                db.commit()
        if item and (item.meta_json or {}).get("upload_status") == "completed" and item.deleted_at is None:
            return
        deleted = _delete_object_if_present(bucket_name=settings.s3_private_bucket, object_key=resolved_object_key)
        if not deleted and resolved_object_key:
            clear_session = False
            try:
                cleanup_pending_upload_session.apply_async(
                    args=[upload_id, resolved_object_key, resolved_data_item_id],
                    countdown=60,
                )
            except Exception:  # noqa: BLE001
                pass
    finally:
        db.close()
        if clear_session:
            runtime_state.delete(f"upload:{upload_id}", "session")


@celery_app.task(name="app.tasks.worker_tasks.cleanup_pending_model_artifact_upload")
def cleanup_pending_model_artifact_upload(
    artifact_upload_id: str,
    object_key: str | None = None,
) -> None:
    session = runtime_state.get_json(f"model-artifact:{artifact_upload_id}", "session")
    resolved_object_key = object_key
    clear_session = True
    if session:
        session_object_key = session.get("object_key")
        if isinstance(session_object_key, str) and session_object_key:
            resolved_object_key = session_object_key

    if resolved_object_key:
        db = SessionLocal()
        try:
            live_reference = (
                db.query(ModelVersion.id)
                .filter(
                    ModelVersion.artifact_object_key == resolved_object_key,
                    ModelVersion.deleted_at.is_(None),
                )
                .first()
            )
            if not live_reference:
                deleted = _delete_object_if_present(
                    bucket_name=settings.s3_private_bucket,
                    object_key=resolved_object_key,
                )
                if not deleted:
                    clear_session = False
                    try:
                        cleanup_pending_model_artifact_upload.apply_async(
                            args=[artifact_upload_id, resolved_object_key],
                            countdown=60,
                        )
                    except Exception:  # noqa: BLE001
                        pass
        finally:
            db.close()
    if clear_session:
        runtime_state.delete(f"model-artifact:{artifact_upload_id}", "session")


@celery_app.task(name="app.tasks.worker_tasks.cleanup_pending_demo_request")
def cleanup_pending_demo_request(
    request_id: str,
    object_key: str | None = None,
    upload_id: str | None = None,
    client_ip: str | None = None,
) -> None:
    session = runtime_state.get_json(f"demo:request:{request_id}", "session")
    resolved_object_key = object_key
    resolved_upload_id = upload_id
    resolved_client_ip = client_ip
    clear_session = True
    if session:
        session_object_key = session.get("object_key")
        if isinstance(session_object_key, str) and session_object_key:
            resolved_object_key = session_object_key
        session_upload_id = session.get("upload_id")
        if isinstance(session_upload_id, str) and session_upload_id:
            resolved_upload_id = session_upload_id
        session_client_ip = session.get("client_ip")
        if isinstance(session_client_ip, str) and session_client_ip:
            resolved_client_ip = session_client_ip

    deleted = _delete_object_if_present(
        bucket_name=settings.s3_demo_bucket,
        object_key=resolved_object_key,
    )
    if not deleted and resolved_object_key:
        clear_session = False
        try:
            cleanup_pending_demo_request.apply_async(
                args=[request_id, resolved_object_key, resolved_upload_id, resolved_client_ip],
                countdown=60,
            )
        except Exception:  # noqa: BLE001
            pass
        return
    if isinstance(resolved_client_ip, str) and resolved_client_ip and session and not session.get("slot_released"):
        runtime_state.decr("demo:active", resolved_client_ip)
    if isinstance(resolved_upload_id, str) and resolved_upload_id:
        runtime_state.delete(f"demo:upload:{resolved_upload_id}", "session")
    if clear_session:
        runtime_state.delete(f"demo:request:{request_id}", "session")


@celery_app.task(name="app.tasks.worker_tasks.cleanup_deleted_dataset")
def cleanup_deleted_dataset(dataset_id: str) -> None:
    db = SessionLocal()
    try:
        dataset = db.get(Dataset, dataset_id)
        if not dataset:
            return
        dataset.cleanup_status = "running"
        db.flush()

        items = db.query(DataItem).filter(DataItem.dataset_id == dataset_id).all()
        object_keys = {item.object_key for item in items}
        for item in items:
            if item.deleted_at is None:
                item.deleted_at = datetime.now(timezone.utc)
            item.meta_json = {**(item.meta_json or {}), "cleanup_marked": True}

        dataset.cleanup_status = "done" if _delete_object_keys(object_keys) else "failed"
        db.commit()
    finally:
        db.close()


@celery_app.task(name="app.tasks.worker_tasks.cleanup_deleted_project")
def cleanup_deleted_project(project_id: str) -> None:
    db = SessionLocal()
    try:
        project = db.get(Project, project_id)
        if not project:
            return
        project.cleanup_status = "running"
        db.flush()

        object_keys: set[str] = set()
        datasets = db.query(Dataset).filter(Dataset.project_id == project_id).all()
        for dataset in datasets:
            if dataset.deleted_at is None:
                dataset.deleted_at = datetime.now(timezone.utc)
            dataset.cleanup_status = "pending"
            items = db.query(DataItem).filter(DataItem.dataset_id == dataset.id).all()
            for item in items:
                object_keys.add(item.object_key)
                if item.deleted_at is None:
                    item.deleted_at = datetime.now(timezone.utc)
                item.meta_json = {**(item.meta_json or {}), "cleanup_marked": True}

        models = db.query(Model).filter(Model.project_id == project_id).all()
        for model in models:
            versions = db.query(ModelVersion).filter(ModelVersion.model_id == model.id).all()
            for version in versions:
                object_keys.add(version.artifact_object_key)

        artifacts = (
            db.query(Artifact)
            .join(TrainingRun, TrainingRun.id == Artifact.run_id)
            .join(TrainingJob, TrainingJob.id == TrainingRun.training_job_id)
            .filter(TrainingJob.project_id == project_id)
            .all()
        )
        for artifact in artifacts:
            object_keys.add(artifact.object_key)
        runs = (
            db.query(TrainingRun)
            .join(TrainingJob, TrainingJob.id == TrainingRun.training_job_id)
            .filter(TrainingJob.project_id == project_id)
            .all()
        )
        for run in runs:
            if run.logs_object_key:
                object_keys.add(run.logs_object_key)

        conversation_ids = [
            conversation_id
            for conversation_id, in db.query(Conversation.id).filter(Conversation.project_id == project_id).all()
        ]
        memory_ids = [
            memory_id for memory_id, in db.query(Memory.id).filter(Memory.project_id == project_id).all()
        ]
        if memory_ids:
            db.query(MemoryEdge).filter(
                (MemoryEdge.source_memory_id.in_(memory_ids)) | (MemoryEdge.target_memory_id.in_(memory_ids))
            ).delete(synchronize_session=False)
            db.query(MemoryFile).filter(MemoryFile.memory_id.in_(memory_ids)).delete(synchronize_session=False)
        db.query(Embedding).filter(Embedding.project_id == project_id).delete(synchronize_session=False)
        db.query(Memory).filter(Memory.project_id == project_id).delete(synchronize_session=False)
        if conversation_ids:
            db.query(Message).filter(Message.conversation_id.in_(conversation_ids)).delete(synchronize_session=False)
        db.query(Conversation).filter(Conversation.project_id == project_id).delete(synchronize_session=False)
        db.query(PipelineConfig).filter(PipelineConfig.project_id == project_id).delete(synchronize_session=False)

        project.cleanup_status = "done" if _delete_object_keys(object_keys) else "failed"
        db.commit()
    finally:
        db.close()


@celery_app.task(name="app.tasks.worker_tasks.index_data_item")
def index_data_item(
    workspace_id: str,
    project_id: str,
    data_item_id: str,
    object_key: str,
    filename: str,
) -> None:
    """Download file from S3, extract text, chunk, and vectorize for RAG."""
    import asyncio

    from app.services.document_indexer import index_document
    from app.services.embedding import delete_embeddings_for_data_item
    from app.services.memory_file_context import sync_memory_links_for_data_item
    from app.services.storage import get_s3_client

    logger.info("index_data_item started: item_id=%s, filename=%s", data_item_id, filename)

    if not settings.dashscope_api_key:
        logger.warning("index_data_item skipped: no dashscope_api_key configured (item_id=%s)", data_item_id)
        return

    db = SessionLocal()
    try:
        item = db.get(DataItem, data_item_id)
        if not item or item.deleted_at is not None:
            return

        s3 = get_s3_client()
        response = s3.get_object(
            Bucket=settings.s3_private_bucket,
            Key=object_key,
        )
        content = response["Body"].read()

        delete_embeddings_for_data_item(db, data_item_id)
        asyncio.run(
            index_document(
                db,
                workspace_id=workspace_id,
                project_id=project_id,
                data_item_id=data_item_id,
                content=content,
                filename=filename,
            ),
        )
        sync_memory_links_for_data_item(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            data_item_id=data_item_id,
        )
    except Exception:  # noqa: BLE001
        logger.exception("index_data_item failed for item %s", data_item_id)
        db.rollback()
        try:
            item = db.get(DataItem, data_item_id)
            if item:
                item.meta_json = {**(item.meta_json or {}), "upload_status": "index_failed"}
                db.commit()
        except Exception:  # noqa: BLE001
            logger.exception("index_data_item could not update status to index_failed for item %s", data_item_id)
            db.rollback()
    finally:
        db.close()


TRIAGE_PROMPT = """你是记忆管理器。判断一条新事实与已有记忆的关系。

新事实：{fact}

已有记忆：
{candidates_formatted}

请选择一个操作：
- create: 新事实是全新话题，与已有记忆无关，应独立创建
- append: 新事实是对某条已有记忆的补充/细节，应挂载为其子记忆
- merge: 新事实和某条已有记忆说的是同一件事，应合并为一条更完整的记忆
- replace: 新事实表明情况已变化（如搬家、换工作），应替换旧信息
- discard: 新事实和某条已有记忆实质重复，无需保存

输出 JSON：
{{"action": "...", "target_memory_id": "...", "merged_content": "合并/替换后的完整内容", "reason": "一句话解释"}}

规则：
- target_memory_id：create 和 discard 时为 null，其他操作必须指定
- merged_content：仅 merge 和 replace 时需要，其他为 null
- merge 时写出合并后的完整内容，不要丢失原有信息
- replace 时写出替换后的内容，旧信息不再保留"""


async def triage_memory(
    fact: str,
    candidates: list[dict],
) -> dict:
    """Call lightweight LLM to decide how to file a new fact against existing memories.

    Returns {"action": "create|append|merge|replace|discard",
             "target_memory_id": str | None,
             "merged_content": str | None,
             "reason": str | None}
    """
    from app.core.config import settings

    candidates_formatted = "\n".join(
        f"- ID: {c['memory_id']} | 分类: {c['category']} | 内容: {c['content']}"
        for c in candidates
    )

    prompt = TRIAGE_PROMPT.format(
        fact=fact,
        candidates_formatted=candidates_formatted,
    )

    fallback = {"action": "create", "target_memory_id": None, "merged_content": None, "reason": None}

    try:
        raw = await dashscope_client.chat_completion(
            [{"role": "user", "content": prompt}],
            model=settings.memory_triage_model,
            temperature=0.1,
            max_tokens=256,
        )
    except Exception:  # noqa: BLE001
        return fallback

    # Parse JSON (handle markdown code blocks)
    json_match = re.search(r"\{.*\}", raw.strip(), re.DOTALL)
    if not json_match:
        return fallback

    try:
        decision = json.loads(json_match.group(0))
    except (json.JSONDecodeError, ValueError):
        return fallback

    if decision.get("action") not in ("create", "append", "merge", "replace", "discard"):
        return fallback

    return decision


@celery_app.task(name="app.tasks.worker_tasks.extract_memories")
def extract_memories(
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    user_message: str,
    ai_response: str,
) -> None:
    """Extract factual memories from a conversation turn.
    Called asynchronously after each message exchange."""
    import asyncio
    import json
    import re

    from app.models.entities import Memory
    from app.services.dashscope_client import chat_completion
    from app.services.embedding import embed_and_store, find_duplicate_memory_with_vector, find_related_memories

    EXTRACTION_PROMPT = """你是一个记忆提取器。分析以下对话，提取值得记住的事实。

规则：
- 只提取具体事实，不提取观点或推测
- 事实必须关于用户本人（身份、偏好、计划、经历、关系）
- 不提取一般性知识（如"北京是中国首都"）
- 每个事实用一句话表达
- importance: 0-1，其中 >=0.7 创建为临时记忆，>=0.9 直接升级为永久记忆
- category: 用中文，层级用点分隔（如"工作.计划"、"健康.用药"）

对话内容：
用户：{user_message}
AI：{ai_response}

输出 JSON 数组：
[{{"fact": "...", "category": "...", "importance": 0.0}}]

如果没有值得记忆的事实，输出空数组 []。"""

    db = SessionLocal()
    try:
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
            return
        conversation = (
            db.query(Conversation)
            .filter(
                Conversation.id == conversation_id,
                Conversation.project_id == project_id,
                Conversation.workspace_id == workspace_id,
            )
            .first()
        )
        if not conversation:
            return

        prompt = EXTRACTION_PROMPT.format(
            user_message=user_message,
            ai_response=ai_response,
        )

        # ── Async helper: extract, dedup, and embed in a single event loop ──
        async def _extract_and_store_facts() -> None:
            raw_response = await chat_completion(
                [{"role": "user", "content": prompt}],
                temperature=0.1,  # Low temperature for structured extraction
                max_tokens=1024,
            )

            # Parse JSON from response (handle markdown code blocks)
            json_str = raw_response.strip()
            json_match = re.search(r"\[.*\]", json_str, re.DOTALL)
            if not json_match:
                return

            facts = json.loads(json_match.group(0))
            if not facts:
                return

            # Save extracted facts to the AI message's metadata for frontend display
            try:
                ai_msg = (
                    db.query(Message)
                    .filter(
                        Message.conversation_id == conversation_id,
                        Message.role == "assistant",
                    )
                    .order_by(Message.created_at.desc())
                    .first()
                )
                if ai_msg:
                    existing_meta = ai_msg.metadata_json or {}
                    existing_meta["extracted_facts"] = [
                        {"fact": f.get("fact", ""), "category": f.get("category", ""), "importance": f.get("importance", 0)}
                        for f in facts
                    ]
                    ai_msg.metadata_json = existing_meta
                    db.flush()
            except Exception:  # noqa: BLE001
                pass  # Non-fatal: display data only

            for fact in facts:
                importance = fact.get("importance", 0)
                if importance < 0.7:
                    continue

                fact_text = fact.get("fact", "")
                if not fact_text.strip():
                    continue

                # Deduplication: skip if a highly similar memory already exists
                try:
                    duplicate, query_vector = await find_duplicate_memory_with_vector(
                        db,
                        workspace_id=workspace_id,
                        project_id=project_id,
                        text=fact_text,
                        threshold=settings.memory_triage_similarity_high,
                    )
                    if duplicate:
                        continue
                except Exception:  # noqa: BLE001
                    query_vector = None  # Dedup check failure is non-fatal

                # ── Memory Triage: check for related (but not duplicate) memories ──
                parent_memory_id = None
                if query_vector:
                    try:
                        candidates = await find_related_memories(
                            db,
                            workspace_id=workspace_id,
                            project_id=project_id,
                            query_vector=query_vector,
                            low=settings.memory_triage_similarity_low,
                            high=settings.memory_triage_similarity_high,
                        )
                    except Exception:  # noqa: BLE001
                        candidates = []

                    if candidates:
                        candidate_ids = {c["memory_id"] for c in candidates}
                        try:
                            decision = await triage_memory(fact_text, candidates)
                        except Exception:  # noqa: BLE001
                            decision = {"action": "create"}

                        action = decision.get("action", "create")
                        target_id = decision.get("target_memory_id")
                        merged = decision.get("merged_content")

                        # Validate target_id comes from candidate list
                        if target_id and target_id not in candidate_ids:
                            action = "create"

                        if action == "discard":
                            continue

                        if action == "append" and target_id:
                            target = db.query(Memory).filter(
                                Memory.id == target_id,
                                Memory.project_id == project_id,
                            ).first()
                            if target:
                                parent_memory_id = target_id
                            # else: fallthrough to create

                        elif action in ("merge", "replace") and target_id and merged:
                            target = db.query(Memory).filter(
                                Memory.id == target_id,
                                Memory.project_id == project_id,
                            ).first()
                            if target:
                                target.content = merged
                                target.metadata_json = normalize_memory_metadata(
                                    content=merged,
                                    category=target.category,
                                    memory_type=target.type,
                                    metadata=dict(target.metadata_json or {}),
                                )
                                db.execute(
                                    sql_text("DELETE FROM embeddings WHERE memory_id = :mid"),
                                    {"mid": target_id},
                                )
                                try:
                                    await embed_and_store(
                                        db,
                                        workspace_id=workspace_id,
                                        project_id=project_id,
                                        memory_id=target_id,
                                        chunk_text=merged,
                                        auto_commit=False,
                                    )
                                except Exception:  # noqa: BLE001
                                    pass
                                continue  # Don't create a new memory
                            # else: fallthrough to create

                memory_type = "permanent" if importance >= 0.9 and conversation.created_by else "temporary"
                metadata = {"importance": importance, "source": "auto_extraction"}
                if memory_type == "permanent":
                    metadata = build_private_memory_metadata(metadata, owner_user_id=conversation.created_by)
                metadata = normalize_memory_metadata(
                    content=fact_text,
                    category=fact.get("category", ""),
                    memory_type=memory_type,
                    metadata=metadata,
                )

                if parent_memory_id is None:
                    project = db.get(Project, project_id)
                    if project:
                        root_memory, _ = ensure_project_assistant_root(
                            db,
                            project,
                            reparent_orphans=False,
                        )
                        parent_memory_id = root_memory.id

                memory = Memory(
                    workspace_id=workspace_id,
                    project_id=project_id,
                    content=fact_text,
                    category=fact.get("category", ""),
                    type=memory_type,
                    source_conversation_id=conversation_id if memory_type == "temporary" else None,
                    parent_memory_id=parent_memory_id,
                    metadata_json=metadata,
                )
                db.add(memory)
                db.flush()

                # Embed the memory for future RAG retrieval
                try:
                    await embed_and_store(
                        db,
                        workspace_id=workspace_id,
                        project_id=project_id,
                        memory_id=memory.id,
                        chunk_text=memory.content,
                        vector=query_vector,
                        auto_commit=False,
                    )
                except Exception:  # noqa: BLE001
                    pass  # Embedding failure is non-fatal

        # Run all async work in a single event loop
        asyncio.run(_extract_and_store_facts())

        # ── Auto-promotion: temporary → permanent when same fact appears in 2+ conversations ──
        # A temporary memory should auto-promote to permanent if:
        # 1. The same fact appears in 2+ different conversations (vector similarity > 0.85)
        # 2. The extraction marked it with importance >= 0.9 (already handled above)
        temp_memories = db.query(Memory).filter(
            Memory.project_id == project_id,
            Memory.type == "temporary",
        ).all()

        for mem in temp_memories:
            # Check if similar content exists in other conversations
            similar = db.execute(
                sql_text("""
                    SELECT COUNT(DISTINCT m.source_conversation_id)
                    FROM memories m
                    JOIN embeddings e ON e.memory_id = m.id
                    WHERE m.project_id = :project_id
                      AND m.id != :memory_id
                      AND m.source_conversation_id != :conv_id
                      AND e.vector IS NOT NULL
                      AND EXISTS (
                          SELECT 1 FROM embeddings e2
                          WHERE e2.memory_id = :memory_id
                            AND e2.vector IS NOT NULL
                            AND 1 - (e.vector <=> e2.vector) > 0.85
                      )
                """),
                {
                    "project_id": project_id,
                    "memory_id": mem.id,
                    "conv_id": conversation_id,
                },
            ).scalar()

            if similar and similar >= 1:  # Found in at least 1 other conversation
                owner_user_id = None
                if mem.source_conversation_id:
                    source_conversation = (
                        db.query(Conversation.created_by)
                        .filter(
                            Conversation.id == mem.source_conversation_id,
                            Conversation.project_id == project_id,
                            Conversation.workspace_id == workspace_id,
                        )
                        .first()
                    )
                    owner_user_id = source_conversation[0] if source_conversation else None
                if not owner_user_id:
                    continue
                mem.type = "permanent"
                mem.source_conversation_id = None  # Detach from conversation
                mem.metadata_json = normalize_memory_metadata(
                    content=mem.content,
                    category=mem.category,
                    memory_type="permanent",
                    metadata=build_private_memory_metadata(
                        {**(mem.metadata_json or {}), "promoted_by": "auto_repeat"},
                        owner_user_id=owner_user_id,
                    ),
                )

        db.commit()
        try:
            if settings.env == "test":
                compact_project_memories_task(workspace_id, project_id)
            else:
                compact_project_memories_task.delay(workspace_id, project_id)
        except Exception:  # noqa: BLE001
            pass
    except Exception:  # noqa: BLE001
        db.rollback()
    finally:
        db.close()


@celery_app.task(name="app.tasks.worker_tasks.compact_project_memories")
def compact_project_memories_task(
    workspace_id: str,
    project_id: str,
) -> None:
    import asyncio

    from app.services.memory_compaction import compact_project_memories

    db = SessionLocal()
    try:
        asyncio.run(
            compact_project_memories(
                db,
                workspace_id=workspace_id,
                project_id=project_id,
            )
        )
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
    finally:
        db.close()

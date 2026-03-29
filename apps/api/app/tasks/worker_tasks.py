from __future__ import annotations

import hashlib
import json
import logging
import re
import time
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
from app.services.memory_category_tree import ensure_project_category_tree
from app.services.memory_graph_events import (
    bump_project_memory_graph_revision,
    session_has_pending_graph_mutations,
)
from app.services.memory_metadata import (
    CONCEPT_NODE_KIND,
    MEMORY_KIND_GOAL,
    MEMORY_KIND_PREFERENCE,
    get_memory_kind,
    is_category_path_memory,
    is_concept_memory,
    is_summary_memory,
    normalize_memory_metadata,
)
from app.services.memory_related_edges import ensure_project_related_edges
from app.services.memory_roots import ensure_project_assistant_root, is_assistant_root_memory
from app.services.memory_visibility import build_private_memory_metadata
from app.services.runtime_state import runtime_state
from app.services.storage import delete_object
from app.services import dashscope_client
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


MEMORY_EXTRACTION_STATUS_PENDING = "pending"
MEMORY_EXTRACTION_STATUS_COMPLETED = "completed"
MEMORY_EXTRACTION_STATUS_FAILED = "failed"
MEMORY_EXTRACTION_FAILURE_SUMMARY = "本轮记忆处理失败，请稍后重试"
MEMORY_EXTRACTION_MAX_ATTEMPTS = 3
_MEMORY_EXTRACTION_UNSET = object()


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

_CONCEPT_PARENT_SUPPORTED_KINDS = {
    MEMORY_KIND_PREFERENCE,
    MEMORY_KIND_GOAL,
}

CONCEPT_TOPIC_PROMPT = """你是记忆结构规划器。给定一条用户事实，判断是否值得抽出一个更泛化的父级主题节点。

事实：{fact}
分类：{category}
记忆类型：{memory_kind}

输出 JSON：
{{"topic": "更泛化但仍紧密相关的主题词", "confidence": 0.0, "reason": "一句话说明"}}

规则：
- 只有在父级主题和原事实具有明确归属关系时才输出 topic，否则返回 null
- topic 必须比原事实更泛化，但不能跨话题
- topic 要短，优先名词或名词短语，不要整句
- 如果只是同义改写、无法安全泛化、或父子关系会显得牵强，返回 {{"topic": null, "confidence": 0.0, "reason": "..."}}"""

APPEND_PARENT_VALIDATION_PROMPT = """你是记忆层级校验器。判断“候选记忆”能不能作为“新事实”的父节点。

候选记忆：{candidate}
候选分类：{candidate_category}
新事实：{fact}
新事实分类：{fact_category}
记忆类型：{memory_kind}

输出 JSON：
{{"relation": "parent|sibling|duplicate|unrelated", "reason": "一句话说明"}}

规则：
- 只有候选记忆明显比新事实更泛化、且新事实天然归属于它时，relation 才能是 parent
- 如果两者是同一主题下的并列细项，返回 sibling
- 如果两者本质是同一事实，只是表述不同，返回 duplicate
- 如果话题并不构成稳定父子关系，返回 unrelated"""


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


def _normalize_category_segments(category: str) -> list[str]:
    return [
        segment.strip().lower()
        for segment in str(category or "").split(".")
        if segment and segment.strip()
    ]


def _shared_category_prefix_length(left: str, right: str) -> int:
    left_segments = _normalize_category_segments(left)
    right_segments = _normalize_category_segments(right)
    shared = 0
    for left_segment, right_segment in zip(left_segments, right_segments, strict=False):
        if left_segment != right_segment:
            break
        shared += 1
    return shared


def _normalize_text_key(value: str) -> str:
    normalized = re.sub(r"\s+", "", str(value or "").strip().lower())
    return re.sub(r"[，。、“”‘’\"'`()（）,.!?！？:：;；\-_/\\]+", "", normalized)


def _is_structural_parent_memory(memory: Memory | dict[str, object] | None) -> bool:
    return (
        is_assistant_root_memory(memory)
        or is_concept_memory(memory)
        or is_category_path_memory(memory)
        or is_summary_memory(memory)
    )


_FACT_LEADING_MODIFIER_PATTERN = r"(?:也|很|还|都|最|特别|真的|平时|一直|常常|经常|通常|比较|更|挺|蛮|还挺)*"
_FIRST_PERSON_FACT_PREFIX_PATTERN = re.compile(
    rf"^(?:我|本人)(?={_FACT_LEADING_MODIFIER_PATTERN}(?:喜欢|偏好|热爱|爱喝|常喝|爱吃|常吃|计划|打算|准备|希望|想要|是|在|有))"
)
_STABLE_PREFERENCE_FACT_PATTERN = re.compile(
    rf"^(?:用户|我|本人){_FACT_LEADING_MODIFIER_PATTERN}(?:喜欢|偏好|热爱|爱喝|常喝|爱吃|常吃)"
)
_STABLE_GOAL_FACT_PATTERN = re.compile(
    rf"^(?:用户|我|本人){_FACT_LEADING_MODIFIER_PATTERN}(?:计划|打算|准备|希望|想要)"
)


def _normalize_extracted_fact_text(value: str) -> str:
    normalized = re.sub(r"^[\-\*\u2022]+\s*", "", str(value or "").strip())
    normalized = re.sub(r"\s+", " ", normalized).strip()
    normalized = _FIRST_PERSON_FACT_PREFIX_PATTERN.sub("用户", normalized)
    return normalized


def _looks_like_aggregate_fact(
    fact_text: str,
    *,
    fact_category: str,
    fact_memory_kind: str,
) -> bool:
    normalized = re.sub(r"\s+", "", str(fact_text or "").strip())
    if not normalized:
        return False
    if fact_memory_kind not in {MEMORY_KIND_PREFERENCE, MEMORY_KIND_GOAL} and "偏好" not in str(fact_category or ""):
        return False
    if not any(separator in normalized for separator in ("、", "和", "以及", "及", "，", ",")):
        return False
    return bool(
        re.match(
            r"^用户(?:偏好|喜欢|喜爱|爱喝|爱吃|热爱|计划|打算|准备|想要)[^。！？!?]*[、和及以及，,][^。！？!?]*[。！？!?]?$",
            normalized,
        )
    )


def _sanitize_concept_topic(topic: str) -> str:
    cleaned = re.sub(r"\s+", "", str(topic or "").strip())
    cleaned = cleaned.strip("，。、“”‘’\"'`()（）[]【】<>《》:：;；,.!?！？")
    for suffix in ("饮品", "饮料", "食品", "食物", "类别", "类型"):
        if cleaned.endswith(suffix) and len(cleaned) > len(suffix):
            cleaned = cleaned[: -len(suffix)]
            break
    if not cleaned:
        return ""
    if len(cleaned) > 18:
        return ""
    if any(token in cleaned for token in ("用户", "事实", "记忆", "主题", "偏好", "目标")):
        return ""
    return cleaned


def _build_concept_parent_text(*, topic: str, memory_kind: str) -> str | None:
    if not topic:
        return None
    if memory_kind == MEMORY_KIND_PREFERENCE:
        return f"用户对{topic}感兴趣"
    if memory_kind == MEMORY_KIND_GOAL:
        return f"用户有{topic}相关目标"
    return None


def _build_concept_category(*, fact_category: str, topic: str) -> str:
    segments = [segment.strip() for segment in str(fact_category or "").split(".") if segment.strip()]
    if not topic:
        return ".".join(segments)
    if not segments:
        return topic
    if _normalize_text_key(segments[-1]) == _normalize_text_key(topic):
        return ".".join(segments)
    return ".".join([*segments, topic])


async def _plan_concept_parent(
    *,
    fact_text: str,
    fact_category: str,
    fact_memory_kind: str,
) -> dict[str, str] | None:
    if fact_memory_kind not in _CONCEPT_PARENT_SUPPORTED_KINDS:
        return None

    prompt = CONCEPT_TOPIC_PROMPT.format(
        fact=fact_text,
        category=fact_category or "未分类",
        memory_kind=fact_memory_kind,
    )

    try:
        raw = await dashscope_client.chat_completion(
            [{"role": "user", "content": prompt}],
            model=settings.memory_triage_model,
            temperature=0.1,
            max_tokens=128,
        )
    except Exception:  # noqa: BLE001
        return None

    json_match = re.search(r"\{.*\}", raw.strip(), re.DOTALL)
    if not json_match:
        return None

    try:
        payload = json.loads(json_match.group(0))
    except (json.JSONDecodeError, ValueError):
        return None

    topic = _sanitize_concept_topic(str(payload.get("topic") or ""))
    confidence = 0.0
    try:
        confidence = float(payload.get("confidence") or 0.0)
    except (TypeError, ValueError):
        confidence = 0.0
    if not topic or confidence < 0.78:
        return None

    parent_text = _build_concept_parent_text(topic=topic, memory_kind=fact_memory_kind)
    if not parent_text:
        return None
    if _normalize_text_key(parent_text) == _normalize_text_key(fact_text):
        return None

    return {
        "topic": topic,
        "parent_text": parent_text,
        "parent_category": _build_concept_category(fact_category=fact_category, topic=topic),
        "reason": str(payload.get("reason") or "").strip(),
    }


def _find_existing_concept_parent(
    db,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    parent_text: str,
    topic: str,
    parent_category: str,
    fact_memory_kind: str,
) -> Memory | None:
    target_key = _normalize_text_key(parent_text)
    if not target_key:
        return None
    topic_key = _normalize_text_key(topic)

    concept_memories = (
        db.query(Memory)
        .filter(
            Memory.workspace_id == workspace_id,
            Memory.project_id == project_id,
        )
        .all()
    )

    best_match: Memory | None = None
    best_score = -1
    for memory in concept_memories:
        if is_assistant_root_memory(memory) or not is_concept_memory(memory):
            continue
        if memory.type == "temporary" and memory.source_conversation_id != conversation_id:
            continue
        if get_memory_kind(memory) != fact_memory_kind:
            continue

        score = 0
        if _normalize_text_key(memory.content) == target_key:
            score += 3
        existing_topic = _normalize_text_key((memory.metadata_json or {}).get("concept_topic"))
        if topic_key and existing_topic == topic_key:
            score += 3
        elif topic_key and existing_topic and (topic_key in existing_topic or existing_topic in topic_key):
            if _shared_category_prefix_length(parent_category, memory.category) >= 1:
                score += 2
        if score > best_score:
            best_match = memory
            best_score = score

    return best_match if best_score >= 3 else None


async def _resolve_concept_parent(
    db,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    owner_user_id: str | None,
    fact_text: str,
    fact_category: str,
    fact_memory_kind: str,
) -> tuple[Memory | None, bool, str | None]:
    plan = await _plan_concept_parent(
        fact_text=fact_text,
        fact_category=fact_category,
        fact_memory_kind=fact_memory_kind,
    )
    if not plan:
        return None, False, None

    normalized_topic = _sanitize_concept_topic(plan.get("topic", ""))
    if normalized_topic and normalized_topic != plan["topic"]:
        normalized_parent_text = _build_concept_parent_text(topic=normalized_topic, memory_kind=fact_memory_kind)
        if normalized_parent_text:
            plan = {
                **plan,
                "topic": normalized_topic,
                "parent_text": normalized_parent_text,
                "parent_category": _build_concept_category(
                    fact_category=fact_category,
                    topic=normalized_topic,
                ),
            }

    existing = _find_existing_concept_parent(
        db,
        workspace_id=workspace_id,
        project_id=project_id,
        conversation_id=conversation_id,
        parent_text=plan["parent_text"],
        topic=plan["topic"],
        parent_category=plan["parent_category"],
        fact_memory_kind=fact_memory_kind,
    )
    if existing:
        return existing, False, plan.get("reason") or None

    project = db.get(Project, project_id)
    if not project:
        return None, False, None
    root_memory, _ = ensure_project_assistant_root(db, project, reparent_orphans=False)

    metadata: dict[str, object] = {
        "node_kind": CONCEPT_NODE_KIND,
        "concept_topic": plan["topic"],
        "auto_generated": True,
        "source": "auto_concept_parent",
        "salience": 0.72,
    }
    if owner_user_id:
        metadata = build_private_memory_metadata(metadata, owner_user_id=owner_user_id)
    metadata = normalize_memory_metadata(
        content=plan["parent_text"],
        category=plan["parent_category"],
        memory_type="permanent",
        metadata=metadata,
    )

    concept_memory = Memory(
        workspace_id=workspace_id,
        project_id=project_id,
        content=plan["parent_text"],
        category=plan["parent_category"],
        type="permanent",
        source_conversation_id=None,
        parent_memory_id=root_memory.id,
        metadata_json=metadata,
    )
    db.add(concept_memory)
    db.flush()

    try:
        from app.services.embedding import embed_and_store

        await embed_and_store(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            memory_id=concept_memory.id,
            chunk_text=concept_memory.content,
            auto_commit=False,
        )
    except Exception:  # noqa: BLE001
        pass

    return concept_memory, True, plan.get("reason") or None


async def _validate_append_parent(
    *,
    fact_text: str,
    fact_category: str,
    fact_memory_kind: str,
    candidate_memory: Memory,
) -> dict[str, str]:
    if is_concept_memory(candidate_memory) or is_category_path_memory(candidate_memory) or is_summary_memory(candidate_memory):
        return {"relation": "parent", "reason": "候选记忆是主题节点，可作为稳定父节点。"}

    prompt = APPEND_PARENT_VALIDATION_PROMPT.format(
        candidate=candidate_memory.content,
        candidate_category=candidate_memory.category or "未分类",
        fact=fact_text,
        fact_category=fact_category or "未分类",
        memory_kind=fact_memory_kind or "fact",
    )

    fallback = {"relation": "unrelated", "reason": "候选记忆不是稳定的父节点，回退到独立建模。"}
    try:
        raw = await dashscope_client.chat_completion(
            [{"role": "user", "content": prompt}],
            model=settings.memory_triage_model,
            temperature=0.1,
            max_tokens=128,
        )
    except Exception:  # noqa: BLE001
        return fallback

    json_match = re.search(r"\{.*\}", raw.strip(), re.DOTALL)
    if not json_match:
        return fallback
    try:
        payload = json.loads(json_match.group(0))
    except (json.JSONDecodeError, ValueError):
        return fallback

    relation = str(payload.get("relation") or "").strip().lower()
    if relation not in {"parent", "sibling", "duplicate", "unrelated"}:
        return fallback
    reason = str(payload.get("reason") or "").strip()
    if relation == "parent" and not _is_structural_parent_memory(candidate_memory):
        shared_prefix = _shared_category_prefix_length(fact_category, candidate_memory.category)
        candidate_kind = get_memory_kind(candidate_memory)
        if shared_prefix >= 1 or (fact_memory_kind and candidate_kind == fact_memory_kind):
            return {
                "relation": "sibling",
                "reason": "普通事实节点不能作为自动父节点，改为同主题并列项并归入主题节点。",
            }
        return {
            "relation": "unrelated",
            "reason": "普通事实节点不能作为自动父节点，回退到独立建模。",
        }
    return {
        "relation": relation,
        "reason": reason or fallback["reason"],
    }


async def _select_parent_memory_anchor(
    db,
    *,
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    query_vector: list[float] | None,
    fact_category: str,
    fact_memory_kind: str,
    excluded_memory_ids: set[str] | None = None,
) -> tuple[Memory | None, float]:
    if not query_vector:
        return None, 0.0

    from app.services.embedding import find_related_memories

    excluded_ids = {item for item in (excluded_memory_ids or set()) if item}
    anchor_low = max(0.55, settings.memory_triage_similarity_low - 0.12)
    try:
        candidate_rows = await find_related_memories(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
            query_vector=query_vector,
            low=anchor_low,
            high=0.999,
            limit=6,
        )
    except Exception:  # noqa: BLE001
        return None, 0.0

    candidate_ids = [
        str(row.get("memory_id") or "").strip()
        for row in candidate_rows
        if str(row.get("memory_id") or "").strip() and str(row.get("memory_id") or "").strip() not in excluded_ids
    ]
    if not candidate_ids:
        return None, 0.0

    memories = (
        db.query(Memory)
        .filter(
            Memory.project_id == project_id,
            Memory.workspace_id == workspace_id,
            Memory.id.in_(candidate_ids),
        )
        .all()
    )
    memories_by_id = {memory.id: memory for memory in memories}

    best_memory: Memory | None = None
    best_score = 0.0
    for row in candidate_rows:
        memory_id = str(row.get("memory_id") or "").strip()
        if not memory_id or memory_id in excluded_ids:
            continue
        memory = memories_by_id.get(memory_id)
        if not memory or is_assistant_root_memory(memory) or not is_concept_memory(memory):
            continue
        if memory.type == "temporary" and memory.source_conversation_id != conversation_id:
            continue

        semantic_score = float(row.get("score") or 0.0)
        combined_score = semantic_score

        shared_prefix = _shared_category_prefix_length(fact_category, memory.category)
        if shared_prefix >= 2:
            combined_score += 0.18
        elif shared_prefix == 1:
            combined_score += 0.10

        if fact_memory_kind and get_memory_kind(memory) == fact_memory_kind:
            combined_score += 0.08
        if memory.type == "permanent":
            combined_score += 0.04

        if combined_score > best_score:
            best_memory = memory
            best_score = combined_score

    if best_memory is None:
        return None, 0.0

    fact_has_category = bool(_normalize_category_segments(fact_category))
    if best_score < 0.68 and not fact_has_category:
        return None, 0.0

    return best_memory, best_score


def _upsert_auto_memory_edge(
    db,
    *,
    source_memory_id: str,
    target_memory_id: str,
    strength: float = 0.65,
) -> None:
    if not source_memory_id or not target_memory_id or source_memory_id == target_memory_id:
        return

    for pending in db.new:
        if not isinstance(pending, MemoryEdge):
            continue
        if pending.source_memory_id != source_memory_id or pending.target_memory_id != target_memory_id:
            continue
        pending.strength = max(float(pending.strength or 0.0), float(strength))
        return

    existing = (
        db.query(MemoryEdge)
        .filter(
            MemoryEdge.source_memory_id == source_memory_id,
            MemoryEdge.target_memory_id == target_memory_id,
        )
        .first()
    )
    if existing:
        existing.strength = max(float(existing.strength or 0.0), float(strength))
        return

    db.add(
        MemoryEdge(
            source_memory_id=source_memory_id,
            target_memory_id=target_memory_id,
            edge_type="auto",
            strength=max(0.1, min(1.0, float(strength))),
        )
    )


def _build_memory_extraction_summary(processed_facts: list[dict[str, object]]) -> str | None:
    counts: dict[str, int] = {}
    concept_parent_created = 0
    for fact in processed_facts:
        status = str(fact.get("status") or "").strip()
        if not status:
            status = ""
        if status:
            counts[status] = counts.get(status, 0) + 1
        if str(fact.get("parent_memory_action") or "").strip() == "created":
            concept_parent_created += 1

    if not counts and concept_parent_created == 0:
        return None

    ordered_labels = [
        ("permanent", "新增永久记忆"),
        ("temporary", "新增临时记忆"),
        ("appended", "挂接到已有记忆"),
        ("merged", "合并已有记忆"),
        ("replaced", "替换已有记忆"),
        ("duplicate", "重复跳过"),
        ("discarded", "被 triage 丢弃"),
        ("ignored", "重要度不足被忽略"),
    ]
    parts = [f"{label} {counts[key]} 条" for key, label in ordered_labels if counts.get(key)]
    if concept_parent_created:
        parts.append(f"新增主题节点 {concept_parent_created} 条")
    if not parts:
        return None
    return "；".join(parts)


def _merge_memory_extraction_metadata(
    metadata: dict[str, object] | None,
    *,
    processed_facts: list[dict[str, object]] | object = _MEMORY_EXTRACTION_UNSET,
    empty_summary: str | None = None,
    status: str | None = None,
    attempts: int | None = None,
    error: str | None = None,
) -> dict[str, object]:
    existing_meta = dict(metadata or {})

    if processed_facts is not _MEMORY_EXTRACTION_UNSET:
        facts = list(processed_facts or [])
        existing_meta["extracted_facts"] = facts

        summary = _build_memory_extraction_summary(facts) or empty_summary
        if summary:
            existing_meta["memories_extracted"] = summary
        else:
            existing_meta.pop("memories_extracted", None)

    if status:
        existing_meta["memory_extraction_status"] = status
    if attempts is not None:
        existing_meta["memory_extraction_attempts"] = attempts
    if isinstance(error, str) and error.strip():
        existing_meta["memory_extraction_error"] = error.strip()
    elif error is not None:
        existing_meta.pop("memory_extraction_error", None)

    if (
        processed_facts is not _MEMORY_EXTRACTION_UNSET
        or status is not None
        or attempts is not None
        or error is not None
    ):
        existing_meta["memory_extraction_updated_at"] = datetime.now(timezone.utc).isoformat()

    return existing_meta


def _set_memory_extraction_state(
    ai_msg: Message | None,
    *,
    processed_facts: list[dict[str, object]] | object = _MEMORY_EXTRACTION_UNSET,
    empty_summary: str | None = None,
    status: str | None = None,
    attempts: int | None = None,
    error: str | None = None,
) -> None:
    if ai_msg is None:
        return
    ai_msg.metadata_json = _merge_memory_extraction_metadata(
        ai_msg.metadata_json if isinstance(ai_msg.metadata_json, dict) else {},
        processed_facts=processed_facts,
        empty_summary=empty_summary,
        status=status,
        attempts=attempts,
        error=error,
    )


def _persist_memory_extraction_failure(
    assistant_message_id: str | None,
    *,
    attempts: int,
    error_message: str = MEMORY_EXTRACTION_FAILURE_SUMMARY,
) -> None:
    if not assistant_message_id:
        return

    db = SessionLocal()
    try:
        ai_msg = (
            db.query(Message)
            .filter(
                Message.id == assistant_message_id,
                Message.role == "assistant",
            )
            .first()
        )
        if ai_msg is None:
            return
        _set_memory_extraction_state(
            ai_msg,
            processed_facts=[],
            empty_summary=error_message,
            status=MEMORY_EXTRACTION_STATUS_FAILED,
            attempts=attempts,
            error=error_message,
        )
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
    finally:
        db.close()


def _persist_memory_extraction_metadata(
    ai_msg: Message | None,
    *,
    processed_facts: list[dict[str, object]] | None,
    empty_summary: str | None = None,
    attempts: int | None = None,
) -> None:
    if ai_msg is None:
        return

    _set_memory_extraction_state(
        ai_msg,
        processed_facts=list(processed_facts or []),
        empty_summary=empty_summary,
        status=MEMORY_EXTRACTION_STATUS_COMPLETED,
        attempts=attempts,
        error="",
    )


def _guess_heuristic_memory_category(item: str, clause: str, action: str) -> str:
    text = f"{clause} {item}".strip()
    if re.search(r"(旅行|出行|东京|机票|酒店)", text):
        return "旅行.计划"
    if re.search(r"(茶|咖啡|美式|拿铁|冷萃|饮料|饮品|果汁|奶茶|可乐|牛奶|乌龙|茉莉)", text):
        return "饮食.偏好"
    if re.search(r"(吃|饭|菜|火锅|面|米饭|寿司|拉面)", text):
        return "饮食.偏好"
    if action == "goal":
        return "计划"
    return "偏好"


def _normalize_explicit_fact_importance(
    importance: object,
    *,
    fact_text: str,
    memory_kind: str | None,
) -> float:
    try:
        normalized = float(importance)
    except (TypeError, ValueError):
        normalized = 0.0

    text = str(fact_text or "").strip()
    kind = str(memory_kind or "").strip().lower()
    if kind == MEMORY_KIND_PREFERENCE and _STABLE_PREFERENCE_FACT_PATTERN.search(text):
        return max(normalized, 0.9)
    if kind == MEMORY_KIND_GOAL and _STABLE_GOAL_FACT_PATTERN.search(text):
        return max(normalized, 0.9)
    return normalized


def _build_heuristic_fact_text(item: str, action: str, original_clause: str) -> str:
    normalized_item = item.strip(" ，,。！？!；;、")
    if not normalized_item:
        return ""
    if action == "drink_preference":
        return f"用户喜欢{normalized_item}。"
    if action == "preference":
        return f"用户喜欢{normalized_item}。"
    if action == "goal":
        clause = original_clause.strip()
        if clause and not re.search(r"[。！？!?]$", clause):
            clause = f"{clause}。"
        return clause
    return ""


def _extract_facts_heuristically(user_message: str) -> list[dict[str, object]]:
    text = str(user_message or "").strip()
    if not text:
        return []

    clauses = [segment.strip() for segment in re.split(r"[。！？!?；;，,]", text) if segment.strip()]
    results: list[dict[str, object]] = []
    seen: set[str] = set()

    speaker_prefix = r"(?:(?:我|本人)(?:也|很|还|都|最|特别|真的|平时|一直|常常|经常|通常|比较|更|挺|蛮|还挺)*|(?:也|很|还|平时|一直|常常|经常|通常|比较|更|挺|蛮|还挺)+)"
    preference_patterns = [
        (rf"^{speaker_prefix}喜欢喝(?P<item>.+)$", "drink_preference"),
        (rf"^{speaker_prefix}(?:爱喝|常喝)(?P<item>.+)$", "drink_preference"),
        (rf"^{speaker_prefix}喜欢(?P<item>.+)$", "preference"),
        (rf"^{speaker_prefix}(?:爱吃|常吃)(?P<item>.+)$", "preference"),
    ]
    goal_patterns = [
        r"^(?:(?:我|本人)|(?:今年|明年|最近|之后)).*(?:打算|计划|准备).+$",
    ]

    for clause in clauses:
        matched = False
        for pattern, action in preference_patterns:
            match = re.search(pattern, clause)
            if not match:
                continue
            item = match.group("item").strip()
            item = re.sub(r"^(?:也|很|还|都|最|特别|真的|平时|一直|常常|经常|通常|比较|更|挺|蛮|还挺)+", "", item).strip()
            item = re.sub(r"(?:呢|啊|呀|啦|哦|吧)$", "", item).strip()
            fact_text = _build_heuristic_fact_text(item, action, clause)
            if not fact_text:
                continue
            fact_key = _normalize_text_key(fact_text)
            if fact_key in seen:
                continue
            seen.add(fact_key)
            results.append(
                {
                    "fact": fact_text,
                    "category": _guess_heuristic_memory_category(item, clause, action),
                    "importance": 0.8,
                    "source": "heuristic",
                }
            )
            matched = True
            break
        if matched:
            continue

        for pattern in goal_patterns:
            match = re.search(pattern, clause)
            if not match:
                continue
            fact_text = _build_heuristic_fact_text(clause, "goal", clause)
            fact_key = _normalize_text_key(fact_text)
            if fact_key in seen:
                continue
            seen.add(fact_key)
            results.append(
                {
                    "fact": fact_text,
                    "category": _guess_heuristic_memory_category(clause, clause, "goal"),
                    "importance": 0.9,
                    "source": "heuristic",
                }
            )
            break

    return results


def execute_memory_extraction_job(
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    user_message: str,
    ai_response: str,
    assistant_message_id: str | None = None,
    *,
    max_attempts: int = MEMORY_EXTRACTION_MAX_ATTEMPTS,
) -> bool:
    for attempt_index in range(1, max_attempts + 1):
        succeeded = run_memory_extraction(
            workspace_id,
            project_id,
            conversation_id,
            user_message,
            ai_response,
            assistant_message_id,
            attempt_index=attempt_index,
        )
        if succeeded:
            return True
        if attempt_index < max_attempts:
            time.sleep(min(1.5 * attempt_index, 3.0))

    _persist_memory_extraction_failure(
        assistant_message_id,
        attempts=max_attempts,
        error_message=MEMORY_EXTRACTION_FAILURE_SUMMARY,
    )
    return False


def run_memory_extraction(
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    user_message: str,
    ai_response: str,
    assistant_message_id: str | None = None,
    *,
    attempt_index: int = 1,
) -> bool:
    """Extract factual memories from a conversation turn.
    Called asynchronously after each message exchange."""
    import asyncio
    import json
    import re

    from app.models.entities import Memory
    from app.services.dashscope_client import chat_completion
    from app.services.dashscope_http import close_current_client
    from app.services.embedding import embed_and_store, find_duplicate_memory_with_vector, find_related_memories

    EXTRACTION_PROMPT = """你是一个严格的 JSON 记忆提取器。只根据用户原话，提取用户本人明确表达的可记忆事实。

规则：
- 只提取用户明确说出的事实，不做推测
- 事实必须关于用户本人（身份、偏好、计划、经历、关系、限制条件）
- 不提取 assistant 复述出的汇总句，不根据 assistant 回复新增事实
- 如果一句话里包含多个并列偏好或事实，必须拆成多条叶子事实
- 禁止输出“用户偏好A和B”这类聚合句
- 每个事实用一句话表达
- importance: 0-1，其中 >=0.7 创建为临时记忆，>=0.9 直接升级为永久记忆
- category: 用中文，层级用点分隔（如"工作.计划"、"健康.用药"）

用户原话：
{user_message}

输出 JSON 数组：
[{{"fact": "...", "category": "...", "importance": 0.0}}]

如果没有值得记忆的事实，输出空数组 []。"""

    FALLBACK_EXTRACTION_PROMPT = """你是一个严格的 JSON 记忆提取器。只根据用户原话，提取用户本人明确表达的可记忆事实。

规则：
- 只提取用户明确说出的事实，不做推测
- 优先提取：身份、偏好、计划、经历、关系、限制条件
- 如果一句话里包含多个并列偏好或事实，要拆成多条
- importance: 0-1，明确且稳定的偏好/身份/计划通常 >=0.9
- category: 用中文，层级用点分隔
- 输出必须是 JSON 数组，不要输出解释文字或 markdown

用户原话：
{user_message}

输出示例：
[{{"fact":"用户喜欢喝冰美式。","category":"饮食.偏好","importance":0.95}}]

如果没有值得记忆的事实，输出 []。"""

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
            logger.info(
                "memory extraction skipped: project not found",
                extra={"workspace_id": workspace_id, "project_id": project_id},
            )
            return False
        conversation = (
            db.query(Conversation)
            .filter(
                Conversation.id == conversation_id,
                Conversation.project_id == project_id,
                Conversation.workspace_id == workspace_id,
            )
            .first()
        )
        if not conversation and assistant_message_id:
            assistant_message = (
                db.query(Message)
                .filter(
                    Message.id == assistant_message_id,
                    Message.role == "assistant",
                )
                .first()
            )
            if assistant_message:
                conversation = (
                    db.query(Conversation)
                    .filter(
                        Conversation.id == assistant_message.conversation_id,
                        Conversation.project_id == project_id,
                        Conversation.workspace_id == workspace_id,
                    )
                    .first()
                )
                if conversation:
                    conversation_id = conversation.id
        if not conversation:
            logger.info(
                "memory extraction skipped: conversation not found",
                extra={
                    "workspace_id": workspace_id,
                    "project_id": project_id,
                    "conversation_id": conversation_id,
                    "assistant_message_id": assistant_message_id,
                },
            )
            return False

        ai_msg = None
        try:
            if assistant_message_id:
                ai_msg = (
                    db.query(Message)
                    .filter(
                        Message.id == assistant_message_id,
                        Message.conversation_id == conversation_id,
                        Message.role == "assistant",
                    )
                    .first()
                )
            else:
                ai_msg = (
                    db.query(Message)
                    .filter(
                        Message.conversation_id == conversation_id,
                        Message.role == "assistant",
                    )
                    .order_by(Message.created_at.desc())
                    .first()
                )
            _set_memory_extraction_state(
                ai_msg,
                status=MEMORY_EXTRACTION_STATUS_PENDING,
                attempts=attempt_index,
                error="",
            )
            db.flush()
        except Exception:  # noqa: BLE001
            ai_msg = None

        prompt = EXTRACTION_PROMPT.format(user_message=user_message)

        # ── Async helper: extract, dedup, and embed in a single event loop ──
        async def _extract_and_store_facts() -> None:
            try:
                async def _extract_facts_once(prompt_text: str) -> list[dict[str, object]]:
                    raw_response = await chat_completion(
                        [{"role": "user", "content": prompt_text}],
                        temperature=0.1,
                        max_tokens=1024,
                    )

                    json_str = raw_response.strip()
                    json_match = re.search(r"\[.*\]", json_str, re.DOTALL)
                    if not json_match:
                        return []

                    try:
                        parsed = json.loads(json_match.group(0))
                    except json.JSONDecodeError:
                        return []
                    if not isinstance(parsed, list):
                        return []
                    return [item for item in parsed if isinstance(item, dict)]

                facts = await _extract_facts_once(prompt)
                if not facts:
                    fallback_prompt = FALLBACK_EXTRACTION_PROMPT.format(
                        user_message=user_message,
                    )
                    facts = await _extract_facts_once(fallback_prompt)

                if not facts:
                    facts = _extract_facts_heuristically(user_message)
                if not facts:
                    _persist_memory_extraction_metadata(
                        ai_msg,
                        processed_facts=[],
                        empty_summary="本轮未提取到可保存记忆",
                        attempts=attempt_index,
                    )
                    db.flush()
                    return

                processed_facts: list[dict[str, object]] = []

                for fact in facts:
                    fact_text = _normalize_extracted_fact_text(fact.get("fact", ""))
                    category = str(fact.get("category", "")).strip()
                    if not fact_text:
                        continue

                    preview_metadata = normalize_memory_metadata(
                        content=fact_text,
                        category=category,
                        memory_type="temporary",
                        metadata={"source": "auto_extraction"},
                    )
                    memory_kind = str(preview_metadata.get("memory_kind") or "").strip().lower()
                    importance = _normalize_explicit_fact_importance(
                        fact.get("importance", 0),
                        fact_text=fact_text,
                        memory_kind=memory_kind,
                    )

                    fact_display: dict[str, object] = {
                        "fact": fact_text,
                        "category": category,
                        "importance": importance,
                    }

                    if importance < 0.7:
                        fact_display["status"] = "ignored"
                        processed_facts.append(fact_display)
                        continue

                    memory_type = "permanent" if importance >= 0.9 and conversation.created_by else "temporary"

                    if _looks_like_aggregate_fact(
                        fact_text,
                        fact_category=category,
                        fact_memory_kind=memory_kind,
                    ):
                        fact_display["status"] = "discarded"
                        fact_display["triage_action"] = "discard"
                        fact_display["triage_reason"] = "聚合型事实应拆分为多个叶子记忆，已跳过该汇总句。"
                        processed_facts.append(fact_display)
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
                            fact_display["status"] = "duplicate"
                            fact_display["target_memory_id"] = duplicate["memory_id"]
                            processed_facts.append(fact_display)
                            continue
                    except Exception:  # noqa: BLE001
                        query_vector = None  # Dedup check failure is non-fatal

                    # ── Memory Triage: check for related (but not duplicate) memories ──
                    parent_memory_id = None
                    parent_memory: Memory | None = None
                    anchor_strength = 0.0
                    append_candidate_memory: Memory | None = None
                    triage_action = "create"
                    triage_reason = None
                    triage_target_memory_id = None
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
                            triage_reason = decision.get("reason")

                            # Validate target_id comes from candidate list
                            if target_id and target_id not in candidate_ids:
                                action = "create"
                                target_id = None

                            triage_action = action
                            triage_target_memory_id = target_id

                            if action == "discard":
                                fact_display["status"] = "discarded"
                                fact_display["triage_action"] = "discard"
                                if isinstance(triage_reason, str) and triage_reason.strip():
                                    fact_display["triage_reason"] = triage_reason.strip()
                                processed_facts.append(fact_display)
                                continue

                            if action == "append" and target_id:
                                target = db.query(Memory).filter(
                                    Memory.id == target_id,
                                    Memory.project_id == project_id,
                                ).first()
                                if target:
                                    append_validation = await _validate_append_parent(
                                        fact_text=fact_text,
                                        fact_category=category,
                                        fact_memory_kind=memory_kind,
                                        candidate_memory=target,
                                    )
                                    validation_relation = append_validation.get("relation", "unrelated")
                                    validation_reason = append_validation.get("reason")
                                    if validation_relation == "parent":
                                        parent_memory_id = target_id
                                        parent_memory = target
                                        if validation_reason:
                                            triage_reason = validation_reason
                                    elif validation_relation == "duplicate":
                                        fact_display["status"] = "duplicate"
                                        fact_display["triage_action"] = "discard"
                                        fact_display["target_memory_id"] = target_id
                                        if validation_reason:
                                            fact_display["triage_reason"] = validation_reason
                                        processed_facts.append(fact_display)
                                        continue
                                    else:
                                        append_candidate_memory = target if validation_relation == "sibling" else None
                                        triage_action = "create"
                                        triage_target_memory_id = None
                                        triage_reason = validation_reason
                                else:
                                    triage_action = "create"
                                    triage_target_memory_id = None
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
                                    fact_display["status"] = "merged" if action == "merge" else "replaced"
                                    fact_display["triage_action"] = action
                                    fact_display["target_memory_id"] = target_id
                                    if isinstance(triage_reason, str) and triage_reason.strip():
                                        fact_display["triage_reason"] = triage_reason.strip()
                                    processed_facts.append(fact_display)
                                    continue  # Don't create a new memory
                                triage_action = "create"
                                triage_target_memory_id = None

                    metadata = {"importance": importance, "source": "auto_extraction"}
                    if memory_type == "permanent":
                        metadata = build_private_memory_metadata(metadata, owner_user_id=conversation.created_by)
                    metadata = normalize_memory_metadata(
                        content=fact_text,
                        category=fact.get("category", ""),
                        memory_type=memory_type,
                        metadata=metadata,
                    )
                    memory_kind = str(metadata.get("memory_kind") or "").strip().lower()

                    concept_parent_created = False
                    if parent_memory_id is None and memory_type == "permanent":
                        concept_parent, concept_created, concept_reason = await _resolve_concept_parent(
                            db,
                            workspace_id=workspace_id,
                            project_id=project_id,
                            conversation_id=conversation_id,
                            owner_user_id=conversation.created_by,
                            fact_text=fact_text,
                            fact_category=category,
                            fact_memory_kind=memory_kind,
                        )
                        if concept_parent:
                            concept_parent_created = concept_created
                            parent_memory_id = concept_parent.id
                            parent_memory = concept_parent
                            anchor_strength = 0.84 if concept_created else 0.8
                            if append_candidate_memory and append_candidate_memory.id != concept_parent.id:
                                if append_candidate_memory.parent_memory_id != concept_parent.id:
                                    append_candidate_memory.parent_memory_id = concept_parent.id
                                try:
                                    _upsert_auto_memory_edge(
                                        db,
                                        source_memory_id=concept_parent.id,
                                        target_memory_id=append_candidate_memory.id,
                                        strength=0.76,
                                    )
                                except Exception:  # noqa: BLE001
                                    pass
                            concept_label = concept_parent.content.strip()
                            relation_reason = (
                                f"新增主题节点「{concept_label}」并归入其下"
                                if concept_created
                                else f"归入主题「{concept_label}」"
                            )
                            if concept_reason:
                                relation_reason = f"{relation_reason}；{concept_reason}"
                            if triage_reason:
                                triage_reason = f"{triage_reason}；{relation_reason}"
                            else:
                                triage_reason = relation_reason
                        else:
                            anchor_strength = 0.0

                    if parent_memory_id is None:
                        project = db.get(Project, project_id)
                        if project:
                            root_memory, _ = ensure_project_assistant_root(
                                db,
                                project,
                                reparent_orphans=False,
                            )
                            parent_memory_id = root_memory.id
                            parent_memory = root_memory

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

                    if parent_memory and not is_assistant_root_memory(parent_memory):
                        try:
                            edge_strength = 0.72 if triage_action == "append" else anchor_strength or 0.65
                            _upsert_auto_memory_edge(
                                db,
                                source_memory_id=parent_memory.id,
                                target_memory_id=memory.id,
                                strength=edge_strength,
                            )
                        except Exception:  # noqa: BLE001
                            pass

                    fact_display["status"] = "appended" if parent_memory_id and triage_action == "append" else memory_type
                    fact_display["triage_action"] = triage_action
                    fact_display["target_memory_id"] = triage_target_memory_id or memory.id
                    if parent_memory and not is_assistant_root_memory(parent_memory):
                        fact_display["parent_memory_id"] = parent_memory.id
                        fact_display["parent_memory_content"] = parent_memory.content
                        if concept_parent_created:
                            fact_display["parent_memory_action"] = "created"
                    if isinstance(triage_reason, str) and triage_reason.strip():
                        fact_display["triage_reason"] = triage_reason.strip()
                    processed_facts.append(fact_display)

                if ai_msg:
                    try:
                        _persist_memory_extraction_metadata(
                            ai_msg,
                            processed_facts=processed_facts,
                            empty_summary="本轮未提取到可保存记忆",
                            attempts=attempt_index,
                        )
                        db.flush()
                    except Exception:  # noqa: BLE001
                        pass  # Non-fatal: display data only
            finally:
                await close_current_client()

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
            try:
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
            except Exception:  # noqa: BLE001
                continue

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
                try:
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
                except Exception:  # noqa: BLE001
                    continue

        ensure_project_category_tree(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
        )
        ensure_project_related_edges(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
        )
        graph_changed = session_has_pending_graph_mutations(db)
        db.commit()
        if graph_changed:
            bump_project_memory_graph_revision(workspace_id=workspace_id, project_id=project_id)
        try:
            if settings.env == "test":
                compact_project_memories_task(workspace_id, project_id)
                repair_project_memory_graph_task(workspace_id, project_id)
            else:
                compact_project_memories_task.delay(workspace_id, project_id)
                repair_project_memory_graph_task.delay(workspace_id, project_id)
        except Exception:  # noqa: BLE001
            pass
        return True
    except Exception:  # noqa: BLE001
        logger.exception(
            "memory extraction failed",
            extra={
                "workspace_id": workspace_id,
                "project_id": project_id,
                "conversation_id": conversation_id,
                "assistant_message_id": assistant_message_id,
            },
        )
        db.rollback()
        return False
    finally:
        db.close()


@celery_app.task(name="app.tasks.worker_tasks.extract_memories")
def extract_memories(
    workspace_id: str,
    project_id: str,
    conversation_id: str,
    user_message: str,
    ai_response: str,
    assistant_message_id: str | None = None,
) -> None:
    execute_memory_extraction_job(
        workspace_id,
        project_id,
        conversation_id,
        user_message,
        ai_response,
        assistant_message_id,
    )


@celery_app.task(name="app.tasks.worker_tasks.repair_project_memory_graph")
def repair_project_memory_graph_task(
    workspace_id: str,
    project_id: str,
) -> None:
    from app.services.memory_graph_repair import repair_project_memory_graph

    db = SessionLocal()
    try:
        repair_summary = repair_project_memory_graph(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
        )
        related_summary = ensure_project_related_edges(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
        )
        graph_changed = any(repair_summary.as_dict().values()) or any(related_summary.as_dict().values())
        db.commit()
        if graph_changed:
            bump_project_memory_graph_revision(workspace_id=workspace_id, project_id=project_id)
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
        compaction_summary = asyncio.run(
            compact_project_memories(
                db,
                workspace_id=workspace_id,
                project_id=project_id,
            )
        )
        related_summary = ensure_project_related_edges(
            db,
            workspace_id=workspace_id,
            project_id=project_id,
        )
        graph_changed = any(
            (
                compaction_summary.created_summaries,
                compaction_summary.updated_summaries,
                compaction_summary.deleted_summaries,
            )
        ) or any(related_summary.as_dict().values())
        db.commit()
        if graph_changed:
            bump_project_memory_graph_revision(workspace_id=workspace_id, project_id=project_id)
    except Exception:  # noqa: BLE001
        db.rollback()
    finally:
        db.close()

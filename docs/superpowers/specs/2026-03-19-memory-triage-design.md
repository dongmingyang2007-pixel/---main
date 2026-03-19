# Memory Triage — 记忆审核设计

## 概述

在记忆提取流程中增加轻量 LLM 审核步骤。当新提取的事实与已有记忆存在相关性（向量相似度 0.70~0.89）但不构成重复（< 0.90）时，调用 qwen-turbo 判断新事实与已有记忆的语义关系，决定归档方式。

## 问题

当前 `extract_memories` 只有两种处理路径：
- 相似度 ≥ 0.90 → 视为重复，丢弃
- 相似度 < 0.90 → 直接新建独立记忆

中间地带（0.70~0.89，相关但不重复）没有处理，导致记忆无限平铺，缺少层级组织。数据模型已支持 `parent_memory_id`（树结构）和 `MemoryEdge`（图结构），但自动提取流程从未使用。

## 改动范围

仅涉及后端 3 个文件，前端无改动：

| 文件 | 改动 |
|------|------|
| `apps/api/app/core/config.py` | 新增 3 个配置项 |
| `apps/api/app/services/embedding.py` | 新增 `find_related_memories()` 函数 |
| `apps/api/app/tasks/worker_tasks.py` | 新增 `triage_memory()` 函数，修改 `extract_memories` 流程 |

## 流程设计

### 改造后的 extract_memories 流程

```
提取事实 (importance ≥ 0.7)
    ↓
find_duplicate_memory(threshold=0.90)
    ├─ 找到 (≥0.90) → 丢弃（不变）
    └─ 没找到 → find_related_memories(low=0.70, high=0.90, limit=3)
                  ├─ 没有候选 → 直接新建（不变）
                  └─ 有候选 → triage_memory(fact, candidates)
                               ├─ "create"  → 独立新建
                               ├─ "append"  → 新建 + 设 parent_memory_id
                               ├─ "merge"   → 更新目标记忆 content，重新 embed
                               ├─ "replace" → 替换目标记忆 content，重新 embed
                               └─ "discard" → 丢弃
```

### embedding 向量复用

`find_duplicate_memory()` 内部会调用 `create_embedding()` 生成新事实的向量。为避免重复生成同一向量，新增一个包装函数 `find_duplicate_memory_with_vector()`，不修改原函数签名，保持向后兼容。

新增函数：
```python
async def find_duplicate_memory_with_vector(
    db, *, workspace_id, project_id, text, threshold=0.90,
) -> tuple[dict | None, list[float]]:
    """Like find_duplicate_memory but also returns the query vector for reuse.
    Returns (duplicate_match_or_None, query_vector)."""
```

原 `find_duplicate_memory()` 签名不变（`-> dict | None`），内部重构为调用 `find_duplicate_memory_with_vector()` 后丢弃向量，保持所有现有调用者兼容。

`find_related_memories()` 接收预计算向量作为参数：
```python
async def find_related_memories(
    db, *, workspace_id, project_id, query_vector: list[float],
    low: float = 0.70, high: float = 0.90, limit: int = 3,
) -> list[dict]:
```

`embed_and_store()` 增加可选 `vector` 参数，复用已有向量避免重复 embedding 调用：
```python
async def embed_and_store(..., vector: list[float] | None = None) -> str:
    """If vector is provided, skip embedding call and use it directly."""
```

### 新增组件

#### 1. 配置项 (config.py)

```python
# ── Memory Triage ──
memory_triage_model: str = "qwen-turbo"
memory_triage_similarity_low: float = 0.70
memory_triage_similarity_high: float = 0.90
```

添加位置：在 `dashscope_embedding_model` 之后、Realtime Voice 配置之前。

#### 2. find_related_memories() (embedding.py)

查找相似度在 `[low, high)` 区间的已有记忆，返回 top N 候选。

```python
async def find_related_memories(
    db: Session,
    *,
    workspace_id: str,
    project_id: str,
    query_vector: list[float],
    low: float = 0.70,
    high: float = 0.90,
    limit: int = 3,
) -> list[dict]:
    """Find memories with similarity in [low, high) range.
    Returns list of {memory_id, content, category, score}."""
```

完整 SQL 查询：

```sql
SELECT e.memory_id, m.content, m.category,
       1 - (e.vector <=> :query_vector::vector) AS score
FROM embeddings e
JOIN memories m ON m.id = e.memory_id
WHERE e.workspace_id = :workspace_id
  AND e.project_id = :project_id
  AND e.memory_id IS NOT NULL
  AND e.vector IS NOT NULL
  AND 1 - (e.vector <=> :query_vector::vector) >= :low
  AND 1 - (e.vector <=> :query_vector::vector) < :high
ORDER BY e.vector <=> :query_vector::vector
LIMIT :limit
```

#### 3. triage_memory() (worker_tasks.py)

轻量 LLM 审核函数，判断新事实与候选记忆的关系。

```python
async def triage_memory(
    fact: str,
    candidates: list[dict],
) -> dict:
    """Call lightweight LLM to decide how to file a new fact.
    Returns {"action": "create|append|merge|replace|discard",
             "target_memory_id": "..." or null,
             "merged_content": "..." or null,
             "reason": "..."}
    """
```

审核 Prompt：

```
你是记忆管理器。判断一条新事实与已有记忆的关系。

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
{"action": "...", "target_memory_id": "...", "merged_content": "合并/替换后的完整内容", "reason": "一句话解释"}

规则：
- target_memory_id：create 和 discard 时为 null，其他操作必须指定
- merged_content：仅 merge 和 replace 时需要，其他为 null
- merge 时写出合并后的完整内容，不要丢失原有信息
- replace 时写出替换后的内容，旧信息不再保留
```

调用参数：
- model: `settings.memory_triage_model`（默认 qwen-turbo）
- temperature: 0.1
- max_tokens: 256

JSON 解析逻辑：与现有提取 prompt 一致，使用 `re.search(r'\{.*\}', response, re.DOTALL)` 提取 JSON 对象，处理 LLM 可能包裹的 markdown 代码块或前缀文字。

#### 4. extract_memories 改造 (worker_tasks.py)

在现有 `_extract_and_store_facts()` 内部，替换去重检查后的新建逻辑：

**现有逻辑（第 612~653 行）：**
```python
duplicate = await find_duplicate_memory(db, ..., threshold=0.90)
if duplicate:
    continue
# ... 直接新建 Memory
```

**改造后逻辑：**
```python
duplicate, query_vector = await find_duplicate_memory_with_vector(
    db, ..., threshold=settings.memory_triage_similarity_high,
)
if duplicate:
    continue

# 收集候选 ID 用于后续验证
candidate_ids = set()

# 查找相关但不重复的候选
candidates = await find_related_memories(
    db, ..., query_vector=query_vector,
    low=settings.memory_triage_similarity_low,
    high=settings.memory_triage_similarity_high,
)

if candidates:
    candidate_ids = {c["memory_id"] for c in candidates}

    # 调用轻量 LLM 审核
    try:
        decision = await triage_memory(fact_text, candidates)
    except Exception:
        decision = {"action": "create"}  # fallback

    action = decision.get("action", "create")
    target_id = decision.get("target_memory_id")
    merged = decision.get("merged_content")

    # 验证 target_id 来自候选列表（防止 LLM 幻觉）
    if target_id and target_id not in candidate_ids:
        action = "create"  # fallback

    if action == "discard":
        continue
    elif action == "append" and target_id:
        # 验证目标存在且同 project
        target = db.query(Memory).filter(
            Memory.id == target_id,
            Memory.project_id == project_id,
        ).first()
        if not target:
            action = "create"  # fallback，走下面的正常新建
        else:
            memory = Memory(..., parent_memory_id=target_id)
            # embed_and_store(vector=query_vector)
    elif action in ("merge", "replace") and target_id and merged:
        # 更新目标记忆（用 raw SQL 避免中间 commit）
        target = db.query(Memory).filter(
            Memory.id == target_id,
            Memory.project_id == project_id,
        ).first()
        if target:
            target.content = merged
            # 删旧 embedding（raw SQL DELETE，不 commit）
            db.execute(sql_text(
                "DELETE FROM embeddings WHERE memory_id = :mid"
            ), {"mid": target_id})
            # 重新 embed（注意：不传 vector 参数，因为内容已变，需要新向量）
            await embed_and_store(db, ..., memory_id=target_id, chunk_text=merged)
        continue  # 不新建
    # else: action == "create" 或 fallback → 正常新建

# 正常新建逻辑（不变，但 embed_and_store 复用 query_vector）
```

**事务管理注意事项：**

`embed_and_store()` 和 `delete_embeddings_for_memory()` 目前内部都会调用 `db.commit()`，这会破坏外层事务边界。改造方案：

1. `embed_and_store()` 增加 `auto_commit: bool = True` 参数，triage 流程中传 `auto_commit=False`
2. merge/replace 路径中直接用 raw SQL `DELETE` 替代 `delete_embeddings_for_memory()`，避免中间 commit
3. 所有 DB 变更统一由 `extract_memories` 末尾的 `db.commit()` 提交
4. 如果中途失败，`db.rollback()` 可以回滚全部变更，不会出现"记忆更新了但没有 embedding"的中间态

### 各 action 处理细节

| Action | Memory 操作 | Embedding 操作 | parent_memory_id |
|--------|-----------|---------------|-----------------|
| `create` | 新建 | `embed_and_store(vector=query_vector)` | null |
| `append` | 新建 | `embed_and_store(vector=query_vector)` | 目标记忆 ID |
| `merge` | 更新目标 content | 删旧 embedding + 重新 embed（不传 vector，内容已变需新向量） | 不改 |
| `replace` | 更新目标 content | 删旧 embedding + 重新 embed（不传 vector，内容已变需新向量） | 不改 |
| `discard` | 无 | 无 | 无 |

### 记忆类型规则（不变）

审核步骤不改变 type 判定逻辑：
- importance ≥ 0.9 + conversation.created_by 存在 → `permanent`
- 否则 → `temporary`

对于 `append` 创建的子记忆，同样遵循此规则。子记忆可以是 temporary，后续通过自动晋升机制升级。

对于 `merge`/`replace`，目标记忆的 type 不变。

## 错误处理

- `find_related_memories()` 失败 → 跳过审核，走 create 路径
- `triage_memory()` LLM 调用失败 → fallback 到 `create`
- `triage_memory()` 返回无法解析的 JSON → fallback 到 `create`
- `target_memory_id` 不在候选列表中（LLM 幻觉） → fallback 到 `create`
- `target_memory_id` 在数据库中不存在或不属于当前 project → fallback 到 `create`
- merge/replace 中 embed 失败 → `db.rollback()` 回滚所有变更，记忆和 embedding 状态一致
- 所有 fallback 保证记忆提取流程不中断

## 并发安全

`extract_memories` 是 Celery 任务，同一 project 的两轮对话可能并发执行。两个任务可能同时找到同一候选并决定 merge，第二个会覆盖第一个的合并结果。

当前阶段接受这个风险，原因：
1. 并发 merge 同一记忆的概率很低（需要两条相似事实在几秒内同时提取）
2. 即使发生，结果也不是数据损坏，只是丢失一次合并——事实会在下次对话中重新提取
3. 如果未来需要严格保证，可加 `SELECT ... FOR UPDATE` 或 Celery 任务锁

## MemoryEdge 说明

本次改动只使用 `parent_memory_id`（树结构）进行 `append` 归档。`MemoryEdge`（图结构）的自动填充留待未来迭代，可能用于标记 "related_to"、"supersedes" 等语义关系。

## 成本与性能

- **Embedding 调用**：通过向量复用优化，每条事实最多 1 次 embedding 调用（和现在一样），merge/replace 额外 1 次（对合并后内容重新 embed）
- **LLM 审核调用**：仅在找到 0.70~0.89 候选时触发，大部分对话轮次不会触发
- **qwen-turbo 成本**：输入约 200 token + 输出约 50 token，单次约 ¥0.0003
- **延迟**：qwen-turbo 响应 < 500ms，在异步 Celery 任务中执行，不影响用户体验

## 测试策略

- `find_related_memories()` 单元测试：mock embedding 数据，验证区间查询
- `triage_memory()` 单元测试：mock `chat_completion`，验证各 action 的 JSON 解析
- `extract_memories` 集成测试：验证完整流程——create/append/merge/replace/discard 各路径
- 错误 fallback 测试：LLM 返回垃圾数据时回退到 create

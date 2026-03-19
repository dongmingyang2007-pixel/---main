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

`find_duplicate_memory()` 内部会调用 `create_embedding()` 生成新事实的向量。为避免 `find_related_memories()` 重复生成同一向量，改造 `find_duplicate_memory()` 使其返回已生成的向量，供后续步骤复用。

改造后签名：
```python
async def find_duplicate_memory(...) -> tuple[dict | None, list[float]]:
    """Returns (duplicate_match_or_None, query_vector)."""
```

`find_related_memories()` 接收该向量作为参数：
```python
async def find_related_memories(
    db, *, workspace_id, project_id, query_vector: list[float],
    low: float = 0.70, high: float = 0.90, limit: int = 3,
) -> list[dict]:
```

同样，`embed_and_store()` 也可复用该向量（如果最终决定新建记忆），避免第三次 embedding 调用。改造后签名增加可选参数：
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

SQL 查询：在 `find_duplicate_memory()` 基础上修改 WHERE 条件为 `score >= :low AND score < :high`，LIMIT 改为参数化，SELECT 增加 `m.category`。

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
duplicate, query_vector = await find_duplicate_memory(db, ..., threshold=settings.memory_triage_similarity_high)
if duplicate:
    continue

# 查找相关但不重复的候选
candidates = await find_related_memories(
    db, ..., query_vector=query_vector,
    low=settings.memory_triage_similarity_low,
    high=settings.memory_triage_similarity_high,
)

if candidates:
    # 调用轻量 LLM 审核
    try:
        decision = await triage_memory(fact_text, candidates)
    except Exception:
        decision = {"action": "create"}  # fallback

    action = decision.get("action", "create")
    target_id = decision.get("target_memory_id")
    merged = decision.get("merged_content")

    if action == "discard":
        continue
    elif action == "append" and target_id:
        # 新建 + 设 parent
        memory = Memory(..., parent_memory_id=target_id)
        # embed_and_store(vector=query_vector)
    elif action in ("merge", "replace") and target_id and merged:
        # 更新目标记忆
        target = db.query(Memory).get(target_id)
        if target:
            target.content = merged
            delete_embeddings_for_memory(db, target_id)
            await embed_and_store(db, ..., memory_id=target_id, chunk_text=merged)
        continue  # 不新建
    # else: action == "create" 或 fallback → 正常新建

# 正常新建逻辑（不变，但 embed_and_store 复用 query_vector）
```

### 各 action 处理细节

| Action | Memory 操作 | Embedding 操作 | parent_memory_id |
|--------|-----------|---------------|-----------------|
| `create` | 新建 | `embed_and_store(vector=query_vector)` | null |
| `append` | 新建 | `embed_and_store(vector=query_vector)` | 目标记忆 ID |
| `merge` | 更新目标 content | 删旧 embedding + 重新 embed | 不改 |
| `replace` | 更新目标 content | 删旧 embedding + 重新 embed | 不改 |
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
- `target_memory_id` 在数据库中不存在 → fallback 到 `create`
- 所有 fallback 保证记忆提取流程不中断

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

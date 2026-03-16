# AI 记忆系统 — 设计规格

**日期**: 2026-03-16
**状态**: 已批准
**范围**: 记忆图谱可视化 + 后端记忆/RAG 引擎 + 对话系统（一个完整功能）

---

## 1. 背景与动机

铭润的 AI 助手平台需要让每个用户的 AI 拥有独特的知识和记忆。当前系统使用 mock 推理，无真实的知识存储或记忆能力。本设计引入一套完整的记忆系统，包含：

- **可视化知识图谱**：控制台的默认主界面，用户可以看到和编辑 AI 的"大脑"
- **RAG 检索引擎**：将用户上传的文档向量化，推理时语义检索相关内容
- **记忆存储**：AI 自动从对话中提取事实，形成长期记忆
- **推理编排**：组装人格 + 记忆 + 知识 + 对话历史，调用第三方模型 API

### 竞品差异化

目前无任何产品提供可视化、可交互的 AI 记忆图谱。ChatGPT Memory 是扁平文字列表，Coze 是变量存储，Character.AI 无可视化。铭润的记忆图谱是真正的产品差异化。

---

## 2. 核心概念

### 2.1 节点类型

| 节点类型 | 视觉样式 | 来源 | 生命周期 |
|---------|---------|------|---------|
| 中心节点 | 大圆 (72px) + 渐变色 (accent) | 创建 AI 时确定 | 永久（模型+人格信息） |
| 永久记忆 (红) | 实线圆 (56px) + 陶土棕 `#c8734a` | AI 从对话提取 / 用户手动添加 / 蓝转红 | 永久，直到用户删除 |
| 临时记忆 (蓝) | 虚线圆 (56px) + 蓝色 `#4a8ac8` | AI 从当前对话提取 | 跟随对话存在，对话删除时消失 |
| 文件节点 | 方形 (44x52px) + 文件图标 + 灰棕色 `#8a7a6a` | 用户上传 | 永久，附属于记忆节点 |

### 2.2 连线类型

| 连线类型 | 样式 | 来源 |
|---------|------|------|
| 永久关联 | 红/棕色实线 | AI 自动建立 / 用户手动连接 |
| 临时关联 | 蓝色虚线 | 当前对话中 AI 建立 |
| 文件附属 | 灰色细线 | 文件与记忆的绑定 |

### 2.3 记忆分类

AI 根据内容自动创建分类层级（如"心理学 → 临床 / 治疗"）。分类表现为图谱中的空间聚类——同类记忆在视觉上聚集在一起。用户可以通过拖拽重新组织。

### 2.4 对话与蓝色记忆

- 每个 AI 助手可以有多个对话（类似 ChatGPT 的对话列表）
- 对话持续存在，除非用户主动删除
- 每个对话有自己的蓝色临时记忆
- 切换对话时，图谱上的蓝色节点切换显示（红色永久记忆始终显示）
- 蓝色记忆转红后脱离对话绑定，成为全局永久记忆

---

## 3. 用户交互

### 3.1 完整操作列表

| 操作 | 触发方式 | 效果 | 后端调用 |
|------|---------|------|---------|
| 查看详情 | 点击节点 | 右侧面板显示：记忆文本、来源对话、关联文件、创建时间 | `GET /api/v1/memory/{id}` |
| 删除节点 | 右键菜单 / 详情面板 | 记忆从图谱和数据库中移除，向量索引同步删除 | `DELETE /api/v1/memory/{id}` |
| 编辑内容 | 详情面板中编辑文本 | 修改记忆内容，触发重新向量化 | `PATCH /api/v1/memory/{id}` |
| 手动添加 | 图谱空白处双击 / 工具栏按钮 | 创建新的红色永久记忆节点 | `POST /api/v1/memory` |
| 蓝→红升级 | 右键"设为永久" / 拖拽到红色区域 | 临时记忆变为永久记忆 | `POST /api/v1/memory/{id}/promote` |
| 删除永久记忆 | 右键 / 详情面板 | 红色节点移除 | `DELETE /api/v1/memory/{id}` |
| 拖拽重组 | 拖动节点 | 改变节点的分类归属和视觉位置 | `PATCH /api/v1/memory/{id}` (更新 category/position) |
| 手动连线 | Shift + 拖拽从一个节点到另一个 | 建立关联线 | `POST /api/v1/memory/edges` |
| 断开连线 | 右键连线 / 详情面板 | 移除关联 | `DELETE /api/v1/memory/edges/{id}` |
| 搜索 | 顶部搜索框输入关键词 | 匹配节点高亮放大，其他淡化，视图飞向目标 | `POST /api/v1/memory/search` |
| 筛选 | 左侧筛选面板 | 按类目/时间/来源/节点类型过滤显示 | 前端过滤（数据已加载） |

### 3.2 图谱与配置的关系

- AI 助手详情页 (`/app/assistants/[id]`) 默认显示图谱视图
- 顶部 Tab 切换：**🕸 记忆图谱** | **⚙️ 配置**
- 配置 Tab 显示原有的画布工作台（模型、知识、人格、技能四区块）
- 图谱中心节点点击时，弹出配置的快捷入口（侧面板）

---

## 4. 后端架构

### 4.1 系统总览

```
前端 (Next.js)
  ├── 图谱可视化 (D3.js force-directed graph)
  ├── 对话界面 (Chat UI)
  └── 配置面板 (原画布工作台)
       │
       ▼
FastAPI 后端
  ├── /api/v1/memory — 记忆 CRUD + 搜索 + 连线
  ├── /api/v1/chat   — 对话管理 + 消息发送 + 推理
  └── /api/v1/* — 现有 API (projects, datasets, uploads, train...)
       │
       ▼
推理编排层 (Orchestrator)
  ① 检索 RAG 知识 (向量相似度搜索)
  ② 加载相关记忆 (永久 + 当前对话临时)
  ③ 组装 Prompt (人格 + 记忆 + 知识 + 对话历史 + 用户消息)
  ④ 调用第三方模型 API
  ⑤ 返回回复
  ⑥ 异步：提取新记忆 (Celery)
       │
       ▼
存储层
  ├── PostgreSQL + pgvector — memories, embeddings, conversations, messages
  ├── Redis — 缓存 + Celery broker
  ├── S3 (MinIO) — 文件存储 (复用现有)
  └── 第三方 API — Qwen (DashScope) / DeepSeek API
```

### 4.2 新增数据库表

#### `memories` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID, PK | 主键 |
| workspace_id | UUID, FK → workspaces | 租户隔离 |
| project_id | UUID, FK → projects | 所属 AI 助手 |
| content | TEXT | 记忆文本内容 |
| category | VARCHAR(255) | AI 自动分类（如 "医学.心理学.临床"） |
| type | VARCHAR(20) | `permanent` / `temporary` |
| source_conversation_id | UUID, FK → conversations, NULLABLE | 来源对话（临时记忆必有，永久记忆可选） |
| parent_memory_id | UUID, FK → memories, NULLABLE | 父节点（层级结构） |
| position_x | FLOAT, NULLABLE | 图谱中的 x 坐标（仅在用户拖拽结束 drag-end 时保存，不在力仿真 tick 时保存） |
| position_y | FLOAT, NULLABLE | 图谱中的 y 坐标（同上） |
| metadata_json | JSON (ORM) / jsonb (migration) | 扩展信息（提取置信度、来源消息 ID 等）。ORM 层使用 `mapped_column(JSON)` 匹配现有代码模式，Alembic migration 使用 `sa.Column(sa.dialects.postgresql.JSONB)`。 |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

索引：`(workspace_id, project_id)`, `(project_id, type)`, `(source_conversation_id)`

#### `memory_edges` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID, PK | 主键 |
| source_memory_id | UUID, FK → memories ON DELETE CASCADE | 源节点 |
| target_memory_id | UUID, FK → memories ON DELETE CASCADE | 目标节点 |
| edge_type | VARCHAR(20) | `auto` (AI 创建) / `manual` (用户创建) |
| strength | FLOAT | 关联强度 (0-1)，影响图谱中的连线粗细 |
| created_at | TIMESTAMPTZ | 创建时间 |

唯一约束：`(source_memory_id, target_memory_id)`

#### `embeddings` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID, PK | 主键 |
| workspace_id | UUID, FK → workspaces | 租户隔离（检索时过滤） |
| project_id | UUID, FK → projects | 所属 AI 助手（RAG 按助手隔离检索） |
| memory_id | UUID, FK → memories ON DELETE CASCADE, NULLABLE | 关联的记忆节点 |
| data_item_id | UUID, FK → data_items, NULLABLE | 关联的文件数据项（RAG 文档） |
| chunk_text | TEXT | 原文片段 |
| vector | vector(1024) | pgvector 向量（维度取决于 embedding 模型） |
| created_at | TIMESTAMPTZ | 创建时间 |

约束：`CHECK (memory_id IS NOT NULL OR data_item_id IS NOT NULL)` — 每条向量必须关联到记忆或文件

索引：`USING hnsw (vector vector_cosine_ops)` 用于向量检索（HNSW 不依赖数据量调参，优于 IVFFlat），`(workspace_id, project_id)` 用于租户+助手过滤

#### `conversations` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID, PK | 主键 |
| workspace_id | UUID, FK → workspaces | 租户隔离 |
| project_id | UUID, FK → projects | 所属 AI 助手 |
| title | VARCHAR(255) | 对话标题（AI 自动生成或用户设定） |
| created_by | UUID, FK → users | 创建对话的用户（多成员 workspace 中区分对话归属） |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 最后消息时间 |

#### `messages` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID, PK | 主键 |
| conversation_id | UUID, FK → conversations ON DELETE CASCADE | 所属对话 |
| role | VARCHAR(20) | `user` / `assistant` / `system` |
| content | TEXT | 消息内容 |
| created_at | TIMESTAMPTZ | 发送时间 |

索引：`(conversation_id, created_at)`

#### `memory_files` 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID, PK | 主键 |
| memory_id | UUID, FK → memories ON DELETE CASCADE | 关联的记忆节点 |
| data_item_id | UUID, FK → data_items | 关联的文件（复用现有 data_items 表） |
| created_at | TIMESTAMPTZ | 创建时间 |

### 4.3 新增 API 端点

#### 记忆 API (`/api/v1/memory`)

| 方法 | 路径 | 请求体 | 返回 | 说明 |
|------|------|--------|------|------|
| GET | `/memory?project_id={id}&conversation_id={id?}` | — | 记忆节点列表 + 边列表 (图谱数据) | 获取 AI 助手的完整图谱。返回所有永久记忆 + 指定对话的临时记忆。v1 一次性返回全部节点（预期 500 以内），如果超过上限后续版本加分页。 |
| POST | `/memory` | `{project_id, content, category?, type?, parent_memory_id?}` | 新建的记忆节点 | 手动创建记忆 |
| GET | `/memory/{id}` | — | 记忆详情（含关联文件、来源对话） | 查看单个记忆 |
| PATCH | `/memory/{id}` | `{content?, category?, position_x?, position_y?, parent_memory_id?}` | 更新后的记忆 | 编辑记忆 |
| DELETE | `/memory/{id}` | — | 204 | 删除记忆 + 关联向量 |
| POST | `/memory/{id}/promote` | — | 更新后的记忆 (type=permanent) | 临时→永久 |
| POST | `/memory/edges` | `{source_memory_id, target_memory_id}` | 新建的边 | 手动连线 |
| DELETE | `/memory/edges/{id}` | — | 204 | 断开连线 |
| POST | `/memory/search` | `{project_id, query, limit?}` | 匹配的记忆列表 + 相似度分数 | 语义搜索 |

#### 对话 API (`/api/v1/chat`)

| 方法 | 路径 | 请求体 | 返回 | 说明 |
|------|------|--------|------|------|
| GET | `/chat/conversations?project_id={id}` | — | 对话列表 | 获取 AI 助手的所有对话 |
| POST | `/chat/conversations` | `{project_id, title?}` | 新建的对话 | 创建新对话 |
| DELETE | `/chat/conversations/{id}` | — | 204 | 删除对话 + 关联的临时记忆 |
| GET | `/chat/conversations/{id}/messages` | — | 消息列表 | 获取对话历史 |
| POST | `/chat/conversations/{id}/messages` | `{content}` | AI 回复消息 | 发送消息并获取 AI 回复 |
| GET | `/chat/conversations/{id}/memory-stream` | — | SSE 事件流 | 实时推送新提取的记忆节点（阶段 3 实现） |

#### 错误响应

| 状态码 | 场景 | 说明 |
|--------|------|------|
| 404 | conversation_id / memory_id 不存在 | `{"detail": "Not found"}` |
| 422 | 请求体验证失败 | Pydantic 标准验证错误 |
| 429 | 发送消息频率过高 | 按用户限流（10 条/分钟） |
| 502 | 第三方模型 API 不可用 | `{"detail": "Model API unavailable", "retry_after": 5}` |
| 503 | 推理超时（>30s） | `{"detail": "Inference timeout"}` |

`POST /chat/conversations/{id}/messages` 的内部流程：
1. 保存用户消息到 `messages` 表
2. 调用推理编排层（检索 RAG + 加载记忆 + 组装 prompt + 调用模型 API）
3. 保存 AI 回复到 `messages` 表
4. 异步触发 Celery 任务：从本轮对话中提取新的临时记忆
5. 返回 AI 回复（v1 同步返回，v2 可改为 SSE 流式）

### 4.4 推理编排层

推理编排层是一个内部服务模块（非独立服务），负责组装推理请求：

```python
async def orchestrate_inference(
    project_id: str,
    conversation_id: str,
    user_message: str,
) -> str:
    # ① 检索 RAG 知识（向量相似度搜索，top 5）
    knowledge_chunks = await search_embeddings(
        workspace_id=workspace_id,
        project_id=project_id,
        query=user_message,
        limit=5,
    )

    # ② 加载记忆
    permanent_memories = await get_memories(
        project_id=project_id,
        type="permanent",
        limit=20,  # 最相关的 20 条永久记忆
    )
    temporary_memories = await get_memories(
        project_id=project_id,
        type="temporary",
        conversation_id=conversation_id,
    )

    # ③ 加载对话历史（最近 N 轮）
    recent_messages = await get_recent_messages(
        conversation_id=conversation_id,
        limit=20,
    )

    # ④ 加载人格设定
    personality = await get_project_personality(project_id)

    # ⑤ 组装 Prompt
    system_prompt = build_system_prompt(
        personality=personality,
        memories=permanent_memories + temporary_memories,
        knowledge=knowledge_chunks,
    )

    messages = [
        {"role": "system", "content": system_prompt},
        *recent_messages,
        {"role": "user", "content": user_message},
    ]

    # ⑥ 调用第三方模型 API
    response = await call_model_api(messages)

    # ⑦ 异步提取记忆
    extract_memories_task.delay(
        project_id=project_id,
        conversation_id=conversation_id,
        user_message=user_message,
        ai_response=response,
    )

    return response
```

### 4.5 记忆提取（Celery 任务）

对话后异步执行：

1. 将本轮对话（用户消息 + AI 回复）发给模型 API，使用以下提取 prompt：

```
你是一个记忆提取器。分析以下对话，提取值得记住的事实。

规则：
- 只提取具体事实，不提取观点或推测
- 事实必须关于用户本人（身份、偏好、计划、经历、关系）
- 不提取一般性知识（如"北京是中国首都"）
- 每个事实用一句话表达
- importance: 0-1，其中 ≥0.7 创建为临时记忆，≥0.9 直接升级为永久记忆
- category: 用中文，层级用点分隔（如"工作.计划"、"健康.用药"）

对话内容：
{user_message}
{ai_response}

输出 JSON 数组：
[{"fact": "...", "category": "...", "importance": 0.0-1.0}]

如果没有值得记忆的事实，输出空数组 []。
```

2. 解析模型返回的 JSON：`[{fact: "...", category: "...", importance: 0-1}]`
3. importance ≥ 0.7 的事实创建为蓝色临时记忆
4. 检查是否与已有永久记忆重复（向量相似度 > 0.9 则合并而非新建）
5. 蓝→红自动转换检查：该事实是否在不同对话中出现过 ≥ 2 次

### 4.6 蓝→红自动转换策略

| 触发条件 | 说明 | 实现方式 |
|---------|------|---------|
| 用户手动升级 | 用户在图谱上操作 | `POST /api/v1/memory/{id}/promote` |
| 重复出现 ≥ 2 次 | 同一事实在不同对话中重复提及 | 提取时检查向量相似度，相似记忆计数 ≥ 2 则自动升级 |
| AI 判断为关键事实 | 提取时 importance ≥ 0.9 | 提取 prompt 中标注的高重要性事实直接升级 |
| 关联文件上传 | 用户为某个记忆上传了文件 | 创建 memory_files 关联时检查并升级 |

---

## 5. 前端图谱

### 5.1 技术选型

| 方面 | 方案 | 说明 |
|------|------|------|
| 渲染引擎 | D3.js force-directed graph | v1: 2D Canvas 渲染，v2 可升级 Three.js 3D |
| 渲染模式 | Canvas (非 SVG) | 支持 1000+ 节点不卡顿 |
| 交互 | D3 zoom/pan + 自定义事件 | 拖拽、右键菜单、Shift+拖拽连线 |
| 详情面板 | React 侧边抽屉 | 点击节点后右侧滑出 |
| 实时更新 | SSE (v1) / WebSocket (v2) | 对话中产生新记忆时图谱动画新增节点 |
| 分层展示 | 语义缩放 | 缩小看大类聚类，放大看具体节点 |

### 5.2 界面布局

AI 助手详情页 (`/app/assistants/[id]`) 的新布局：

```
┌──────────────────────────────────────────────────────────────┐
│  顶栏: AI名称 + [🕸 记忆图谱 | ⚙️ 配置]  + 试用对话 + 保存  │
├────┬─────────────────────────────────────────────┬───────────┤
│筛选│                                             │  详情面板  │
│面板│           D3.js 记忆图谱                     │ (点击节点  │
│    │          (力导向布局)                        │  后展开)   │
│☑类目│                                            │           │
│☑时间│     🔴───🔴                                │ · 记忆文本 │
│☑来源│    / \    \                                │ · 来源对话 │
│☑类型│  🔴  🔴   🟠中心                           │ · 关联文件 │
│    │        \  / \                               │ · 创建时间 │
│搜索│         🔵  🔴──📄                          │ · 编辑按钮 │
│[__]│                                             │ · 删除按钮 │
├────┴─────────────────────────────────────────────┴───────────┤
│  工具栏: + 添加记忆 | 🔍 搜索 | 📊 统计                      │
└──────────────────────────────────────────────────────────────┘
```

- 筛选面板 (~160px)：左侧固定，可收起
- 图谱主区：占满剩余空间
- 详情面板 (~280px)：右侧滑出抽屉，点击节点时展开，点击空白处收起
- 工具栏 (40px)：底部固定

### 5.3 图谱组件结构

| 组件 | 文件 | 职责 |
|------|------|------|
| MemoryGraph | `components/console/graph/MemoryGraph.tsx` | D3 力导向图主组件，管理画布、缩放、力仿真 |
| GraphNode | `components/console/graph/GraphNode.ts` | 节点渲染逻辑（圆形/方形/样式/标签） |
| GraphEdge | `components/console/graph/GraphEdge.ts` | 连线渲染逻辑（实线/虚线/粗细） |
| GraphControls | `components/console/graph/GraphControls.tsx` | 工具栏（添加、搜索、统计、缩放控件） |
| GraphFilters | `components/console/graph/GraphFilters.tsx` | 左侧筛选面板 |
| NodeDetail | `components/console/graph/NodeDetail.tsx` | 右侧详情面板 |
| GraphContextMenu | `components/console/graph/GraphContextMenu.tsx` | 右键菜单 |
| useGraphData | `hooks/useGraphData.ts` | 数据获取和状态管理 hook |

### 5.4 对话界面集成

对话页面 (`/app/chat`) 改为支持真实对话：

- 左侧：对话列表（该 AI 助手的所有对话）
- 右侧：消息界面（当前对话）
- 对话中产生的蓝色记忆通过 SSE 实时推送到图谱
- 用户可在对话页面切换时，图谱上的蓝色节点跟随切换

---

## 6. 第三方依赖

### 6.1 模型 API

| 用途 | 推荐方案 | 备选 |
|------|---------|------|
| 推理（对话回复） | 阿里云 DashScope (Qwen 系列) | DeepSeek API |
| Embedding（向量化） | DashScope text-embedding-v3 | 本地部署 bge-m3 |
| 记忆提取 | 与推理同一模型（专用 prompt） | — |

### 6.2 数据库扩展

- PostgreSQL 15 + **pgvector 扩展**：需要在 Docker 镜像中安装 `pgvector`，或使用 `pgvector/pgvector:pg15` 镜像
- 向量维度：1024（DashScope text-embedding-v3 默认维度）
- 索引类型：HNSW（与 Section 4.2 embeddings 表定义一致，不依赖数据量调参）

### 6.3 前端新增依赖

- `d3` + `@types/d3`：图谱渲染
- 不需要其他新依赖（React、Framer Motion 等已有）

---

## 7. 实施阶段

| 阶段 | 内容 | 交付物 | 前置条件 |
|------|------|--------|---------|
| **阶段 1** | 数据库表 (memories, memory_edges, conversations, messages, embeddings, memory_files) + 记忆 CRUD API + 对话 CRUD API + 图谱可视化 (D3.js) + 全部交互操作 | 用户可以手动创建/编辑/连接记忆节点，看到图谱；对话界面连接真实数据库 | pgvector 安装 |
| **阶段 2** | 推理编排层 + 第三方模型 API 接入 + RAG 检索 + 记忆自动提取 (Celery) | AI 真正能用记忆回答问题，自动从对话提取新记忆 | 第三方 API key |
| **阶段 3** | 文件向量索引 + 蓝→红自动转换 + SSE 实时图谱更新 + 分层展示优化 | 完整闭环：上传文件→索引→对话→提取记忆→图谱实时更新 | 阶段 2 完成 |

---

## 8. 对现有系统的影响

### 8.1 不变的部分

- 现有 API 端点全部保持不变
- 现有数据库表不修改
- S3 存储继续复用
- 认证系统不变
- 前端刚完成的控制台重设计保持（新增图谱视图作为默认 Tab）

### 8.2 需要修改的部分

| 变更 | 说明 |
|------|------|
| Docker Compose | PostgreSQL 镜像替换为支持 pgvector 的镜像 |
| AI 助手详情页 | 新增图谱 Tab 作为默认视图，配置变为第二个 Tab |
| 对话页面 | 从 mock 响应升级为真实对话（连接后端 API） |
| Celery Worker | 新增记忆提取任务和文件索引任务 |
| 环境变量 | 新增第三方模型 API key 配置 |

---

## 9. 成功标准

1. 图谱能展示 500+ 节点且交互流畅（Canvas 渲染，60fps 缩放/平移）
2. 用户可以完成所有 10 种交互操作
3. 对话后 5 秒内提取出临时记忆并在图谱上显示
4. RAG 检索在 200ms 内返回结果
5. 每个用户的数据完全隔离（workspace_id 过滤）
6. 中英文完整支持

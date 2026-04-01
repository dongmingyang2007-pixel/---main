# 记忆图谱最终升级方案（面向 Codex 实施）

## 1. 文档目的

这是一份**可直接交给 Codex 落地实施**的最终版升级说明。

目标不是继续给现有图谱“加一点功能”，而是把它从：

- 以用户为唯一主体的记忆系统
- 主要用于拼接 prompt 的图谱

升级成：

- **多主体记忆图谱**
- **真正参与 AI 交互决策的图谱**
- **既能表达用户，也能表达书、项目、理论、学科、人物、设备等对象**
- **既能支持事实记忆，也能支持思维导图式知识链路**

本文会结合当前仓库中的后端与前端结构，给出：

1. 当前实现的真实状态  
2. 现阶段最核心的问题  
3. 最终目标结构  
4. 具体到表结构、服务、工具、交互链路的升级方案  
5. 文件级改造清单  
6. 迁移步骤  
7. 示例  
8. 验收标准  

---

## 2. 当前代码基线（基于现有仓库）

### 2.1 当前与记忆图谱强相关的文件

后端核心：

- `apps/api/app/models/entities.py`
- `apps/api/app/schemas/memory.py`
- `apps/api/app/routers/memory.py`
- `apps/api/app/routers/memory_stream.py`
- `apps/api/app/routers/chat.py`
- `apps/api/app/services/memory_metadata.py`
- `apps/api/app/services/memory_context.py`
- `apps/api/app/services/memory_category_tree.py`
- `apps/api/app/services/memory_related_edges.py`
- `apps/api/app/services/memory_file_context.py`
- `apps/api/app/services/memory_compaction.py`
- `apps/api/app/services/memory_graph_repair.py`
- `apps/api/app/services/memory_roots.py`
- `apps/api/app/services/llm_tools.py`
- `apps/api/app/services/orchestrator.py`
- `apps/api/app/tasks/worker_tasks.py`

前端核心：

- `apps/web/hooks/useGraphData.ts`
- `apps/web/components/console/graph/*`
- `apps/web/components/console/MemoryListView.tsx`

### 2.2 当前图谱的真实工作方式

当前系统并不是一个“静态展示图”，而是已经进入生产链路：

#### 写入链路
- 用户消息与 assistant 消息落库后，会异步触发 `extract_memories`
- 抽取器会做：
  - fact 抽取
  - importance 判断
  - duplicate 检查
  - triage（create / append / merge / replace / discard）
  - 自动 concept parent
  - related edges
  - category tree
  - compaction
  - repair

#### 读取链路
- `orchestrator.py` 会先做上下文路由：
  - `none`
  - `profile_only`
  - `memory_only`
  - `full_rag`
- 然后进入 `build_memory_context()`
- `build_memory_context()` 现在会组装：
  - static memories
  - relevant memories
  - graph neighbors
  - temporary memories
  - knowledge chunks
  - linked file chunks
- 然后把这些内容线性化成 prompt

#### 工具链路
- `llm_tools.py` 目前只暴露了三类函数工具：
  - `search_project_knowledge`
  - `search_project_memories`
  - `get_current_datetime`

#### 实时链路
- `memory_stream.py` 会向前端推送：
  - `new_memory`
  - `memory_promoted`
  - `graph_changed`

#### 前端图层
- `useGraphData.ts` 会把后端返回的 memory graph 再做一次增强
- 其中会**自己合成 synthetic category branch 节点**
- 也就是说，前端已经在把“分类树”当成视图层使用，而不是纯粹依赖后端真实节点

---

## 3. 当前实现最核心的问题

### 3.1 问题一：主体太单一
当前记忆抽取天然偏向“用户本人事实”。

这导致系统更像：

- 用户画像系统
- 个性化聊天记忆系统

而不是：

- 多对象知识系统
- 可展开的长期认知系统

但你现在真正要的是：

- 不只记住“用户喜欢什么”
- 还要记住“这本书讲了什么”
- 还要记住“这个理论如何展开”
- 还要记住“数学、几何学、微分几何、流形之间是什么链路”

### 3.2 问题二：节点类型混层
当前 `memories` 中混进了多种不同维度：

- 生命周期：`temporary / permanent`
- 语义分类：`profile / preference / goal / episodic / fact / summary`
- 结构角色：`assistant-root / concept / category-path / summary`
- 展示角色：前端又分 `fact / structure / theme / summary / file`

这会导致：
- 节点种类看起来很多
- 但很多并不是“真正不同的实体”
- 而是**同一实体的不同状态、不同投影、不同系统角色**

### 3.3 问题三：category-path 被做成了持久节点
`memory_category_tree.py` 现在会：

- 自动创建 category-path node
- 自动改 parent
- 自动删空 path node
- 自动建 auto edge

这会让图谱越来越像“系统脚手架堆积”，而不是“知识本体”。

而前端实际上已经能自己根据 `category_path` 合成分支节点，所以这类节点没必要成为主存储对象。

### 3.4 问题四：summary 被做成主图节点
`memory_compaction.py` 会把一组记忆压缩成 summary memory，并写入 `memories` 与 `memory_edges`。

summary 的价值是有的，但它的本质更像：

- 摘要缓存
- 派生视图
- 检索压缩层

它不是原始记忆本体。

### 3.5 问题五：读路径仍然在修图
当前 `build_memory_context()` 里还会执行：

- `ensure_project_category_tree()`
- `ensure_project_related_edges()`

这意味着回答问题时，图也在被改。

这会导致：

- 延迟不稳定
- 行为不可预测
- 调试困难
- 同一个问题上下两次答案不一致

### 3.6 问题六：图谱还没有真正接管交互
当前图谱虽然在参与上下文构建，但本质上还是：

- 先搜一些记忆
- 再把它们拼进 prompt

它还没有变成：

- 当前交互的导航层
- 当前交互的对象识别层
- 当前交互的子图展开层
- 当前交互的工具调度层

---

## 4. 最终升级目标

最终目标很明确：

> **把图谱从“用户记忆仓库”升级成“多主体认知图谱”，并让它直接参与 AI 的实际交互生产。**

换成更具体的话，就是：

1. 用户不再是唯一主体  
2. 书、项目、理论、学科、人物、设备，也都可以是主体  
3. 图谱不只存事实，还要能表达知识链路  
4. 图谱不只用于 prompt，还要用于交互中的对象识别、子图展开、工具选择和多轮连续推进  
5. 图谱主结构必须足够轻，不再允许节点继续膨胀  

---

## 5. 最终节点模型（推荐最终定稿）

## 5.1 主图谱只保留四类主节点

### A. Root
系统根节点。

作用：
- 项目级图谱总入口
- 作为所有 subject 的挂载点
- 不参与知识表达本身

只保留一个即可。

---

### B. Subject
**主体节点**。这是本次升级最关键的新节点。

它回答的是：

> 这段记忆、这条链路、这个主题，到底是关于谁或什么的？

Subject 可以是：

- 用户
- 一本书
- 一个项目
- 一个理论
- 一个学科
- 一个人物
- 一个模型
- 一个设备
- 一个课程
- 一篇论文

建议的 `subject_kind`：

- `user`
- `book`
- `project`
- `theory`
- `domain`
- `person`
- `model`
- `device`
- `course`
- `paper`
- `custom`

Subject 是主图谱的一级认知锚点。

---

### C. Concept
**概念节点**。这是认知骨架。

作用：
- 承载主题
- 承载思维导图式展开
- 作为事实的稳定上级
- 作为交互时“从哪里继续讲”的导航点

Concept 不是目录节点，它是语义节点。

例如：

- 饮食偏好
- 旅行限制
- 一般拓扑学
- 流形
- 李群
- 微分几何
- 经典力学
- 量子理论

Concept 允许形成层级链，也允许横向连接。

---

### D. Fact
**事实节点**。唯一的叶子主节点。

作用：
- 承载具体事实
- 承载定义
- 承载结论
- 承载例子
- 承载可引用的短知识单元

Fact 的原则：
- 短
- 清晰
- 尽量原子化
- 尽量单义
- 默认是叶子

例如：

- 用户喜欢冰美式
- 用户不喜欢红眼航班
- 《数学物理原理》第 4 章讨论一般拓扑学
- 流形可视为局部近似欧氏空间的对象
- 这本书从微积分逐步过渡到群论、拓扑、微分几何和量子理论

---

## 5.2 下面这些不再作为主图谱节点

### 不再作为主节点一：Category Path
例如：

- `数学.几何学.微分几何`
- `饮食.偏好.咖啡`

这类东西保留为：
- 元数据
- 查询索引
- 前端动态树视图

**不再持久化为 `Memory` 节点。**

---

### 不再作为主节点二：Summary
summary 仍然保留，但它变成：

- 派生对象
- 摘要缓存
- 检索压缩对象
- UI 辅助对象

不再是主图谱节点。

---

### 不再作为主节点三：File
文件不是 memory。

文件应该被视作：
- evidence
- artifact
- resource


---

## 5.3 生命周期与语义标签不再当作节点类型

### `temporary / permanent`
这是生命周期，不是节点种类。

### `profile / preference / goal / episodic / fact`
这是语义标签，不是节点种类。

这些继续保留在 metadata 或单独列中都可以，但不要再把它们和 `subject / concept / fact` 混在一起当节点类型。

---

## 6. 最终关系模型

建议主图谱只保留少量关系类型。

## 6.1 主关系

### 1. `parent`
主层级关系。

适用于：
- root -> subject
- subject -> concept
- concept -> concept
- concept -> fact
- subject -> fact（当 fact 暂时没有更合适 concept 时）

这是主导航关系。

---

### 2. `related`
横向相关关系。

适用于：
- concept <-> concept
- fact <-> fact
- subject <-> subject
- concept <-> fact

用于“不是上下级，但明确有关”。

---

### 3. `prerequisite`
前置关系。

适用于：
- concept -> concept

例如：
- 拓扑空间 -> 流形
- 群论 -> 群表示论
- 微积分 -> 经典力学中的变分法理解

这是知识教学场景非常关键的一类边。

---

### 4. `evidence`
证据关系。

适用于：
- subject/concept/fact -> file/data_item/chunk

第一阶段可以逻辑上保留，物理上仍使用 `memory_files` + embedding chunk 检索实现。

---

## 6.2 不建议继续保留为核心语义的关系

### `auto`
不建议继续作为主要语义边类型。

自动生成可以保留为行为来源，但不该成为关系本体定义。

### `summary`
summary 不再是主图谱节点后，这类边也不该再占主关系位置。

---

## 7. 最终数据结构建议

为了兼顾现有代码改造成本，建议采用**渐进升级**，而不是一步重建全部表。

## 7.1 第一阶段：保留 `memories` 表，但增强语义

### `memories` 新增建议列

在 `apps/api/app/models/entities.py` 的 `Memory` 上新增：

- `node_type: TEXT NOT NULL DEFAULT 'fact'`
  - 取值：`root | subject | concept | fact`

- `subject_kind: TEXT NULL`
  - 仅 `node_type = 'subject'` 时使用

- `subject_memory_id: UUID NULL`
  - 指向所属 subject
  - `subject` 自己可以为空
  - `concept` / `fact` 必须有值

- `node_status: TEXT NOT NULL DEFAULT 'active'`
  - 取值：`active | superseded | archived`

- `canonical_key: TEXT NULL`
  - 用于概念或事实去重
  - 同一 subject 内唯一即可

建议保留现有字段：

- `content`
- `category`
- `type`
- `parent_memory_id`
- `metadata_json`

说明：

- `category` 仍保留，但只作为分类索引与展示字段
- `type` 继续表示 `temporary / permanent`
- `parent_memory_id` 继续保留，用于主层级
- `subject_memory_id` 是关键新增，它确保“这个节点到底属于哪个主体”不再依赖树位置猜测

---

## 7.2 第一阶段：保留 `memory_edges` 表，但收紧语义

`edge_type` 建议最终收敛为：

- `parent`
- `related`
- `prerequisite`
- `manual`
- `evidence`（如需要显式化）

如果第一阶段不想新增 `parent` edge，也可以先继续用 `parent_memory_id` 表达主层级，把 `memory_edges` 限定为：

- `related`
- `prerequisite`
- `manual`

---

## 7.3 新增 `memory_views` 表（用于 summary 与派生视图）

建议新增新表，而不是把 summary 继续塞到 `memories`：

```sql
memory_views (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  project_id UUID NOT NULL,
  source_subject_id UUID NULL,
  view_type TEXT NOT NULL,        -- summary / category_rollup / outline
  content TEXT NOT NULL,
  metadata_json JSON NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
)
```

可选字段：

- `source_memory_ids JSON`
- `summary_group_key TEXT`

### 这样做的好处
- summary 不再污染主图谱
- retrieval 仍然能吃 summary
- UI 仍然能展示 summary
- 后续 category rollup / subject outline 也有地方放

---

## 7.4 `Conversation` 建议新增 `metadata_json`

当前 conversation 没有 metadata。  
如果想让多轮交互真正沿同一条链路推进，建议新增：

- `conversations.metadata_json JSON NOT NULL DEFAULT '{}'`

用于记录：

- `active_subject_ids`
- `active_concept_ids`
- `active_route`
- `last_graph_focus`
- `interaction_mode`

这是让图谱进入多轮交互生产的关键支持。

---

## 8. 最终生产逻辑

## 8.1 在线读路径（最终版本）

### 目标
让图谱在真实交互时接管：

- 当前对象识别
- 当前子图激活
- 当前上下文裁剪
- 当前工具选择

### 步骤

#### 第一步：识别当前 active subject
输入当前 user turn，输出当前最可能的主体：

- 用户
- 某本书
- 某个项目
- 某个理论
- 某门学科
- 某个人物
- 某个设备

来源：
1. 明确提及
2. 上一轮 active subject
3. 当前 conversation metadata
4. 高相似 subject 检索
5. 若都不确定，回退到 user subject 或 project root

#### 第二步：激活 subject 下的局部子图
只展开与本轮有关的局部图：

- subject 本身
- 相关 concept
- concept 的 parent/child
- related / prerequisite 邻居
- 少量最相关 fact

不要整图扩散。

#### 第三步：补证据
从已选节点关联的资料里取 chunk：

- 先 subject 级
- 再 concept/fact 级
- 再走 embedding chunk 检索

#### 第四步：决定回答组织方式
图谱要回答的不只是“拿什么内容”，还包括：

- 先解释定义
- 先讲上下位关系
- 先补前置概念
- 先举书内例子
- 先比较两个概念

#### 第五步：记录本轮 focus
在 conversation metadata 写回：

- 当前 active subject
- 当前 active concepts
- 当前 route

这样下一轮可以延续。

---

## 8.2 在线读路径示例

### 示例 A：用户相关问题
用户说：
> 你还记得我不喜欢什么出行方式吗？

系统应该：

1. 激活 `Subject(user)`
2. 取该 subject 下的 `旅行限制`
3. 取其中 fact：`用户不喜欢红眼航班`
4. 直接回答

而不是去搜全图。

---

### 示例 B：书相关问题
用户说：
> 继续讲这本书里的流形。

系统应该：

1. 激活 `Subject(book: 数学物理原理)`
2. 找到 concept：`流形`
3. 取其 parent：`一般拓扑学` 或其上位链
4. 取其 child / related：`切空间`、`微分几何`
5. 再补书内相关 chunk
6. 再回答

---

### 示例 C：知识链路问题
用户说：
> 流形和拓扑空间是什么关系？

系统应该：

1. 仍然激活 `Subject(book: 数学物理原理)`，若无再回退 `Subject(domain: 数学)`
2. 取 concept：
   - 拓扑空间
   - 流形
3. 查 `prerequisite` 或 `related`
4. 若当前用户上下文已经在“微分几何”链上，则沿该链解释
5. 若用户还没掌握前置概念，则先补前置，再解释关系

---

## 8.3 异步写路径（最终版本）

### 目标
让写入系统只做三件事：

1. 产出高质量原子 fact  
2. 把 fact 归到正确 subject  
3. 在必要时建立 concept 骨架  

### 步骤

#### 第一步：抽取 candidate facts
规则：
- 仍然只从用户原话或文件解析结果里抽
- 仍然保持原子化
- 仍然做 importance 过滤

#### 第二步：先做 subject resolution
这是当前系统没有系统化做好的地方。

对于每个 fact，先判断它属于哪个 subject：

- 用户自己
- 某本书
- 某个项目
- 某个理论
- 某个学科
- 某个人
- 某个设备

**subject 先于 concept。**

#### 第三步：再做 concept resolution
不是所有 fact 都要立即挂 concept。

只在以下情况建立 concept：
- 同一 subject 下已经有 2~3 条稳定同主题 fact
- 或某主题在跨轮反复出现
- 或它明显会成为后续解释锚点

否则 fact 可以先直接挂在 subject 下。

#### 第四步：只写入主节点
主图谱只允许写入：

- root
- subject
- concept
- fact

不再写入：

- category-path node
- summary node

#### 第五步：异步派生视图
另起异步任务生成：

- summary
- subject outline
- category rollup

写到 `memory_views`，不是写回主图谱。

---

## 8.4 异步写路径示例

### 示例 A：用户事实
用户说：
> 我喜欢冰美式，也不喜欢红眼航班。

正确写法：

- Subject(user)
  - Concept(饮食偏好)
    - Fact(用户喜欢冰美式)
  - Concept(旅行限制)
    - Fact(用户不喜欢红眼航班)

而不是一条聚合记忆：
- `用户喜欢冰美式，也不喜欢红眼航班`

---

### 示例 B：书对象
当用户上传《数学物理原理》并触发对象建模时：

先写：
- Subject(book: 数学物理原理)

再从目录和内容中抽取概念骨架：
- Concept(微积分学初步)
- Concept(群论)
- Concept(一般拓扑学)
- Concept(流形)
- Concept(微分几何学)
- Concept(经典力学)
- Concept(量子理论初步)

再抽关键事实：
- Fact(本书将群论、拓扑学、微分几何学和群表示论逐步引入物理学框架)
- Fact(一般拓扑学之后引入流形)
- Fact(微分几何学紧接流形展开)
- Fact(本书后续进入经典力学与量子理论)

---

### 示例 C：数学知识主体
Subject(domain: 数学)

其 concept 链可以是：

- Concept(几何学)
  - Concept(微分几何)
    - Concept(流形)

同时还有横向关系：

- `拓扑空间 -> prerequisite -> 流形`
- `流形 -> related -> 微分形式`
- `流形 -> related -> 李群`
- `流形 -> related -> 广义相对论`

这就是“思维导图式链路”的最小可用形式。

---

## 9. Concept 节点的最终规则（定稿）

这是最关键的一条规则之一。

## 9.1 Concept 的定位
Concept 不是目录。  
Concept 是**认知锚点**。

它的作用不是“把东西分类放好”，而是：

- 让 AI 知道当前该沿哪条主题链继续解释
- 让 AI 知道哪些 fact 属于同一个理解单元
- 让 AI 知道哪些前置概念需要先补

## 9.2 Concept 只在这些条件下创建

### 自动创建条件
满足以下任一即可：

1. 同一 subject 下已经累计 2~3 条高质量同主题 fact  
2. 同一主题跨轮重复出现  
3. 该主题明显会成为后续多轮讨论锚点  
4. 该主题是一本书、课程或项目中的稳定章节级概念  
5. 该主题被用户明确要求“建立一个主题”  

### 不自动创建的情况
不要因为以下情况就建 concept：

- 只有一条孤立 fact
- 只是 category path 恰好存在
- 只是词面相近
- 只是为了让图看起来更满

## 9.3 Concept 的数量原则
Concept 要求：
- 少
- 稳
- 准

不要泛滥。

一张好图不是 concept 越多越强，而是**concept 越少越能当骨架**。

---

## 10. Tool 设计升级（让图谱真正进入交互生产）

当前 `llm_tools.py` 只提供：
- `search_project_knowledge`
- `search_project_memories`
- `get_current_datetime`

这不够。

建议增加以下工具。

## 10.1 新增工具（第一批）

### `resolve_active_subjects`
输入：
- 当前用户消息
- 当前 conversation focus

输出：
- 最相关 subject 列表
- 每个 subject 的置信度
- 主 subject

---

### `get_subject_overview`
输入：
- `subject_id`

输出：
- subject 基本信息
- 一级 concept
- 最近活跃 fact
- 推荐展开路径

---

### `expand_subject_subgraph`
输入：
- `subject_id`
- `query`
- `depth`
- `edge_types`

输出：
- 本轮相关子图

---

### `get_concept_neighbors`
输入：
- `concept_id`

输出：
- parent
- children
- related
- prerequisite
- recent facts

---

### `search_subject_facts`
输入：
- `subject_id`
- `query`
- `top_k`

输出：
- fact 列表

---

### `search_subject_documents`
输入：
- `subject_id`
- `query`
- `top_k`

输出：
- 关联资料摘录

---

### `get_explanation_path`
输入：
- `subject_id`
- `concept_id`
- `target_style`

输出：
- 建议解释顺序
- 前置概念
- 相关概念

---

## 10.2 工具调用原则

### 模型不要一上来拿全量 prompt
应该变成：

1. 识别当前 subject  
2. 按需展开图  
3. 按需查知识块  
4. 按需查事实  
5. 再生成答案  

这会显著减少：
- token 浪费
- 上下文污染
- 随机发挥

---

## 11. 对现有文件的具体改造建议

下面这一部分是 Codex 最应该直接照着改的部分。

## 11.1 `apps/api/app/models/entities.py`

### 必改
#### `Memory`
新增：
- `node_type`
- `subject_kind`
- `subject_memory_id`
- `node_status`
- `canonical_key`

### 保留
- `content`
- `category`
- `type`
- `parent_memory_id`
- `metadata_json`

### 新增表
- `memory_views`
- 可选：给 `Conversation` 新增 `metadata_json`

---

## 11.2 `apps/api/app/schemas/memory.py`

### 必改
扩展 API schema，显式暴露：
- `node_type`
- `subject_kind`
- `subject_memory_id`
- `node_status`
- `canonical_key`

### 新增 schema
- `SubjectResolveRequest`
- `SubjectResolveResult`
- `SubjectOverviewOut`
- `SubgraphRequest`
- `SubgraphOut`

---

## 11.3 `apps/api/app/services/memory_metadata.py`

### 必改
把当前围绕：
- `concept`
- `category-path`
- `summary`
- `memory_kind`

的混合逻辑拆开。

### 新目标
这里应该只负责：
- node type 判断
- subject kind 判断
- lifecycle 和 kind 的标准化
- category path 元数据标准化
- canonical key 生成
- 使用痕迹 stamp

### 明确删除 / 降级
- 不再把 `category-path` 视作主节点语义
- 不再把 `summary` 视作主节点语义

---

## 11.4 `apps/api/app/services/memory_category_tree.py`

### 处理建议
**不再负责持久化 category-path node。**

改成两种之一：

#### 方案 A（推荐）
直接废弃持久化逻辑，只保留：
- `normalize_category_path`
- `build_category_view_tree(...)`

#### 方案 B
保留文件，但只返回“视图层树结构”，不再写 `Memory`

### 必须移除
- `_ensure_path_node`
- path node 持久化
- 空 path node 清理
- path node auto edge 同步

---

## 11.5 `apps/api/app/services/memory_compaction.py`

### 处理建议
保留摘要能力，但**移出主图谱**。

### 改法
- 不再向 `memories` 写 summary node
- 改为向 `memory_views` 写 summary
- retrieval 可以读取 `memory_views`
- graph 主视图默认不展示 summary 为主节点

---

## 11.6 `apps/api/app/services/memory_graph_repair.py`

### 处理建议
大幅简化。

### 新版只做这些校验
- root 只挂 subject
- subject / concept / fact 的 node_type 合法
- concept / fact 必须有 `subject_memory_id`
- fact 不能自动挂 fact
- 不允许循环 parent
- 不允许跨 subject 错挂
- 删除历史遗留的 `category-path` / `summary` 主节点

---

## 11.7 `apps/api/app/services/memory_related_edges.py`

### 处理建议
保留，但范围收紧。

### 新规则
- `related` 不允许替代主层级
- `prerequisite` 主要用于 concept 间
- `related` 只在同一 subject 内优先建立
- 跨 subject 的 related 必须更谨慎

### 建议新增
- `prerequisite` 计算逻辑
- `related` / `prerequisite` 的单独同步器

---

## 11.8 `apps/api/app/services/memory_file_context.py`

### 处理建议
保留，第一阶段不重构表。

### 但要调整语义
文件可以附着到：
- subject
- concept
- fact

其作用变成：
- 给主体提供资料背景
- 给概念提供证据
- 给事实提供出处

---

## 11.9 `apps/api/app/services/memory_context.py`

### 这是重点文件，必须重写核心策略

当前它做的是 layered_memory_v2：
- static
- relevant
- graph
- temporary
- knowledge
- linked file

### 新目标
改成：

#### 第一步：resolve active subject
#### 第二步：expand subject subgraph
#### 第三步：select active concepts
#### 第四步：retrieve facts
#### 第五步：retrieve evidence
#### 第六步：assemble context block

### 最重要的变化
- 不再在这里修图
- 不再调用 `ensure_project_category_tree()`
- 不再调用 `ensure_project_related_edges()` 作为在线读路径的一部分

### 建议新增内部函数
- `resolve_active_subject_ids(...)`
- `expand_subject_subgraph(...)`
- `rank_subject_nodes_for_turn(...)`
- `load_subject_evidence_chunks(...)`
- `build_graph_guided_system_prompt(...)`

---

## 11.10 `apps/api/app/services/llm_tools.py`

### 必改
新增 subject / concept / graph 工具。

建议第一批实现：
- `resolve_active_subjects`
- `get_subject_overview`
- `expand_subject_subgraph`
- `search_subject_facts`
- `search_subject_documents`
- `get_concept_neighbors`

### 保留旧工具
- `search_project_knowledge`
- `search_project_memories`
- `get_current_datetime`

但这些旧工具以后只是回退工具，不再是主图谱交互入口。

---

## 11.11 `apps/api/app/services/orchestrator.py`

### 必改
这里要让图谱真正进入交互生产。

### 新逻辑
当前：
- context route
- build_memory_context
- optional function tools

升级后：
- context route
- resolve active subject
- inject graph-aware tools
- on-demand graph expansion
- evidence retrieval
- answer

### 关键改动
#### Responses / function calling 里，把图谱工具作为一等公民
模型应该优先用：
- subject tools
- concept tools
- graph tools

而不是只拿大 prompt。

---

## 11.12 `apps/api/app/tasks/worker_tasks.py`

### 这是写路径重点文件，必须重构

当前：
- 抽 fact
- triage
- auto concept parent
- category tree
- related edges
- compaction
- repair

### 新目标
改成：

#### 第一步：extract atomic facts
#### 第二步：resolve subject
#### 第三步：resolve concept
#### 第四步：write fact node
#### 第五步：schedule derived views
#### 第六步：schedule related/prerequisite sync
#### 第七步：schedule repair

### 必须删掉的旧行为
- 不再自动创建 category-path memory
- 不再把 summary 写入 memories
- 不再让 repair 围绕 category-path / summary 主节点运转

---

## 11.13 `apps/api/app/routers/memory.py`

### 必改
保留基础 CRUD，但要引入新能力。

### 建议新增接口
- `POST /api/v1/memory/subjects/resolve`
- `GET /api/v1/memory/subjects/{id}/overview`
- `POST /api/v1/memory/subjects/{id}/subgraph`
- `POST /api/v1/memory/graph-search`

### 图接口改造
当前 graph 接口仍然返回旧式 memory graph。  
升级后需要显式支持：
- root
- subject
- concept
- fact
- file/evidence

### 明确行为
- 主图 API 不再返回 category-path persistent node
- summary 默认不作为主图节点返回
- 若前端要 summary，可单独拉 `memory_views`

---

## 11.14 `apps/api/app/routers/memory_stream.py`

### 处理建议
保留 SSE，但事件类型可以更明确。

建议补充或统一成：
- `node_created`
- `node_updated`
- `node_promoted`
- `graph_changed`
- `view_updated`

如果短期不想改事件名，至少保证：
- subject / concept / fact 更新能被正确感知
- graph revision 继续工作

---

## 11.15 `apps/api/app/routers/chat.py`

### 必改
`send_message` 与 `stream_message` 在保存 assistant 消息后，需要顺手记录：

- 当前 active subject ids
- 当前 active concept ids
- 当前 interaction route

如果给 `Conversation` 新增了 `metadata_json`，就在这里更新 conversation focus。

---

## 11.16 `apps/web/hooks/useGraphData.ts`

### 必改
当前这里会：
- 合成 synthetic category branch node

升级后建议：

#### 删除 synthetic category branch 逻辑
不再构造 category-path 作为主图层节点。

#### 新增主角色
- `root`
- `subject`
- `concept`
- `fact`
- `file/evidence`

#### 颜色与展示分层建议
- subject：一级重心
- concept：骨架节点
- fact：叶子节点
- file/evidence：证据节点

---

## 11.17 前端 Graph 组件

需要同步调整：

- `MemoryGraph.tsx`
- `NodeDetail.tsx`
- `MemoryListView.tsx`

### 重点
Node detail 里要把节点类型说清楚：
- 这是主体
- 这是概念
- 这是事实
- 这是证据

并显示：
- 所属 subject
- 上下级关系
- related / prerequisite
- 证据链接

---

## 12. 最终交互设计示例

## 12.1 用户主体示例

### 图结构
```text
Root
└── Subject(用户)
    ├── Concept(饮食偏好)
    │   └── Fact(用户喜欢冰美式)
    └── Concept(旅行限制)
        └── Fact(用户不喜欢红眼航班)
```

### 交互
用户问：
> 你还记得我不喜欢什么出行方式吗？

系统路径：
1. resolve subject -> 用户
2. expand subject -> 旅行限制
3. retrieve fact -> 不喜欢红眼航班
4. 回答

---

## 12.2 书主体示例

### 图结构
```text
Root
└── Subject(《数学物理原理》)
    ├── Concept(微积分学初步)
    ├── Concept(群论)
    ├── Concept(一般拓扑学)
    │   └── Concept(流形)
    ├── Concept(微分几何学)
    ├── Concept(经典力学)
    └── Concept(量子理论初步)
```

### 交互
用户问：
> 继续讲这本书里的流形。

系统路径：
1. resolve subject -> 《数学物理原理》
2. expand subgraph -> 一般拓扑学 / 流形 / 微分几何学
3. retrieve evidence -> 书中相关片段
4. answer

---

## 12.3 学科主体示例

### 图结构
```text
Root
└── Subject(数学)
    └── Concept(几何学)
        └── Concept(微分几何)
            └── Concept(流形)
```

横向关系：
- 拓扑空间 -> prerequisite -> 流形
- 流形 -> related -> 微分形式
- 流形 -> related -> 李群

### 交互
用户问：
> 流形和拓扑空间是什么关系？

系统路径：
1. resolve subject -> 数学 / 书
2. expand concepts -> 流形 + 拓扑空间
3. check prerequisite
4. answer with path, not only definition

---

## 13. 迁移方案（必须分阶段）

## Phase 1：收紧主图谱类型
### 目标
先把主图谱节点类型收敛。

### 要做
- 给 `Memory` 增加 `node_type / subject_kind / subject_memory_id / node_status / canonical_key`
- 停止新建 category-path node
- 停止新建 summary node 到 `memories`
- 保留旧数据，但新写入用新规范

### 不要做
- 不要一开始就重做全部前端

---

## Phase 2：Subject 进入读路径
### 目标
先让图谱能识别当前对象。

### 要做
- Conversation 增加 focus metadata（如果采用该方案）
- `memory_context.py` 改成 subject-aware
- `llm_tools.py` 新增 subject / graph 工具
- `orchestrator.py` 调用新工具

---

## Phase 3：Subject 进入写路径
### 目标
让新记忆不再默认全是“用户事实”。

### 要做
- `worker_tasks.py` 新增 subject resolution
- concept resolution 收紧
- fact 统一变叶子
- derived view 异步生成

---

## Phase 4：前端主图更新
### 目标
让前端图真正展示新主结构。

### 要做
- `useGraphData.ts` 去掉 synthetic category branch
- 图层按 root / subject / concept / fact / evidence 展示
- Node detail 展示 subject / concept / fact 区别

---

## Phase 5：清理历史逻辑
### 目标
把旧的 category-path / summary 主节点逻辑完全移出主流程。

### 要做
- 简化 repair
- category tree 改成纯视图
- compaction 改写入 `memory_views`
- 清理旧 node_kind 兼容代码

---

## 14. 建议的验收标准

以下全部满足，才算升级成功。

### 数据层
- 新写入主图谱只出现 `root / subject / concept / fact`
- 不再新增 `category-path` memory
- 不再新增 `summary` memory
- 每个 concept / fact 都能追溯到一个 subject

### 交互层
- 用户问题能正确激活 user subject
- “这本书”“这个项目”“这个理论”类问题能正确激活对应 subject
- 多轮对话能延续同一 subject 链路
- 回答能沿图路径推进，而不是每轮重新发挥

### 检索层
- prompt 不再堆满全量记忆
- 图谱工具能够按需展开子图
- 文件证据能够跟随 subject / concept / fact 被召回

### 前端层
- 图结构清晰显示 root / subject / concept / fact
- 不再依赖 synthetic category-path 作为主骨架
- 节点详情能解释“这个节点是什么、属于谁、和什么有关”

### 维护层
- repair 逻辑显著简化
- compaction 不再污染主图
- 在线读路径不再隐式改图

---

## 15. 最终结论（给 Codex 的一句话指令）

如果只保留一句最重要的话，我建议直接交给 Codex：

> **把当前以用户为中心、混合 category-path / summary / concept / fact 的 memory graph，升级成以 `root -> subject -> concept -> fact` 为主结构的多主体认知图谱；让 subject 成为交互入口，让 concept 成为认知骨架，让 fact 成为叶子事实；把 category-path 与 summary 下放到派生视图层，并让 orchestrator 与 llm_tools 通过 subject-aware graph tools 在交互中按需激活子图、调用证据和组织答案。**

---

## 16. 给 Codex 的实施顺序（最推荐）

1. 先改数据模型  
2. 再改 `memory_metadata.py`  
3. 再停掉 `memory_category_tree.py` 的持久化 path node  
4. 再改 `worker_tasks.py` 的写入逻辑  
5. 再改 `memory_context.py` 和 `llm_tools.py`  
6. 再改 `orchestrator.py`  
7. 再改 `memory.py` router  
8. 最后改 `useGraphData.ts` 和图前端

这样风险最低。

---

## 17. 明确不建议的做法

为了避免 Codex 走偏，这里单独列出：

### 不建议 1
不要继续在 `memories` 里增加更多 node_kind。

### 不建议 2
不要把 category-path 留作主节点继续扩。

### 不建议 3
不要继续把 summary 放进主图谱。

### 不建议 4
不要把“记忆种类”和“节点种类”混在一起。

### 不建议 5
不要让在线读路径继续修图。

### 不建议 6
不要一开始就追求一个庞大本体库。
先把：
- subject
- concept
- fact
- evidence
这几层做稳。

---

## 18. 本方案的核心收益

这次升级后，系统将同时获得四个能力：

### 1. 更高的记忆密度
因为 fact 会更原子，summary 会从主图退场，context 也更可控。

### 2. 更严谨的结构
因为目录节点和语义节点不再混用。

### 3. 更强的可塑性
因为 category tree 和 summary 变成派生层，未来可重建。

### 4. 更强的交互能力
因为图谱会真正参与：
- 当前对象识别
- 当前路径展开
- 当前上下文裁剪
- 当前工具调用
- 多轮连续推进

这才是图谱真正进入 AI 实际交互生产的方式。

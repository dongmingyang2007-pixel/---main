# 起航对话页面 UI 升级方案（记忆写入 / 记忆调取 / 对话 / 思考）

## 1. 文档目的

这份文档用于把当前对话页的前端升级思路整理成一份可执行的产品与工程方案。目标不是做一版“更花哨”的视觉稿，而是把当前页面从**可观测性控制台**升级成一套**用户可理解、工程可调试、后续可扩展**的对话工作台。

这份方案基于当前代码实现阅读后整理，重点覆盖：

- 记忆写入反馈区
- 记忆调取展示区
- 主对话区
- 思考 / reasoning 展示区
- 与之关联的输入栏、模式切换、右侧信息面板、测试与样式改造

---

## 2. 已阅读的前端代码范围

本方案基于以下文件阅读后给出：

### 路由与页面层
- `apps/web/app/[locale]/(console)/app/chat/page.tsx`
  - 负责项目切换、会话列表、URL 参数同步、聊天页整体两栏布局

### 对话编排层
- `apps/web/components/console/ChatInterface.tsx`
  - 负责消息加载、流式输出、模式切换、语音状态、消息发送、metadata patch 合并

### 消息渲染层
- `apps/web/components/console/ChatMessageList.tsx`
  - 负责消息卡片、推理折叠、检索 trace、source chip、记忆写入卡片渲染

### 输入与模式层
- `apps/web/components/console/ChatInputBar.tsx`
  - 负责输入框、上传图片、拍照、自动朗读、搜索、深度思考等工具入口
- `apps/web/components/console/ChatModePanel.tsx`
  - 负责普通对话 / Omni 实时 / 合成实时模式切换

### 数据结构层
- `apps/web/components/console/chat-types.ts`
  - 定义 `Message`、`RetrievalTrace`、`ExtractedFact`、`SearchSource` 等 metadata 结构

### 样式层
- `apps/web/styles/globals.css`
  - 包含 chat 页面、memory 页面、assistant detail 页面、sidebar、reasoning、retrieval trace、memory card 的大量样式实现

### 自动化测试层
- `apps/web/tests/console-shell.spec.ts`
  - 当前聊天页面已有大量 Playwright 行为测试，包括 reasoning、memory card、retrieval trace、source card、输入区、模式切换、自动朗读等

---

## 3. 当前页面的核心判断

### 3.1 当前页面的优点

当前实现已经有几项非常难得的优点：

1. **系统可观察性强**
   - 用户可以看到 reasoning
   - 可以看到 retrieval trace
   - 可以看到 memory extraction / extracted facts
   - 可以看到 source chip 与 citation preview

2. **前后端契约已经比较完整**
   - `Message` 已经支持 `reasoningContent`、`retrievalTrace`、`extracted_facts`、`memories_extracted` 等字段
   - `mergeAssistantMetadataPatch()` 已经支持后到的 metadata 增量合并
   - 这说明页面的数据基础已经够支持“分层展示”，不需要推倒重来

3. **产品形态已有品牌感**
   - 紫色系工作台、左侧会话栏、主消息区、底部输入区的视觉统一性已经建立
   - 有能力往“工作台”而不是“普通 IM 聊天”方向延展

### 3.2 当前页面的核心问题

当前页面最大的问题不是功能少，而是：

> **用户层信息、系统调试信息、模型内部过程信息，在同一条消息流里用近似同等级的视觉方式呈现。**

结果就是：

- 助手回答不够“主角”
- 记忆写入像数据库日志
- 记忆调取像检索调试台
- 思考过程像内部 scratchpad 外露
- 输入栏像控制台，不像对话入口
- 主对话区与调试区边界模糊，导致认知负担上升

一句话总结：

> 当前页面更像“AI 可观测性控制台”，而不是“默认给用户使用的对话页面”。

---

## 4. 现状拆解：按模块逐项诊断

---

## 4.1 记忆写入部分：目前更像系统回执，不像用户可控事件

### 当前实现特点

当前页面会在 assistant message 下方通过 `MemorySummaryCard` 直接渲染：

- `memories_extracted`
- `extracted_facts[]`
- `importance`
- `status`
- `triage_action`
- `triage_reason`

并以大卡片形式直接插入消息流。

### 当前问题

#### 问题 1：语言像后端处理结果
例如：

- 永久记忆
- 临时记忆
- 处理：新建
- 重要度 90%

这些表达非常适合开发调试，不适合默认面向用户。

#### 问题 2：百分比数值过多
用户会看到：

- 80%
- 90%
- 重要度 90%

但这些数字之间的量纲不统一：

- 有的是重要度
- 有的是显著度
- 有的是打分结果
- 有的是召回置信感受

用户很容易误解，也会产生“这套系统是不是不稳定”的感受。

#### 问题 3：缺少控制动作
既然页面已经告诉用户“记住了”，那用户接下来最自然的问题是：

- 我能撤销吗？
- 我能改写吗？
- 我能把它改成长期/短期吗？
- 我能忽略这条吗？

当前默认展示里几乎没有给到这种“记忆治理”动作。

### 升级目标

把“记忆写入”从**系统日志卡片**升级成**用户可理解、可追踪、可撤销的记忆事件**。

### 建议的默认展示

不要默认显示完整大卡片。改成 assistant message 下方的一行事件摘要：

- `已写入 2 条记忆`
- `1 条长期，1 条本轮临时`
- 操作：`查看详情` `撤销` `编辑`

默认仅此一层。

### 建议的展开层结构

点击“查看详情”后，在右侧 inspector 或抽屉中展示：

#### 一级信息（用户层）
- 记住了什么
- 属于哪个主题
- 长期 / 本轮临时
- 为什么值得记住（简要）

#### 二级信息（半调试层）
- 系统动作：新建 / 合并 / 追加 / 替换 / 丢弃
- 重要级别：高 / 中 / 低

#### 三级信息（开发层）
- raw `triage_action`
- raw `triage_reason`
- raw `target_memory_id`
- numeric importance score

### 文案升级建议

| 当前文案 | 建议改为 | 说明 |
|---|---|---|
| 永久记忆 | 长期档案 | 更接近用户心智 |
| 临时记忆 | 本轮记住 | 更弱化系统术语 |
| 处理：新建 | 已新增 | 用户层更自然 |
| 处理：合并 | 已合并到已有记忆 | 说明结果，不讲系统术语 |
| 重要度 90% | 高优先级 | 默认不展示百分比 |
| 丢弃 / discard | 未写入 | 对用户更友好 |

### 推荐的 UI 形态

#### 默认态
- assistant message 下方三枚胶囊之一：`写入了 2 条记忆`

#### 悬停 / 点击态
- 右侧打开 `记忆写入` tab
- 展示写入列表
- 每条支持：
  - 编辑内容
  - 改为长期 / 改为本轮
  - 删除
  - 查看关联节点

### 推荐新增组件

- `ChatMemoryWriteChip.tsx`
- `ConversationInspectorMemoryWriteTab.tsx`
- `MemoryWriteItemCard.tsx`
- `MemoryWriteActionBar.tsx`

---

## 4.2 记忆调取部分：当前对内很好，但默认暴露层级过深

### 当前实现特点

当前 assistant message 下方通过 `CollapsibleRetrievalTrace` 展示：

- `context_level`
- `strategy`
- `memory_counts`
- `memories[]`
- `knowledge_chunks[]`
- `linked_file_chunks[]`

并将不同 source、memory_kind、score、salience 等直接渲染出来。

### 当前问题

#### 问题 1：当前展示是“检索管线视角”，不是“用户理解视角”
例如用户真正关心的是：

- 你参考了我哪些长期信息？
- 你有用到我刚说的内容吗？
- 你是不是用了我上传的资料？

而不是：

- 这是 static 还是 semantic
- 这是 graph_parent 还是 graph_edge
- 这是 memory_only 还是 full_rag

#### 问题 2：数值表达过于工程化
例如 `score`、`semantic_score`、`salience` 的展示方式容易造成：

- 用户误读
- 设计层次混乱
- 过早暴露系统不稳定感

#### 问题 3：调取信息默认插入消息流，干扰回答阅读
回答区本来应该让用户先读“答案”，但现在用户很容易被：

- 本轮上下文
- 记忆数量
- 检索列表
- 知识片段

分散注意力。

### 升级目标

把“记忆调取”从**默认 inline 调试区**升级成**回答相关依据摘要 + 可展开的上下文面板**。

### 建议的信息分层

#### 默认层（用户层）
只显示一枚胶囊：

- `参考了 4 条记忆`
- 或 `参考了你的资料`
- 或 `结合了最近对话`

#### 展开层（理解层）
打开右侧 `上下文来源` tab，分成四组：

1. **一贯信息**
   - 长期有效的偏好 / 档案
2. **最近对话**
   - 本轮或最近几轮上下文
3. **资料 / 知识片段**
   - 上传知识库与关联文件
4. **调试明细**
   - raw scores / strategy / source / counts

这样既保留可解释性，也不让用户直接进入检索内核。

### 建议的显示逻辑

#### 情况 A：`context_level === none`
- 不显示上下文胶囊
- 也不显示 retrieval 卡

#### 情况 B：`context_level === profile_only`
- 可以显示轻量胶囊：`用了你的长期档案`
- 但不展示完整 trace

#### 情况 C：`context_level === memory_only`
- 显示：`参考了 3 条记忆`
- 打开后只看记忆，不展示知识库片段区块

#### 情况 D：`context_level === full_rag`
- 显示：`参考了 3 条记忆和 2 份资料`
- 打开后分区展示：记忆 / 知识库 / 关联文件

### 评分展示建议

#### 默认不展示百分比
默认只展示：
- 高相关
- 中相关
- 低相关

#### 仅调试模式展示 raw score
例如在开发开关打开后：
- semantic score
- salience
- source
- decision confidence

### 推荐新增组件

- `ChatContextChip.tsx`
- `ConversationInspectorRetrievalTab.tsx`
- `RetrievalGroupSection.tsx`
- `RetrievalDebugPanel.tsx`

---

## 4.3 对话部分：品牌感已形成，但主次层级还不够清晰

### 当前实现特点

当前对话页具备：

- 左侧会话栏
- 顶部 workspace header
- 主消息流
- 输入栏 + 工具按钮
- 模式切换
- assistant/source/reasoning/memory metadata 支撑

整体已经是一套完整工作台，不是简陋聊天框。

### 当前问题

#### 问题 1：消息流里有太多“同级卡片”
现在这几种都在消息下面以相近权重出现：

- 回答本身
- reasoning
- retrieval trace
- memory write card
- sources

视觉上像平铺的系统面板，而不是“答案 + 补充信息”。

#### 问题 2：整体浅色系过多，答案与解释之间对比不够
当前紫色氛围统一，但也带来问题：

- 对比度不足
- assistant bubble、reasoning 卡、trace 卡、memory 卡都偏接近
- 用户很难一眼识别“答案主体”

#### 问题 3：输入栏工具过多，默认态太重
当前 `ChatInputBar` 默认显示：

- 自动朗读
- 上传图片
- 拍照
- 搜索
- 深度思考

这对 power user 很强，但对普通用户默认态太复杂。

#### 问题 4：模式切换标签不够自解释
当前 `ChatModePanel` 使用：

- standard
- omni_realtime
- synthetic_realtime

前端文案虽然做了本地化，但仍偏“模型模式命名”，不够“任务模式命名”。

### 升级目标

让主对话区重新回到“答案优先、系统辅助说明其次、调试信息最后”的结构。

### 建议的主对话信息层级

#### 一级信息
- 用户消息
- 助手回答

#### 二级信息（轻量 meta rail）
在每条 assistant message 下方用一排轻量胶囊展示：

- `参考了 4 条记忆`
- `写入了 2 条记忆`
- `有思路摘要`
- `引用 2 个来源`

#### 三级信息
点击对应胶囊后，打开右侧 inspector 查看详细内容。

### 推荐的页面布局

```text
┌──────────────────────────────────────────────────────────────────┐
│ 左侧会话栏              主对话区                      右侧 Inspector │
│                                                                  │
│ 会话列表                用户消息                                  │
│ 项目切换                助手回答                                  │
│ 搜索                    [参考了4条记忆] [写入2条] [有思路摘要]        │
│                        用户消息                                  │
│                        助手回答                                  │
│                                                                  │
│                        输入框 + 工具入口                          │
└──────────────────────────────────────────────────────────────────┘
```

### 推荐的视觉原则

1. **主对话区去调试化**
   - assistant bubble 保持最强视觉聚焦
   - 次级卡片降低对比与面积

2. **品牌紫只用在强调，不用在每一层**
   - 选中态、active chip、发送按钮、关键标签用紫
   - 辅助卡片使用更中性底色

3. **减少玻璃感叠加层数**
   - 当前多个面板都同时使用玻璃 + 渐变 + 阴影
   - 建议主消息流简化，保持更干净的阅读面

4. **减少默认边框噪音**
   - 不要每个块都单独一圈完整边框
   - 可以用浅底、分组间距、标题层次来完成分层

### 输入栏升级建议

#### 当前问题
输入栏默认暴露了太多“高级动作”。

#### 升级方案
改成两段式：

##### 默认显示
- 文本输入框
- 发送按钮
- 工具入口按钮（一个）

##### 工具展开后显示
- 上传图片
- 拍照
- 搜索
- 深度思考
- 自动朗读

这样：

- 普通用户看到的是清爽对话入口
- 高级用户仍然可用全部能力

### 模式切换升级建议

把当前模式改成更可理解的用户视角标签：

| 当前模式 | 用户层名称 | 解释文案 |
|---|---|---|
| standard | 普通对话 | 文本优先，适合稳定问答 |
| omni_realtime | 实时通话 | 端到端实时语音 |
| synthetic_realtime | 合成实时 | 语音识别 + 模型推理 + 语音播报 |

在模式切换附近补一行简要 helper text：

- 是否联网
- 是否允许搜索
- 是否实时语音
- 是否会使用视觉输入

这样比仅显示模式名更清楚。

### 推荐新增组件

- `ChatMessageMetaRail.tsx`
- `ChatToolbarToolsMenu.tsx`
- `ConversationInspector.tsx`
- `ConversationInspectorTabs.tsx`
- `ChatModeExplainPopover.tsx`

---

## 4.4 思考部分：应该保留，但默认要“摘要化”，不要“原样暴露”

### 当前实现特点

当前 `reasoningContent` 会通过 `CollapsibleReasoning` 直接展示文本内容。

这对开发验证很有价值，但面向默认用户态会有两个问题：

1. 抢走答案阅读注意力
2. 容易让人把模型内部工作过程和正式回答混淆

### 当前问题

#### 问题 1：展示的是原始 reasoning，而不是用户需要的“思路”
用户多数时候想知道的是：

- 你是怎么组织答案的？
- 你用了哪些依据？
- 你为什么采用这个解释路径？

而不是逐字逐句阅读模型的内部过程文本。

#### 问题 2：思考块和答案块太近
现在 reasoning 作为回答下方的展开卡存在，容易让用户误以为“这段也要认真读”。

### 升级目标

保留 reasoning 能力，但把默认展示变成**思路摘要**，而不是完整推理原文。

### 推荐展示结构

#### 默认态
assistant message 下方仅显示一枚胶囊：

- `有思路摘要`

#### 展开后先看“摘要层”
例如：

- 识别到这是量子力学推导问题
- 采用非严格证明路线而非公理化证明
- 结合用户已表现出的数学兴趣，补充跨领域连接

#### 更深层（仅在“调试明细”里）
再显示完整 `reasoningContent`。

### 摘要生成方式

#### 方案 A：前端本地摘要（短期可用）
如果后端暂时没有 `reasoning_summary`，前端可以先做轻量规则：

- 取 reasoning 前几句
- 做 2~3 条 bullet 摘要
- 控制在 60~120 字

#### 方案 B：后端提供 `reasoning_summary`（推荐）
新增字段：

```ts
reasoning_summary?: string | null
```

或

```ts
reasoning_summary?: string[]
```

这样前端不需要猜测或裁切原始文本。

### 推荐新增组件

- `ChatThinkingChip.tsx`
- `ConversationInspectorThinkingTab.tsx`
- `ThinkingSummaryCard.tsx`
- `ThinkingDebugPanel.tsx`

---

## 5. 升级后的目标信息架构

## 5.1 主消息流只保留四类东西

### 1）用户消息
保持现在结构即可。

### 2）助手回答
保持回答为主、最强视觉权重。

### 3）轻量 meta rail
assistant message 下只保留一排胶囊：

- 参考了 X 条记忆
- 写入了 X 条记忆
- 有思路摘要
- 引用了 X 个来源

### 4）最少量的直接引用来源
如果回答中有 citation anchor，则 source chip 保留；但不再在默认流里直接展开 retrieval card。

---

## 5.2 右侧 inspector 作为详细信息统一容器

建议右侧 inspector 有四个 tab：

### Tab 1：上下文来源
- 长期档案
- 最近对话
- 知识库片段
- 关联文件
- 调试分数（折叠）

### Tab 2：记忆写入
- 本轮新增 / 合并 / 丢弃条目
- 支持编辑、撤销、调整生命周期

### Tab 3：思路摘要
- 先展示 2~4 条摘要
- 可切换到完整 reasoning

### Tab 4：调试明细
- raw trace
- raw score
- raw source
- metadata json
- 事件时间线

这样：

- 用户层默认只看答案
- 需要可解释性时可深入
- 调试能力不丢

---

## 6. 组件级改造方案（按现有代码文件拆分）

---

## 6.1 `apps/web/app/[locale]/(console)/app/chat/page.tsx`

### 当前职责
- 项目选择
- 会话列表
- URL 同步
- sidebar 管理
- 把 `conversationId/projectId` 传给 `ChatInterface`

### 升级建议

#### 建议增加右侧 inspector 容器状态
在 page 层或 `ChatInterface` 层引入：

```ts
inspectorState: {
  open: boolean;
  tab: "context" | "memory_write" | "thinking" | "debug";
  messageId?: string | null;
}
```

#### 原因
Inspector 是页面级布局问题，不只是消息局部问题。

#### 页面布局升级
从当前：

- 左侧 sidebar
- 主 chat main

升级为：

- 左侧 sidebar
- 主 chat main
- 右侧 inspector（可折叠）

#### 建议新增 props 传递
给 `ChatInterface` 增加：

```ts
onOpenInspector?: (payload: {
  tab: "context" | "memory_write" | "thinking" | "debug";
  messageId: string;
}) => void;
```

---

## 6.2 `apps/web/components/console/ChatInterface.tsx`

### 当前职责
- 加载消息
- 发送消息
- 流式处理
- 语音模式
- 处理 metadata patch
- 维护模式切换状态

### 升级建议

#### 1. 增加“消息级 inspector 触发”能力
当用户点击某条 assistant message 下的 meta chip 时，触发右侧 inspector 打开。

#### 2. 增加 message 级 summary 派生逻辑
在这里做轻量 view-model 转换最合适，因为：

- 数据已经完整拿到
- metadata patch 已合并
- 不需要每个渲染组件重复推导

建议新增派生函数：

```ts
function buildMessageMetaSummary(message: Message) {
  return {
    retrievalSummary: ...,
    memoryWriteSummary: ...,
    thinkingSummary: ...,
    sourceSummary: ...,
  }
}
```

#### 3. 保留 debug ability，但不要默认 inline 渲染
`ChatInterface` 负责决定：

- 默认用户模式：只给 `ChatMessageList` 渲染 lightweight meta rail
- debug / dev 模式：允许显示 verbose metadata

#### 4. 增加 feature flag
建议加：

```ts
const EXPERIMENTAL_CHAT_INSPECTOR = true
const DEFAULT_VERBOSE_TRACE = false
```

这样 rollout 风险更小。

---

## 6.3 `apps/web/components/console/ChatMessageList.tsx`

### 当前职责
- 渲染 assistant / user message
- reasoning 折叠
- retrieval trace
- memory summary card
- source card
- read aloud 按钮

### 它是当前最关键的升级点

#### 当前问题
这一个组件承担了太多“答案之外的信息展示”。

#### 升级原则
把这个组件从“直接展示所有 meta”改为“只展示答案 + meta rail + 简短反馈”。

### 建议保留的内容

保留：
- assistant bubble
- user bubble
- citation anchor
- source chip（轻量）
- read aloud button

### 建议移除默认 inline 展示的内容
默认移除：
- `CollapsibleRetrievalTrace`
- 大 `MemorySummaryCard`
- 原始 `CollapsibleReasoning`

### 替代为新的轻量结构
在 assistant message 下新增：

```tsx
<ChatMessageMetaRail
  message={msg}
  onOpenInspector={...}
/>
```

### 建议拆分组件
把现在这个文件里的一部分内联组件拆出来：

- `AssistantMessageBody.tsx`
- `ChatMessageMetaRail.tsx`
- `ChatSourceChips.tsx`
- `ChatReadAloudButton.tsx`
- `ConversationInspectorContextTab.tsx`
- `ConversationInspectorMemoryWriteTab.tsx`
- `ConversationInspectorThinkingTab.tsx`

### 新的渲染规则建议

#### assistant message bubble 下方顺序
1. source chips（如有）
2. meta rail
3. 不直接渲染 debug 卡

#### 只有在满足以下条件时才显示对应 chip
- 有 `retrievalTrace` 且不是 `none`
- 有 `memories_extracted` 或 `extracted_facts`
- 有 `reasoningContent`
- 有 `sources`

### 记忆写入的默认摘要逻辑建议

```ts
if (message.extracted_facts?.length) {
  chip = `写入了 ${n} 条记忆`
}
```

细节只在 inspector 里看。

### 思考摘要的默认逻辑建议

```ts
if (message.reasoningContent?.trim()) {
  chip = `有思路摘要`
}
```

不要把 reasoning 全文默认挂到消息下面。

---

## 6.4 `apps/web/components/console/ChatInputBar.tsx`

### 当前职责
- 文本输入
- 图片上传
- 拍照
- 自动朗读
- 搜索状态
- 深度思考状态

### 当前问题
默认工具暴露太多。

### 升级方案

#### 方案：两段式工具栏

##### 默认保留
- 文本输入
- 发送按钮
- 工具总入口

##### 工具总入口展开后
- 自动朗读
- 上传图片
- 拍照
- 搜索
- 深度思考

### 结构建议

```tsx
<div className="chat-input-toolbar-group--utilities">
  <ChatToolsDropdown>
    <AutoReadSwitch />
    <ImageUploadAction />
    <ImageCaptureAction />
    <SearchToggle />
    <ThinkingToggle />
  </ChatToolsDropdown>
</div>
```

### 好处

- 减少默认态视觉噪音
- 输入框更像对话入口
- 保留 power user 功能完整性

### 进一步建议

#### 把“深度思考”改成模式说明更明确的标签
例如：
- 深入分析
- 长回答
- 严谨推理

“深度思考”这个词较强，但对用户来说不一定知道会带来什么。

#### 上传图片区分为单个统一入口
现在“上传图片”和“拍照”是两个按钮，建议默认合并成“添加图片”，展开后再选：
- 从文件选择
- 调用摄像头

---

## 6.5 `apps/web/components/console/ChatModePanel.tsx`

### 当前问题
当前已经能切换模式，但模式名偏系统视角。

### 升级建议

#### 1. 模式名保持短、解释文案补齐
按钮文本保持短：
- 普通对话
- 实时语音
- 合成实时

把差异解释放在 hover / popover / helper text 中：
- 是否端到端实时
- 是否支持视觉输入
- 是否由多个子模型拼接

#### 2. 增加状态说明
例如在 mode switcher 旁边加一行次要说明：

- 本轮：文本优先，不联网
- 本轮：实时语音，支持双工
- 本轮：识别 + 推理 + 播报

#### 3. 不建议把 default badge 做得太重
保留 “默认” 标记即可，但不要抢眼。

---

## 6.6 `apps/web/components/console/chat-types.ts`

### 当前优势
已经把 message metadata 拆得比较细，说明数据能力足够。

### 建议增加的前端 view-model 层
不要让 UI 直接面对 raw 数据结构。建议新增：

```ts
export interface MemoryWriteSummaryView {
  total: number;
  longTerm: number;
  shortTerm: number;
  discarded: number;
  items: ...;
}

export interface RetrievalSummaryView {
  memoryCount: number;
  knowledgeCount: number;
  linkedFileCount: number;
  contextLevel: RetrievalContextLevel | null;
}

export interface ThinkingSummaryView {
  hasThinking: boolean;
  summaryLines: string[];
  rawText: string | null;
}
```

### 好处

- UI 不和 raw metadata 深耦合
- 以后后端字段变化，UI 改动面更小
- 可以同时支持“默认态”和“调试态”两种展示

### 推荐补充字段（后端可选）

```ts
reasoning_summary?: string[] | null
memory_write_summary?: {
  total: number;
  permanent: number;
  temporary: number;
  discarded: number;
}
retrieval_summary?: {
  memory_count: number;
  knowledge_count: number;
  linked_file_count: number;
}
```

短期不改接口也能做，长期建议补。

---

## 6.7 `apps/web/styles/globals.css`

### 当前问题
这个文件已经非常大，而且 chat / memory / assistant / dashboard 等样式高度混杂。

### 核心建议

#### 1. 把 chat 页面样式拆分出独立模块
建议拆为：

- `chat-shell.css`
- `chat-message.css`
- `chat-inspector.css`
- `chat-input.css`
- `chat-sidebar.css`

#### 2. 降低默认层级的玻璃感叠加
当前很多区域同时有：
- 透明背景
- 模糊
- 渐变
- 阴影
- 亮边

建议：

- sidebar：允许玻璃感
- workspace header：轻玻璃
- assistant bubble：基本实底 + 弱阴影
- meta chips：轻底色
- inspector：卡片化

#### 3. 建立消息层级 token
建议新增：

```css
--chat-layer-answer-bg
--chat-layer-meta-bg
--chat-layer-debug-bg
--chat-layer-answer-border
--chat-layer-meta-border
--chat-layer-debug-border
```

这样视觉层级会更稳定。

#### 4. 提升阅读区对比度
assistant bubble 的正文对比度可以再提高，避免在浅紫大背景上显得灰。

---

## 7. 建议的最终交互方案（用户视角）

## 7.1 一条 assistant message 的升级后结构

```text
┌──────────────────────────────────────┐
│ 助手回答正文                          │
│                                      │
│ [来源 2] [参考了 4 条记忆] [写入 2 条] │
│ [有思路摘要]                         │
└──────────────────────────────────────┘
```

点击行为：

- 点击 `来源 2`：右侧 inspector 打开“来源与引用”
- 点击 `参考了 4 条记忆`：打开“上下文来源”
- 点击 `写入 2 条`：打开“记忆写入”
- 点击 `有思路摘要`：打开“思路摘要”

---

## 7.2 右侧 inspector 的建议内容

### 上下文来源
- 一贯信息
- 最近对话
- 知识库片段
- 关联文件
- 调试明细（折叠）

### 记忆写入
- 记住了什么
- 为什么记住
- 长期/本轮
- 撤销 / 编辑 / 删除 / 调整生命周期

### 思路摘要
- 三条摘要
- 切换到完整 reasoning

### 调试明细
- strategy
- source
- context_level
- score
- salience
- raw metadata

---

## 8. 分阶段工程落地方案

---

## Phase 1：只改展示层，不改后端协议（最快见效）

### 目标
在不改 API 的情况下，把默认消息流降噪。

### 具体任务

1. 在 `ChatMessageList.tsx` 中移除默认 inline 的：
   - `CollapsibleRetrievalTrace`
   - 大 `MemorySummaryCard`
   - 原始 `CollapsibleReasoning`

2. 新增 `ChatMessageMetaRail`
   - 从已有 `Message` 派生 4 类胶囊

3. 新增右侧 `ConversationInspector`
   - 读取当前 message 的 metadata
   - 分 tab 展示详细内容

4. `ChatInterface.tsx` 增加 inspector 状态

5. `globals.css` 新增 inspector 样式与 meta rail 样式

### 收益
- 用户体验提升最快
- 后端零改动
- 风险低

---

## Phase 2：优化文案、交互与工具栏（产品完成度提升）

### 目标
让页面更像真实产品，而不是内部调试台。

### 具体任务

1. 重写记忆写入文案
2. 工具栏改为折叠式
3. 模式切换增加 helper text
4. 降低默认数值显示
5. 提升 bubble / meta / debug 的视觉层级差异

### 收益
- 页面更适合 demo
- 认知成本下降
- 用户可控感增强

---

## Phase 3：补后端 summary 字段（长期稳定方案）

### 目标
避免前端用规则猜测 summary。

### 建议补充接口

- `reasoning_summary`
- `memory_write_summary`
- `retrieval_summary`

### 收益
- 文案和摘要稳定
- UI 更容易本地化
- 减少前端派生逻辑脆弱性

---

## Phase 4：把调试能力明确切成“用户态 / 开发态”

### 目标
同时满足：
- 用户默认体验
- 团队内部调试
- 演示时可切开发 view

### 做法
增加 dev toggle：

```ts
uiMode = "user" | "debug"
```

#### user mode
- 只看答案、轻量解释、可控动作

#### debug mode
- 看 raw reasoning
- 看 raw retrieval trace
- 看 raw memory triage
- 看 raw score 与事件

---

## 9. 建议新增 / 重构的组件清单

## 9.1 新增组件

- `components/console/chat/ChatMessageMetaRail.tsx`
- `components/console/chat/ConversationInspector.tsx`
- `components/console/chat/ConversationInspectorTabs.tsx`
- `components/console/chat/ConversationInspectorContextTab.tsx`
- `components/console/chat/ConversationInspectorMemoryWriteTab.tsx`
- `components/console/chat/ConversationInspectorThinkingTab.tsx`
- `components/console/chat/ConversationInspectorDebugTab.tsx`
- `components/console/chat/ThinkingSummaryCard.tsx`
- `components/console/chat/ChatToolsDropdown.tsx`

## 9.2 重构组件

- `ChatMessageList.tsx`
  - 从“大而全”改为“消息渲染 + meta rail 触发”
- `ChatInputBar.tsx`
  - 工具栏折叠
- `ChatModePanel.tsx`
  - 增加模式说明
- `ChatInterface.tsx`
  - 承载 inspector 状态与 summary 派生

---

## 10. 建议新增的 view-model 工具函数

建议在 `chat-types.ts` 同级新增：

- `chat-view-models.ts`

包含：

```ts
buildRetrievalSummary(message: Message)
buildMemoryWriteSummary(message: Message)
buildThinkingSummary(message: Message)
getMemoryImportanceLabel(score: number)
getRetrievalDisplayGroups(trace: RetrievalTrace)
```

这样所有 UI 展示逻辑不会散在组件里。

---

## 11. 测试升级建议（基于当前 Playwright 体系）

当前 `console-shell.spec.ts` 已有大量 chat 测试，这非常有利于安全升级。

### 需要保留的测试能力

- source chip 与 citation preview
- memory extraction metadata patch
- reasoning 内容可展示
- mode switch 正常
- 输入区工具正常
- auto read 不受影响

### 新增测试建议

#### 1. meta rail 基础可见性
- 有 retrievalTrace 时显示“参考了 X 条记忆”
- 有 extracted_facts 时显示“写入了 X 条记忆”
- 有 reasoningContent 时显示“有思路摘要”

#### 2. inspector 打开与 tab 切换
- 点击 meta chip 后右侧 inspector 打开
- tab 与 message 绑定正确

#### 3. 默认态不再 inline 暴露完整调试卡
- 消息流中不显示原来的大 retrieval trace 卡
- 消息流中不显示原来的大 memory card
- reasoning 默认只显示摘要 chip

#### 4. 工具栏折叠行为
- 默认只显示工具入口
- 展开后显示上传图片 / 深度思考 / 搜索 / 自动朗读

#### 5. 文案正确性
- 长期档案 / 本轮记住 / 未写入 等文案正确

---

## 12. 视觉与信息设计原则（最终统一规范）

### 原则 1：答案永远是第一层
任何调试和解释信息都不能和答案抢主视觉权重。

### 原则 2：系统信息默认摘要化
系统能解释，不等于系统默认要把所有原始中间态都展示出来。

### 原则 3：调试能力不删除，只换位置
不要为了“更简洁”删掉 retrieval trace / reasoning / memory triage，而是把它们移动到 inspector / debug mode。

### 原则 4：UI 不绑定底层记忆本体
前端不应直接照搬 `temporary/permanent/profile/preference/goal/summary/category-path` 这些底层概念，而应该把它们投影成用户可理解的话语。

### 原则 5：对用户讲“结果”，对开发讲“过程”
用户默认看到：
- 记住了什么
- 用了哪些资料
- 思路是什么

开发默认看到：
- 为什么选中
- 原始打分
- 原始动作
- 原始策略

---

## 13. 最终建议：先做哪三件事最值

### 第一优先级
**把 retrieval trace 和 reasoning 从默认 inline 改成 meta chip + inspector。**

这是收益最大的一步，因为它直接解决主消息流过载问题。

### 第二优先级
**把记忆写入改成“事件摘要 + 可控动作”。**

这样用户才会真正感到“我能管理这套记忆系统”，而不是“系统默默做了某件事”。

### 第三优先级
**重做输入栏默认态，把工具折叠起来。**

这一步能让页面立刻更像产品，而不是调试台。

---

## 14. 一句话结论

当前页面不是做得不够，而是**把太多正确的东西同时放在了默认层**。

正确的升级方向不是删掉可解释性，而是把页面改成：

> **主对话只负责回答；记忆、调取、思路、调试统一进入旁路面板。**

这样你可以同时保留：

- 产品化可用性
- 调试能力
- 可信解释
- 后续可扩展性

而且这套升级路径可以优先在前端完成，不必等待后端大改。


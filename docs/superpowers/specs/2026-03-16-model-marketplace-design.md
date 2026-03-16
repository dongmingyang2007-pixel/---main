# 模型广场 + 智能管线 — 设计规格

**日期**: 2026-03-16
**状态**: 已批准
**范围**: 模型广场 UI + 多模型智能管线架构 + 管线配置

---

## 1. 背景与动机

铭润的 AI 助手平台当前只调用一个全局 LLM 模型（`DASHSCOPE_MODEL` 环境变量），所有用户的所有助手共享同一个模型。同时，作为耳机产品，核心交互是语音，但系统完全没有 ASR（语音识别）和 TTS（语音合成）能力。

本设计引入：
- **模型广场**：用户浏览和选择模型的独立页面
- **智能管线**：每个 AI 助手可独立配置 LLM/ASR/TTS/Vision 四类模型
- **管线编排升级**：根据用户选择的模型能力动态调整调用链路

### 硬件交互链路

```
耳机盒(录音) + 摄像头(拍照) → 蓝牙 → 手机 App → 云端 API → 手机 App → 耳机播放
```

手机 App 作为中转站，负责音频/图像的采集和播放，云端负责所有 AI 处理。

---

## 2. 智能管线架构

### 2.1 四类模型

| 类别 | 代号 | 用途 | 首批支持的模型 |
|------|------|------|--------------|
| 对话推理 | `llm` | 理解 + 思考 + 回复 | qwen3.5-flash, qwen3.5-plus, qwen3-max, deepseek-v3.2, deepseek-r1 |
| 语音识别 | `asr` | 音频 → 文字 | paraformer-v2, sensevoice-v1 |
| 语音合成 | `tts` | 文字 → 音频 | cosyvoice-v1, sambert-v1 |
| 视觉理解 | `vision` | 图片 → 描述 | qwen-vl-plus, qwen-vl-max |

不相关的模型类型（图片生成、视频生成等）在前端过滤掉不展示。

### 2.2 智能调用逻辑

管线不是固定的 4 次调用。根据输入类型和 LLM 能力动态决定：

```
输入进来
  ↓
① 有音频？→ 调 ASR → 得到文字
② 有图片？
   → LLM 支持视觉（如 Qwen3.5-Plus 全模态）？
     → 直接把图片 + 文字一起传给 LLM（跳过 Vision 模型）
   → LLM 不支持视觉（如 DeepSeek-R1）？
     → 调 Vision 模型 → 得到图片描述文字 → 拼入 LLM 输入
  ↓
③ 调 LLM（传入文字 + 记忆 + RAG + 可能带图片）
  ↓
④ 需要语音输出？→ 调 TTS → 返回音频
```

**关键判断点**：LLM 是否支持视觉输入。模型目录中每个 LLM 需标注 `capabilities` 数组（如 `["text", "vision"]`），编排层据此决定是否跳过独立 Vision 模型。

### 2.3 默认管线配置

新建 AI 助手时自动配置默认管线（用户可在画布中更换）：

| 类别 | 默认模型 | 理由 |
|------|---------|------|
| LLM | `qwen3.5-plus` | 性价比最高，支持视觉 |
| ASR | `paraformer-v2` | 中英文实时识别 |
| TTS | `cosyvoice-v1` | 自然度最高 |
| Vision | （由 LLM 处理） | qwen3.5-plus 自带视觉能力 |

---

## 3. 模型广场页面

### 3.1 页面位置

- 导航栏新增 **🏪 模型广场** 图标（位于"对话调试"和"设备"之间）
- 路由：`/app/models`
- 独立的浏览页面 + 嵌入式 Modal 选择器（在创建向导和画布中使用）

### 3.2 页面布局

```
┌──────────────────────────────────────────────────────┐
│  页头: 🏪 模型广场  +  搜索框                         │
├──────────────────────────────────────────────────────┤
│  Tab: [全部] [对话推理] [语音识别] [语音合成] [视觉理解] │
├──────────────────────────────────────────────────────┤
│  模型卡片网格 (3列, 自适应)                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ 图标+名称 │ │ 图标+名称 │ │ 图标+名称 │             │
│  │ 提供商    │ │ 提供商    │ │ 提供商    │             │
│  │ 描述      │ │ 描述      │ │ 描述      │             │
│  │ 能力标签  │ │ 能力标签  │ │ 能力标签  │             │
│  │ 价格+选择 │ │ 价格+选择 │ │ 价格+选择 │             │
│  └──────────┘ └──────────┘ └──────────┘             │
└──────────────────────────────────────────────────────┘
```

### 3.3 模型卡片信息

每张卡片展示：

| 字段 | 说明 | 数据来源 |
|------|------|---------|
| 图标 | 提供商 Logo/首字母 + 品牌色渐变 | 前端硬编码（Qwen=橙, DeepSeek=蓝） |
| 名称 | 模型显示名（如 "Qwen3.5-Plus"） | 百炼 API |
| 提供商 | "千问 · 阿里云" / "DeepSeek" | 百炼 API |
| 描述 | 一句话模型介绍 | 百炼 API |
| 能力标签 | ["文本", "视觉", "1M上下文", "联网搜索"] | 百炼 API capabilities 字段 |
| 价格 | 输入/输出价格 (¥/百万token) | 百炼 API |
| 类别 | llm / asr / tts / vision | 百炼 API 模型类型映射 |

### 3.4 模型详情页

点击卡片进入详情页 `/app/models/[model_id]`，展示：

- 模型完整介绍
- 能力列表：输入模态、输出模态、Function Calling、联网搜索、结构化输出、缓存支持
- 完整价格表：输入/输出/Batch/缓存定价
- 上下文窗口大小
- "选择此模型"按钮（选择后跳转回来源页面）

### 3.5 Modal 选择器

在创建向导和画布"更换模型"中弹出的轻量选择器：

- 按当前类别过滤（如点击 LLM 的"更换"只显示 LLM 类模型）
- 简化卡片（名称 + 一句话 + 价格 + 选择按钮）
- 底部链接"在模型广场查看详情 →"

---

## 4. 管线配置 UI

### 4.1 画布工作台升级

AI 助手详情页的画布工作台（⚙️ 配置 Tab），从原来的 2×2 变为 3×2 或自适应布局，新增"管线配置"区块：

```
┌────────────────────┬────────────────────┐
│   基座模型 (LLM)    │   知识库            │
│   Qwen3.5-Plus     │   资料列表 + 上传    │
│   [更换]            │   [管理]            │
├────────────────────┼────────────────────┤
│   人格设定          │   技能              │
│   描述 + 标签编辑   │   技能列表 + 添加    │
│   [编辑]            │   [添加]            │
├────────────────────┼────────────────────┤
│   语音识别 (ASR)    │   语音合成 (TTS)     │
│   Paraformer-v2    │   CosyVoice         │
│   [更换]            │   [更换]            │
└────────────────────┴────────────────────┘
```

视觉理解 (Vision) 不单独展示——如果 LLM 支持视觉，显示"由 LLM 处理"提示；如果不支持，自动显示 Vision 模型选择卡片。

### 4.2 创建向导更新

向导第一步"选择基座模型"从硬编码三档改为：
- 打开 Modal 模型选择器
- 默认按"推荐"排序显示 LLM 列表
- 选择后自动配置默认 ASR 和 TTS
- 高级选项：展开可分别配置 ASR/TTS

---

## 5. 后端架构

### 5.1 模型目录 API

从百炼 DashScope API 拉取模型列表，Redis 缓存 1 小时。

**百炼模型列表 API**：`GET https://dashscope.aliyuncs.com/compatible-mode/v1/models`（OpenAI 兼容格式）

如果百炼不提供 list models API，则使用**本地模型注册表**：在数据库中维护一个 `model_catalog` 表，手动录入支持的模型信息。首批录入 Qwen + DeepSeek 的模型。

#### 新增数据库表

**`model_catalog`** — 模型目录（如果百炼 API 不提供列表功能则用此表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36), PK | 主键 |
| model_id | VARCHAR(100), UNIQUE | 百炼模型 ID（如 `qwen3.5-plus`） |
| display_name | VARCHAR(255) | 显示名称 |
| provider | VARCHAR(100) | 提供商（"qwen" / "deepseek"） |
| category | VARCHAR(20) | `llm` / `asr` / `tts` / `vision` |
| description | TEXT | 模型描述 |
| capabilities | JSON | 能力列表，如 `["text", "vision", "function_calling"]` |
| context_window | INTEGER | 上下文窗口大小 (tokens) |
| max_output | INTEGER | 最大输出长度 (tokens) |
| input_price | FLOAT | 输入价格 (¥/千tokens) |
| output_price | FLOAT | 输出价格 (¥/千tokens) |
| is_active | BOOLEAN, DEFAULT true | 是否在广场展示 |
| sort_order | INTEGER, DEFAULT 0 | 排序权重（越小越靠前） |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

**`pipeline_configs`** — AI 助手的管线配置

| 字段 | 类型 | 说明 |
|------|------|------|
| id | VARCHAR(36), PK | 主键 |
| project_id | VARCHAR(36), FK → projects, UNIQUE(project_id, model_type) | 所属 AI 助手 |
| model_type | VARCHAR(20) | `llm` / `asr` / `tts` / `vision` |
| model_id | VARCHAR(100) | 百炼模型 ID（如 `qwen3.5-plus`） |
| config_json | JSON | 模型特定配置（temperature、voice_id 等） |
| created_at | TIMESTAMPTZ | 创建时间 |
| updated_at | TIMESTAMPTZ | 更新时间 |

唯一约束：`(project_id, model_type)` — 每个助手每类模型只有一个配置

### 5.2 新增 API 端点

#### 模型目录 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/models/catalog` | 获取模型目录列表。支持 `?category=llm` 过滤 |
| GET | `/api/v1/models/catalog/{model_id}` | 获取单个模型详情 |

#### 管线配置 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/pipeline?project_id={id}` | 获取 AI 助手的完整管线配置（4 条记录） |
| PUT | `/api/v1/pipeline` | 更新管线中某类模型。Body: `{project_id, model_type, model_id, config_json?}` |

### 5.3 推理编排层升级

当前 `orchestrator.py` 硬编码使用 `settings.dashscope_model`。升级为：

1. 从 `pipeline_configs` 表读取该助手的 LLM 模型 ID
2. 从 `model_catalog` 表读取该模型的 capabilities
3. 根据 capabilities 决定是否需要单独调用 Vision 模型
4. 调用 DashScope API 时使用助手配置的模型 ID，而非全局默认

```python
async def orchestrate_inference(db, *, project_id, ...):
    # 读取管线配置
    llm_config = get_pipeline_config(db, project_id, "llm")
    llm_model_id = llm_config.model_id if llm_config else settings.dashscope_model

    # 读取模型能力
    model_info = get_model_catalog(db, llm_model_id)
    llm_supports_vision = model_info and "vision" in (model_info.capabilities or [])

    # 如果有图片且 LLM 不支持视觉，先调 Vision 模型
    if has_image and not llm_supports_vision:
        vision_config = get_pipeline_config(db, project_id, "vision")
        image_description = await call_vision_model(vision_config.model_id, image)
        # 将描述拼入 LLM 输入
    elif has_image and llm_supports_vision:
        # 直接把图片传给 LLM（多模态调用）
        pass

    # 调用 LLM（使用助手配置的模型）
    response = await chat_completion(messages, model=llm_model_id)
```

### 5.4 ASR/TTS API 客户端

新增两个服务模块调用百炼的语音 API：

**`apps/api/app/services/asr_client.py`** — 语音识别

```python
async def transcribe_audio(audio_bytes: bytes, model: str = "paraformer-v2") -> str:
    """音频 → 文字"""
```

**`apps/api/app/services/tts_client.py`** — 语音合成

```python
async def synthesize_speech(text: str, model: str = "cosyvoice-v1", voice: str = "default") -> bytes:
    """文字 → 音频"""
```

这些客户端在 Phase 2 实现。Phase 1 只做模型广场 UI + 管线配置存储。

### 5.5 手机 App API 端点（Phase 2）

为手机 App 提供的 API，处理音频/图片输入和语音输出：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/chat/conversations/{id}/voice` | 接收音频 → ASR → LLM → TTS → 返回音频 |
| POST | `/api/v1/chat/conversations/{id}/image` | 接收图片 + 可选音频 → Vision/LLM → TTS → 返回音频 |

这些端点在 Phase 2 实现。

---

## 6. 首批模型种子数据

### LLM 模型

| model_id | display_name | provider | capabilities | context_window | input_price | output_price |
|----------|-------------|----------|-------------|----------------|-------------|--------------|
| qwen3.5-flash | Qwen3.5-Flash | qwen | ["text", "vision", "function_calling"] | 1000000 | 0.0003 | 0.0018 |
| qwen3.5-plus | Qwen3.5-Plus | qwen | ["text", "vision", "function_calling", "web_search"] | 1000000 | 0.0008 | 0.0048 |
| qwen3-max | Qwen3-Max | qwen | ["text", "vision", "function_calling", "web_search"] | 252000 | 0.0025 | 0.01 |
| deepseek-v3.2 | DeepSeek-V3.2 | deepseek | ["text", "function_calling", "web_search"] | 131072 | 0.001 | 0.005 |
| deepseek-r1 | DeepSeek-R1 | deepseek | ["text", "reasoning_chain"] | 131072 | 0.002 | 0.01 |

### ASR 模型

| model_id | display_name | provider | capabilities | input_price |
|----------|-------------|----------|-------------|-------------|
| paraformer-v2 | Paraformer-v2 | qwen | ["chinese", "english", "realtime"] | 0.0 (免费额度) |
| sensevoice-v1 | SenseVoice | qwen | ["chinese", "english", "emotion"] | 0.0 |

### TTS 模型

| model_id | display_name | provider | capabilities | output_price |
|----------|-------------|----------|-------------|--------------|
| cosyvoice-v1 | CosyVoice | qwen | ["multi_voice", "emotion", "natural"] | 按字符计费 |
| sambert-v1 | Sambert | qwen | ["standard", "fast"] | 按字符计费 |

### Vision 模型（仅当 LLM 不支持视觉时需要）

| model_id | display_name | provider | capabilities | input_price |
|----------|-------------|----------|-------------|-------------|
| qwen-vl-plus | Qwen-VL-Plus | qwen | ["image", "ocr", "video"] | 0.001 |
| qwen-vl-max | Qwen-VL-Max | qwen | ["image", "ocr", "video", "reasoning"] | 0.003 |

---

## 7. 前端变更

### 7.1 新增页面

| 页面 | 路由 | 说明 |
|------|------|------|
| 模型广场 | `/app/models` | 卡片网格 + 分类 Tab + 搜索 |
| 模型详情 | `/app/models/[model_id]` | 模型完整信息 + "选择此模型"按钮 |

### 7.2 新增组件

| 组件 | 说明 |
|------|------|
| `ModelCard` | 广场中的模型卡片 |
| `ModelDetailPage` | 模型详情页 |
| `ModelPickerModal` | 嵌入式模型选择器（在向导和画布中使用） |
| `PipelineConfig` | 画布工作台中的管线配置区块 |

### 7.3 修改页面

| 页面 | 变更 |
|------|------|
| 创建向导 (StepModel) | 从三档硬编码改为 ModelPickerModal |
| 画布工作台 (CanvasWorkbench) | 新增 ASR/TTS 管线配置区块 |
| 导航 (IconBar) | 新增模型广场图标 |

### 7.4 i18n

新增 `console-models.json`（zh + en），包含：模型广场、模型详情、管线配置相关的所有翻译 key。

---

## 8. 实施阶段

| 阶段 | 内容 | 交付物 |
|------|------|--------|
| **Phase 1** | model_catalog 表 + pipeline_configs 表 + 模型目录 API + 管线配置 API + 模型广场页面 + 模型详情页 + ModelPickerModal + 向导/画布改造 + 种子数据迁移 | 用户可浏览模型、为助手配置管线、推理按配置选模型 |
| **Phase 2** | ASR/TTS 客户端 + 手机 App 语音端点 + 智能管线编排升级（Vision 自动判断） | 完整语音交互链路可用 |

---

## 9. 对现有系统的影响

### 不变

- 记忆系统（memories, embeddings, graph）完全不变
- 对话系统（conversations, messages）不变
- 文件上传、数据集、S3 存储不变
- 认证系统不变

### 变更

| 变更 | 说明 |
|------|------|
| `orchestrator.py` | 从硬编码 `settings.dashscope_model` 改为从 `pipeline_configs` 读取 |
| `dashscope_client.py` | `chat_completion` 函数已支持 `model` 参数，无需改动 |
| 创建向导 StepModel | 从三档改为 Modal 选择器 |
| 画布工作台 | 新增 ASR/TTS 配置区块 |
| 导航 IconBar | 新增模型广场入口 |
| `console.json` i18n | 新增 nav.models key |

---

## 10. 成功标准

1. 用户可在模型广场浏览所有可用模型（按四类分 Tab）
2. 每个 AI 助手可独立配置 LLM/ASR/TTS/Vision 模型
3. 推理编排层按助手配置选择模型（而非全局默认）
4. 创建向导不再硬编码三档，从真实模型列表选择
5. 中英文完整支持

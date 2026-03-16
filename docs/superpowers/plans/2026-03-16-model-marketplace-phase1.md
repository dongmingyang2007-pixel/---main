# 模型广场 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build model marketplace UI, per-assistant pipeline configuration, seed model catalog data, and upgrade inference orchestrator to use per-assistant model selection.

**Architecture:** Local `model_catalog` table stores model metadata (Qwen + DeepSeek seed data). `pipeline_configs` table stores each AI assistant's model choices for LLM/ASR/TTS/Vision. Model marketplace page shows filterable card grid. Modal picker embedded in wizard and canvas. Orchestrator reads pipeline config instead of global default.

**Tech Stack:** PostgreSQL, SQLAlchemy 2.0, Alembic, FastAPI, Next.js 16, TailwindCSS + CSS variables

**Spec:** `docs/superpowers/specs/2026-03-16-model-marketplace-design.md`

---

## Chunk 1: Backend — Database, API, Orchestrator Upgrade

### Task 1: Create Migration for model_catalog + pipeline_configs

**Files:**
- Create: `apps/api/alembic/versions/202603160002_model_marketplace.py`

- [ ] **Step 1: Create migration**

```python
"""Add model_catalog and pipeline_configs tables

Revision ID: 202603160002
Revises: 202603160001
Create Date: 2026-03-16
"""

from alembic import op

revision = "202603160002"
down_revision = "202603160001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE model_catalog (
            id              VARCHAR(36) PRIMARY KEY,
            model_id        VARCHAR(100) NOT NULL UNIQUE,
            display_name    VARCHAR(255) NOT NULL,
            provider        VARCHAR(100) NOT NULL,
            category        VARCHAR(20) NOT NULL,
            description     TEXT NOT NULL DEFAULT '',
            capabilities    JSONB NOT NULL DEFAULT '[]',
            context_window  INTEGER NOT NULL DEFAULT 0,
            max_output      INTEGER NOT NULL DEFAULT 0,
            input_price     DOUBLE PRECISION NOT NULL DEFAULT 0,
            output_price    DOUBLE PRECISION NOT NULL DEFAULT 0,
            is_active       BOOLEAN NOT NULL DEFAULT true,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_model_catalog_category ON model_catalog(category);
        CREATE INDEX idx_model_catalog_provider ON model_catalog(provider);
    """)

    op.execute("""
        CREATE TABLE pipeline_configs (
            id          VARCHAR(36) PRIMARY KEY,
            project_id  VARCHAR(36) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            model_type  VARCHAR(20) NOT NULL,
            model_id    VARCHAR(100) NOT NULL,
            config_json JSONB NOT NULL DEFAULT '{}',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_pipeline_project_type UNIQUE (project_id, model_type)
        );
        CREATE INDEX idx_pipeline_project ON pipeline_configs(project_id);
    """)

    # Seed model catalog data
    op.execute("""
        INSERT INTO model_catalog (id, model_id, display_name, provider, category, description, capabilities, context_window, max_output, input_price, output_price, sort_order) VALUES
        -- LLM models
        ('mc-qwen35-flash', 'qwen3.5-flash', 'Qwen3.5-Flash', 'qwen', 'llm', '响应极快，支持视觉理解和文本生成，适合日常对话和简单任务', '["text","vision","function_calling"]', 1000000, 8192, 0.0003, 0.0018, 10),
        ('mc-qwen35-plus', 'qwen3.5-plus', 'Qwen3.5-Plus', 'qwen', 'llm', '性能均衡，支持 1M 上下文、视觉理解、联网搜索，适合专业辅助', '["text","vision","function_calling","web_search"]', 1000000, 8192, 0.0008, 0.0048, 20),
        ('mc-qwen3-max', 'qwen3-max', 'Qwen3-Max', 'qwen', 'llm', '最强千问模型，深度推理与分析能力，适合复杂专业任务', '["text","vision","function_calling","web_search"]', 252000, 8192, 0.0025, 0.01, 30),
        ('mc-ds-v32', 'deepseek-v3.2', 'DeepSeek-V3.2', 'deepseek', 'llm', '685B 参数，支持 Function Calling 和联网搜索，综合能力强', '["text","function_calling","web_search"]', 131072, 65536, 0.001, 0.005, 40),
        ('mc-ds-r1', 'deepseek-r1', 'DeepSeek-R1', 'deepseek', 'llm', '深度推理模型，擅长数学、逻辑和复杂问题分析', '["text","reasoning_chain"]', 131072, 16384, 0.002, 0.01, 50),
        -- ASR models
        ('mc-paraformer', 'paraformer-v2', 'Paraformer-v2', 'qwen', 'asr', '高精度实时语音识别，支持中英文', '["chinese","english","realtime"]', 0, 0, 0, 0, 10),
        ('mc-sensevoice', 'sensevoice-v1', 'SenseVoice', 'qwen', 'asr', '多语言语音识别，支持情感检测', '["chinese","english","emotion"]', 0, 0, 0, 0, 20),
        -- TTS models
        ('mc-cosyvoice', 'cosyvoice-v1', 'CosyVoice', 'qwen', 'tts', '高自然度语音合成，支持多种音色和情感控制', '["multi_voice","emotion","natural"]', 0, 0, 0, 0.01, 10),
        ('mc-sambert', 'sambert-v1', 'Sambert', 'qwen', 'tts', '标准语音合成，响应速度快', '["standard","fast"]', 0, 0, 0, 0.005, 20),
        -- Vision models
        ('mc-qwen-vl-plus', 'qwen-vl-plus', 'Qwen-VL-Plus', 'qwen', 'vision', '图像理解、OCR 识别、视频理解', '["image","ocr","video"]', 0, 0, 0.001, 0.002, 10),
        ('mc-qwen-vl-max', 'qwen-vl-max', 'Qwen-VL-Max', 'qwen', 'vision', '最强视觉模型，支持复杂图像推理', '["image","ocr","video","reasoning"]', 0, 0, 0.003, 0.006, 20);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS pipeline_configs;")
    op.execute("DROP TABLE IF EXISTS model_catalog;")
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/alembic/versions/202603160002_model_marketplace.py
git commit -m "feat(api): add model_catalog and pipeline_configs tables with seed data"
```

---

### Task 2: Create ORM Models + Schemas

**Files:**
- Modify: `apps/api/app/models/entities.py` (append ModelCatalog, PipelineConfig)
- Create: `apps/api/app/schemas/model_catalog.py`
- Create: `apps/api/app/schemas/pipeline.py`

- [ ] **Step 1: Add ORM models to entities.py**

```python
class ModelCatalog(UUIDPrimaryKeyMixin, TimestampMixin, UpdatedAtMixin, Base):
    __tablename__ = "model_catalog"
    model_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    provider: Mapped[str] = mapped_column(String(100), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    capabilities: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    context_window: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_output: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    input_price: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    output_price: Mapped[float] = mapped_column(Float, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

class PipelineConfig(UUIDPrimaryKeyMixin, TimestampMixin, UpdatedAtMixin, Base):
    __tablename__ = "pipeline_configs"
    __table_args__ = (UniqueConstraint("project_id", "model_type", name="uq_pipeline_project_type"),)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    model_type: Mapped[str] = mapped_column(String(20), nullable=False)
    model_id: Mapped[str] = mapped_column(String(100), nullable=False)
    config_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
```

- [ ] **Step 2: Create Pydantic schemas**

`model_catalog.py`: ModelCatalogOut (all fields), ModelCatalogList
`pipeline.py`: PipelineConfigOut, PipelineConfigUpdate (project_id, model_type, model_id, config_json?), PipelineOut (list of 4 configs)

- [ ] **Step 3: Commit**

```bash
git add apps/api/app/models/entities.py apps/api/app/schemas/model_catalog.py apps/api/app/schemas/pipeline.py
git commit -m "feat(api): add ORM models and schemas for model catalog and pipeline"
```

---

### Task 3: Create Model Catalog + Pipeline API Routers

**Files:**
- Create: `apps/api/app/routers/model_catalog.py`
- Create: `apps/api/app/routers/pipeline.py`
- Modify: `apps/api/app/main.py` (register routers)

- [ ] **Step 1: Create model catalog router**

Endpoints:
- `GET /api/v1/models/catalog` — list all active models, optional `?category=llm` filter. Sorted by sort_order.
- `GET /api/v1/models/catalog/{model_id}` — single model detail by model_id (not UUID).

No auth required for catalog listing (public info).

- [ ] **Step 2: Create pipeline router**

Endpoints:
- `GET /api/v1/pipeline?project_id={id}` — get all pipeline configs for an assistant. Returns array of 4 items (or fewer if not all configured).
- `PATCH /api/v1/pipeline` — update one model type. Body: `{project_id, model_type, model_id, config_json?}`. Upsert logic (INSERT ON CONFLICT UPDATE). Requires auth + CSRF.

When selecting a non-vision LLM and no Vision model is configured, auto-create a Vision pipeline config with default `qwen-vl-plus`.

- [ ] **Step 3: Register routers in main.py**

- [ ] **Step 4: Commit**

```bash
git add apps/api/app/routers/model_catalog.py apps/api/app/routers/pipeline.py apps/api/app/main.py
git commit -m "feat(api): add model catalog and pipeline configuration API endpoints"
```

---

### Task 4: Upgrade Orchestrator to Use Pipeline Config

**Files:**
- Modify: `apps/api/app/services/orchestrator.py`

- [ ] **Step 1: Update orchestrate_inference to read pipeline config**

Replace `settings.dashscope_model` with per-assistant config:

```python
from app.models.entities import PipelineConfig, ModelCatalog

# Read LLM config for this assistant
llm_config = db.query(PipelineConfig).filter(
    PipelineConfig.project_id == project_id,
    PipelineConfig.model_type == "llm",
).first()
llm_model_id = llm_config.model_id if llm_config else settings.dashscope_model

# Check if LLM supports vision
model_info = db.query(ModelCatalog).filter(
    ModelCatalog.model_id == llm_model_id,
).first()
llm_supports_vision = model_info and "vision" in (model_info.capabilities or [])
```

Pass `model=llm_model_id` to `chat_completion()` call.

- [ ] **Step 2: Commit**

```bash
git add apps/api/app/services/orchestrator.py
git commit -m "feat(api): orchestrator reads per-assistant pipeline config for model selection"
```

---

## Chunk 2: Frontend — Model Marketplace + Pipeline UI

### Task 5: Add Navigation + i18n + Route

**Files:**
- Modify: `apps/web/components/console/IconBar.tsx` (add models icon)
- Create: `apps/web/messages/zh/console-models-v2.json`
- Create: `apps/web/messages/en/console-models-v2.json`
- Modify: `apps/web/i18n/request.ts` (register namespace)
- Modify: `apps/web/messages/zh/console.json` (add nav.models key)
- Modify: `apps/web/messages/en/console.json`

- [ ] **Step 1: Add models icon to IconBar**

Add to NAV_ITEMS after chat, before devices:
```typescript
{ key: "models", href: "/app/models", icon: icons.models, position: "top" },
```

Add models icon SVG (store/shop icon).

- [ ] **Step 2: Create i18n messages**

`console-models-v2.json` (zh):
```json
{
  "title": "模型广场",
  "description": "浏览和选择 AI 模型",
  "search": "搜索模型名称…",
  "all": "全部",
  "llm": "对话推理",
  "asr": "语音识别",
  "tts": "语音合成",
  "vision": "视觉理解",
  "select": "选择",
  "selected": "已选择",
  "inputPrice": "输入",
  "outputPrice": "输出",
  "perMToken": "/百万token",
  "contextWindow": "上下文",
  "tokens": "tokens",
  "capabilities": "能力",
  "provider": "提供商",
  "detail": "查看详情",
  "selectModel": "选择此模型",
  "backToMarketplace": "返回模型广场",
  "pipeline": "管线配置",
  "pipelineLlm": "对话推理 (LLM)",
  "pipelineAsr": "语音识别 (ASR)",
  "pipelineTts": "语音合成 (TTS)",
  "pipelineVision": "视觉理解 (Vision)",
  "pipelineVisionAuto": "由 LLM 处理",
  "change": "更换",
  "pickerTitle": "选择模型",
  "pickerViewAll": "在模型广场查看详情 →",
  "noModels": "暂无可用模型",
  "free": "免费"
}
```

English version with corresponding translations.

- [ ] **Step 3: Register namespace + add nav key**

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/console/IconBar.tsx apps/web/messages/ apps/web/i18n/request.ts
git commit -m "feat(web): add model marketplace navigation and i18n"
```

---

### Task 6: Build Model Marketplace Page

**Files:**
- Create: `apps/web/app/[locale]/(console)/app/models/page.tsx`
- Create: `apps/web/app/[locale]/(console)/app/models/[modelId]/page.tsx`
- Modify: `apps/web/styles/globals.css` (add marketplace CSS)

- [ ] **Step 1: Create marketplace list page**

`/app/models/page.tsx`:
- Fetch models from `GET /api/v1/models/catalog`
- Tab bar: 全部 / 对话推理 / 语音识别 / 语音合成 / 视觉理解
- Search input (client-side filter by name)
- Card grid (3 columns, responsive). Each card shows: provider icon+color, name, provider, description, capability tags, price, "选择" button
- "选择" button → navigates to assistant config or stores selection in context

Card design following warm cream theme:
- Background: var(--bg-card), border: var(--border), radius: var(--radius-card)
- Provider icon: 36px square, gradient background (Qwen=#c8734a→#e8925a, DeepSeek=#3a6a9a→#4a8ac8)
- Capability tags: small pills with bg-base color
- Price: text-secondary, bottom-right

- [ ] **Step 2: Create model detail page**

`/app/models/[modelId]/page.tsx`:
- Fetch model from `GET /api/v1/models/catalog/{modelId}`
- Full info: name, provider, description, capabilities grid (checkmarks), pricing table, context window
- "选择此模型" primary button

- [ ] **Step 3: Add CSS**

`.marketplace-*` classes: grid, card, tabs, search, detail page styles.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/[locale]/(console)/app/models/" apps/web/styles/globals.css
git commit -m "feat(web): add model marketplace page with card grid and detail view"
```

---

### Task 7: Build Model Picker Modal

**Files:**
- Create: `apps/web/components/console/ModelPickerModal.tsx`

- [ ] **Step 1: Create modal component**

Props:
```typescript
interface ModelPickerModalProps {
  open: boolean;
  onClose: () => void;
  category: "llm" | "asr" | "tts" | "vision";
  currentModelId?: string;
  onSelect: (modelId: string) => void;
}
```

Fetches models filtered by category. Simplified card layout (name + one-line desc + price + select button). "在模型广场查看详情 →" link at bottom.

Uses Dialog/Modal from shadcn/ui or custom overlay.

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/console/ModelPickerModal.tsx
git commit -m "feat(web): add model picker modal for inline model selection"
```

---

### Task 8: Build Pipeline Config UI in Canvas

**Files:**
- Create: `apps/web/components/console/canvas/PipelineCard.tsx`
- Modify: `apps/web/components/console/canvas/CanvasWorkbench.tsx` (add pipeline cards)
- Create: `apps/web/hooks/usePipelineConfig.ts`

- [ ] **Step 1: Create usePipelineConfig hook**

```typescript
export function usePipelineConfig(projectId: string) {
  // Fetch pipeline configs from GET /api/v1/pipeline?project_id={id}
  // Return: configs array, updateConfig function (PATCH /api/v1/pipeline)
  // updateConfig triggers refetch after success
}
```

- [ ] **Step 2: Create PipelineCard component**

Shows one model type config: label (LLM/ASR/TTS/Vision), current model name + provider, price, "更换" button that opens ModelPickerModal.

For Vision: if LLM supports vision, show "由 LLM 处理" in muted text, disable "更换" button.

- [ ] **Step 3: Add pipeline cards to CanvasWorkbench**

Add two PipelineCards (ASR + TTS) below the existing 2×2 grid. The LLM card already exists as ModelCard — update it to use the pipeline config and ModelPickerModal instead of hardcoded display.

Layout becomes:
```
[Model(LLM)] [Knowledge]
[Personality] [Skills]
[ASR]         [TTS]
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/hooks/usePipelineConfig.ts apps/web/components/console/canvas/PipelineCard.tsx apps/web/components/console/canvas/CanvasWorkbench.tsx
git commit -m "feat(web): add pipeline configuration cards to canvas workbench"
```

---

### Task 9: Update Creation Wizard

**Files:**
- Modify: `apps/web/components/console/wizard/StepModel.tsx`

- [ ] **Step 1: Replace hardcoded tiers with ModelPickerModal**

Remove the three hardcoded model cards (轻/中/强). Instead:
- Show a "选择对话模型" button that opens ModelPickerModal with category="llm"
- After selection, show the chosen model card with name + description + price
- Below: collapsible "高级选项" that shows ASR and TTS model selection (default pre-selected)
- On wizard completion, create pipeline_configs entries for the new project

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/console/wizard/StepModel.tsx
git commit -m "feat(web): wizard model step now uses real model picker from catalog"
```

---

### Task 10: Build & Verify

- [ ] **Step 1: TypeScript compilation**

```bash
cd /Users/dog/Desktop/铭润/apps/web && npx tsc --noEmit
```

- [ ] **Step 2: Next.js build**

```bash
cd /Users/dog/Desktop/铭润/apps/web && npm run build
```

- [ ] **Step 3: Python imports**

```bash
cd /Users/dog/Desktop/铭润/apps/api && python3 -c "
from app.models.entities import ModelCatalog, PipelineConfig
from app.routers.model_catalog import router
from app.routers.pipeline import router
print('All model marketplace imports OK')
"
```

- [ ] **Step 4: Commit fixes if any**

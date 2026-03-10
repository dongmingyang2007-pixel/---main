# QIHANG Website v0.2 — Codex 开发任务书（可直接开工）

> 适用对象：Codex / 工程团队  
> 目标：实现一个可上线的网站（公共官网 + 登录控制台 Personal AI Studio），并跑通 **Demo 体验** 与 **训练-评测-发布** 闭环。  
> 重要约束：v0.1 允许使用 **Mock AI**（返回固定结构的假结果）用于联调与验收；但 **所有 API 契约 / DB 表结构 / 对象存储路径规范必须稳定**，以便后续无痛替换为自研推理与训练服务。

---

## 0. 非目标（v0.1 明确不做）

- 不做硬件设备绑定与固件升级（仅保留 `/app/devices` 占位页 + DB 预留表）。
- 不做支付/订阅计费闭环（仅保留 `/pricing` 与 `/app/billing` 占位页 + DB 预留字段）。
- 不做真实 GPU 训练/推理（允许 mock；但必须保留对接点）。
- 不做实时 3D 重建（可做“上传→异步任务→3D Viewer 展示”的演示版；无则跳过）。

---

## 1. 一次性技术选型（锁定，不要改来改去）

### 1.1 前端（apps/web）
- Next.js 14+（App Router）+ TypeScript（strict=true）
- TailwindCSS
- UI：shadcn/ui（或等价组件库，但必须覆盖：Table、Dialog、Tabs、Toast、Form、Dropdown）
- 数据请求：TanStack Query（推荐）或 SWR（二选一，不要混用）
- 表单：react-hook-form + zod
- 图表：recharts（或 chart.js 二选一）
- 代码质量：eslint + prettier

### 1.2 后端 API（apps/api）
- Python 3.11+
- FastAPI + Pydantic v2
- ORM：SQLAlchemy 2.0 + Alembic（迁移必须可跑）
- Auth：JWT（access）+ refresh（简化允许：只做 access + 重新登录）
  - access token 通过 **HttpOnly Cookie** 存储
- Background Jobs：Celery + Redis
- DB：PostgreSQL 15+
- Object Storage：S3 兼容（本地 MinIO；线上可 AWS S3 / Cloudflare R2）

### 1.3 Worker（apps/worker）
- Python 3.11+ + Celery worker
- 与 API 共享同一套 models/services（建议复用 apps/api 里的代码）

### 1.4 本地开发形态
- 必须提供 `docker-compose.yml` 一键启动：postgres、redis、minio、api、worker（web 可本地跑或 docker 跑）
- 必须提供 `.env.example`（web 与 api 分开）

---

## 2. Monorepo 目录结构（必须按此创建）

```
repo/
  apps/
    web/
      app/
        (public)/
        app/                # /app 控制台
        api/                # 可选：Next.js BFF，不建议 v0.1 做太多逻辑
      components/
      lib/
      public/
      styles/
      package.json
      tsconfig.json
      next.config.js
    api/
      app/
        main.py
        core/               # config, security, deps
        db/                 # engine/session, base
        models/             # SQLAlchemy models
        schemas/            # Pydantic schemas
        routers/            # FastAPI routers
        services/           # business logic
        tasks/              # Celery tasks
      alembic/
      alembic.ini
      pyproject.toml
    worker/
      worker.py             # Celery app entry
      pyproject.toml
  docker/
    docker-compose.yml
  scripts/
    dev.sh
  README.md
  .env.example
```

---

## 3. 命名与规范（强制）

### 3.1 API 风格
- 路径：`/api/v1/...`
- 字段命名：snake_case
- 时间：ISO8601（UTC，`timestamptz`）
- ID：UUID v4（字符串）

### 3.2 统一错误响应格式
所有非 2xx 必须返回：

```json
{
  "error": {
    "code": "string_enum",
    "message": "human_readable",
    "details": { "optional": "object" },
    "request_id": "uuid"
  }
}
```

### 3.3 审计日志（Audit Log）
所有关键动作必须写 `audit_logs`：
- 创建/删除 project、dataset、dataset_version
- 上传样本（记录批次）
- 发起训练、训练结束
- 发布/回滚模型 alias
- 创建/撤销 API key
- 删除数据/账户

---

## 4. 环境变量（必须提供 .env.example）

### 4.1 web（apps/web/.env.local）
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`
- `NEXT_PUBLIC_APP_NAME=QIHANG`
- `NEXT_PUBLIC_DEMO_MAX_IMAGE_MB=10`

### 4.2 api（apps/api/.env）
- `ENV=local`
- `DATABASE_URL=postgresql+psycopg://postgres:postgres@postgres:5432/qihang`
- `JWT_SECRET=CHANGE_ME`
- `JWT_EXPIRE_MINUTES=60`
- `JWT_REFRESH_EXPIRE_DAYS=14`
- `COOKIE_DOMAIN=localhost`
- `COOKIE_SECURE=false`
- `REDIS_URL=redis://redis:6379/0`
- `S3_ENDPOINT=http://minio:9000`
- `S3_ACCESS_KEY=minioadmin`
- `S3_SECRET_KEY=minioadmin`
- `S3_BUCKET=qihang`
- `S3_REGION=us-east-1`
- `S3_PUBLIC_BASE_URL=http://localhost:9000/qihang`
- `DEMO_MODE=true`
- `INFERENCE_ENDPOINT=`  # DEMO_MODE=false 时调用；留空则报错
- `UPLOAD_MAX_MB=50`

---

## 5. 对象存储（S3/MinIO）路径规范（强制）

Bucket: `qihang`

### 5.1 路径约定
- 原始上传：
  - `datasets/{dataset_id}/items/{data_item_id}/raw/{filename}`
- 缩略图：
  - `datasets/{dataset_id}/items/{data_item_id}/thumb/{filename}.jpg`
- 训练产物：
  - `runs/{run_id}/artifacts/{name}`
- Demo 历史（可选）：
  - `demo/{user_id}/{request_id}/input/{filename}`
  - `demo/{user_id}/{request_id}/output/result.json`

### 5.2 上传流程（必须实现 presigned upload）
1) Web 调用 API：`POST /api/v1/uploads/presign`
2) API 返回 presigned PUT URL + object_key
3) 浏览器直传到 MinIO/S3
4) Web 再调用 API：`POST /api/v1/uploads/complete`，写入 `data_items` 记录并触发异步处理

---

## 6. 数据库（Postgres）— 初始迁移 DDL（v0.1 必须能跑）

> 说明：字段可增不可删；关键表必须有 created_at；有更新行为的表必须有 updated_at。

将以下 SQL 作为 Alembic 初始迁移（可先用 `op.execute()` 直接执行）。

```sql
create extension if not exists "uuid-ossp";

-- USERS
create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  email text not null unique,
  password_hash text not null,
  display_name text,
  created_at timestamptz not null default now()
);

-- WORKSPACES
create table if not exists workspaces (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'owner', -- owner|admin|editor|viewer
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- PROJECTS
create table if not exists projects (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_projects_workspace on projects(workspace_id);

-- DATASETS
create table if not exists datasets (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  type text not null default 'images', -- images|audio|text|video|generic
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_datasets_project on datasets(project_id);

create table if not exists data_items (
  id uuid primary key default uuid_generate_v4(),
  dataset_id uuid not null references datasets(id) on delete cascade,
  object_key text not null,          -- S3 key
  filename text not null,
  media_type text not null,          -- image/jpeg, image/png, video/mp4...
  size_bytes bigint not null default 0,
  sha256 text,
  width int,
  height int,
  duration_ms int,
  meta_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_data_items_dataset on data_items(dataset_id);
create index if not exists idx_data_items_sha on data_items(sha256);

create table if not exists annotations (
  id uuid primary key default uuid_generate_v4(),
  data_item_id uuid not null references data_items(id) on delete cascade,
  type text not null,                -- tag|bbox|ocr|note
  payload_json jsonb not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_annotations_item on annotations(data_item_id);

-- DATASET VERSIONS (immutable snapshots)
create table if not exists dataset_versions (
  id uuid primary key default uuid_generate_v4(),
  dataset_id uuid not null references datasets(id) on delete cascade,
  version int not null,              -- monotonically increasing per dataset
  commit_message text,
  item_count int not null default 0,
  frozen_item_ids uuid[] not null default '{}'::uuid[], -- snapshot list
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (dataset_id, version)
);
create index if not exists idx_dsv_dataset on dataset_versions(dataset_id);

-- TRAINING JOBS & RUNS
create table if not exists training_jobs (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  dataset_version_id uuid not null references dataset_versions(id) on delete restrict,
  recipe text not null,              -- memory_index|prototype_find|lora_finetune|mock
  status text not null default 'pending', -- pending|running|succeeded|failed|canceled
  params_json jsonb not null default '{}'::jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_jobs_project on training_jobs(project_id);

create table if not exists training_runs (
  id uuid primary key default uuid_generate_v4(),
  training_job_id uuid not null references training_jobs(id) on delete cascade,
  status text not null default 'running', -- running|succeeded|failed
  started_at timestamptz,
  finished_at timestamptz,
  logs_object_key text,
  summary_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_runs_job on training_runs(training_job_id);

create table if not exists metrics (
  id bigserial primary key,
  run_id uuid not null references training_runs(id) on delete cascade,
  key text not null,
  value double precision not null,
  step int not null default 0,
  ts timestamptz not null default now()
);
create index if not exists idx_metrics_run on metrics(run_id);

create table if not exists artifacts (
  id uuid primary key default uuid_generate_v4(),
  run_id uuid not null references training_runs(id) on delete cascade,
  name text not null,                -- e.g. adapter.safetensors, index.faiss, report.json
  object_key text not null,          -- S3 key
  meta_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_artifacts_run on artifacts(run_id);

-- MODEL REGISTRY
create table if not exists models (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  task_type text not null default 'general', -- demo|vqa|ocr|prototype|lora|general
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_models_project on models(project_id);

create table if not exists model_versions (
  id uuid primary key default uuid_generate_v4(),
  model_id uuid not null references models(id) on delete cascade,
  version int not null,              -- monotonically increasing per model
  run_id uuid references training_runs(id) on delete set null,
  metrics_json jsonb not null default '{}'::jsonb,
  artifact_object_key text not null, -- points to main artifact bundle
  notes text,
  created_at timestamptz not null default now(),
  unique (model_id, version)
);
create index if not exists idx_model_versions_model on model_versions(model_id);

create table if not exists model_aliases (
  id uuid primary key default uuid_generate_v4(),
  model_id uuid not null references models(id) on delete cascade,
  alias text not null,               -- prod|staging|dev
  model_version_id uuid not null references model_versions(id) on delete restrict,
  updated_at timestamptz not null default now(),
  unique (model_id, alias)
);

-- API KEYS
create table if not exists api_keys (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  key_hash text not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- WAITLIST
create table if not exists waitlist (
  id uuid primary key default uuid_generate_v4(),
  email text not null unique,
  source text,
  created_at timestamptz not null default now()
);

-- AUDIT LOGS
create table if not exists audit_logs (
  id bigserial primary key,
  workspace_id uuid references workspaces(id) on delete set null,
  actor_user_id uuid references users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  meta_json jsonb not null default '{}'::jsonb,
  ts timestamptz not null default now()
);
create index if not exists idx_audit_workspace on audit_logs(workspace_id);
```

---

## 7. API 契约（v0.1 必须按此实现）

> 约定：除登录/注册/公共 waitlist 外，全部需要登录（Cookie JWT）。

### 7.1 Auth
- `POST /api/v1/auth/register`
  - body: `{ "email": "...", "password": "...", "display_name": "..." }`
  - 200: set-cookie(access_token), `{ "user": {...}, "workspace": {...} }`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`（清 cookie）
- `GET  /api/v1/auth/me`

### 7.2 Waitlist（公共）
- `POST /api/v1/waitlist`
  - body: `{ "email": "...", "source": "home|demo|pricing" }`
  - 200: `{ "ok": true }`

### 7.3 Projects
- `GET  /api/v1/projects`
- `POST /api/v1/projects` body `{ "name": "...", "description": "..." }`
- `GET  /api/v1/projects/{project_id}`
- `PATCH /api/v1/projects/{project_id}`
- `DELETE /api/v1/projects/{project_id}`（软删除可选；v0.1 直接 delete 也可）

### 7.4 Datasets / Data Items / Versions

#### 7.4.1 Dataset CRUD
- `GET  /api/v1/datasets?project_id=...`
- `POST /api/v1/datasets` body `{ "project_id": "...", "name": "...", "type": "images" }`
- `GET  /api/v1/datasets/{dataset_id}`
- `DELETE /api/v1/datasets/{dataset_id}`（触发异步清理对象存储）

#### 7.4.2 Presigned Upload
- `POST /api/v1/uploads/presign`
  - body:
    ```json
    { "dataset_id": "uuid", "filename": "a.jpg", "media_type": "image/jpeg", "size_bytes": 12345 }
    ```
  - 200:
    ```json
    {
      "upload_id": "uuid",
      "object_key": "datasets/{dataset_id}/items/{data_item_id}/raw/a.jpg",
      "put_url": "https://...presigned...",
      "headers": { "Content-Type": "image/jpeg" },
      "data_item_id": "uuid"
    }
    ```
- `POST /api/v1/uploads/complete`
  - body: `{ "upload_id": "uuid", "data_item_id": "uuid" }`
  - 200: `{ "ok": true }` 并触发 worker：提取 sha/尺寸/缩略图

#### 7.4.3 Items & Annotations
- `GET /api/v1/datasets/{dataset_id}/items?limit=50&offset=0&tag=...`
- `POST /api/v1/data-items/{data_item_id}/annotations`
  - body: `{ "type": "tag", "payload_json": {"tags":["key","wallet"]} }`
- `GET /api/v1/data-items/{data_item_id}`（含 annotations 列表）

#### 7.4.4 Dataset Version Commit
- `POST /api/v1/datasets/{dataset_id}/commit`
  - body: `{ "commit_message": "v1 baseline", "freeze_filter": { "tag": null } }`
  - 200: `{ "dataset_version": {...} }`
  - 规则：version = max(version)+1；frozen_item_ids = 当前 dataset 所有 item id（可按 filter 过滤）

### 7.5 Training Jobs（mock 也必须走这套）

- `POST /api/v1/train/jobs`
  - body:
    ```json
    {
      "project_id": "uuid",
      "dataset_version_id": "uuid",
      "recipe": "mock",
      "params_json": { "base_model": "qihang-mini", "epochs": 1 }
    }
    ```
  - 200: `{ "job": {...} }`（status=pending）
  - 行为：API 写 DB 后，投递 Celery task `run_training_job(job_id)`。

- `GET /api/v1/train/jobs?project_id=...`
- `GET /api/v1/train/jobs/{job_id}`（含当前 run/metrics 摘要）
- `GET /api/v1/train/jobs/{job_id}/events`（SSE：推送日志与状态）

**SSE event 格式（必须实现）**
- event: `status` data: `{ "status":"running" }`
- event: `log` data: `{ "line":"..." }`
- event: `metric` data: `{ "key":"loss","value":0.12,"step":3 }`

> v0.1 如果 SSE 太难，可先实现轮询：`GET /api/v1/train/jobs/{id}` 每 2s 拉一次；但必须在代码里预留 SSE 接口。

### 7.6 Eval（回放与对比，v0.1 可简化）
- `POST /api/v1/eval/runs`
  - body: `{ "model_version_a":"uuid", "model_version_b":"uuid", "dataset_version_id":"uuid" }`
  - 200: `{ "eval_id":"uuid" }`
- `GET /api/v1/eval/runs/{eval_id}`（返回样本列表与 A/B 输出；v0.1 可 mock）

### 7.7 Model Registry
- `GET  /api/v1/models?project_id=...`
- `POST /api/v1/models` body `{ "project_id":"uuid","name":"Personal Assistant","task_type":"general" }`
- `GET  /api/v1/models/{model_id}`
- `GET  /api/v1/models/{model_id}/versions`
- `POST /api/v1/models/{model_id}/versions`
  - 用途：将某个 run 产物登记成版本（v0.1 mock 训练结束时自动创建也可）
- `POST /api/v1/models/{model_id}/aliases`
  - body: `{ "alias":"prod", "model_version_id":"uuid" }`
  - 行为：更新 alias 指针 + 写 audit log
- `POST /api/v1/models/{model_id}/rollback`
  - body: `{ "alias":"prod", "to_model_version_id":"uuid" }`

### 7.8 Demo Inference（必须有稳定返回结构）

- `POST /api/v1/demo/infer`
  - body:
    ```json
    {
      "task": "vqa",
      "prompt": "这是什么？",
      "image_ref": { "type":"s3", "object_key":"..." },
      "locale": "zh-CN"
    }
    ```
  - 200:
    ```json
    {
      "request_id": "uuid",
      "task": "vqa",
      "latency_ms": 123,
      "outputs": {
        "text": "这是一个......",
        "boxes": [
          { "x":0.12, "y":0.25, "w":0.30, "h":0.40, "label":"chair", "score":0.91 }
        ]
      },
      "ui_cards": {
        "case_display_text": "前方：椅子（2m）",
        "tts_text": "前方两米有椅子。",
        "status_icons": ["cloud","privacy_on"]
      }
    }
    ```
  - 规则：bbox 使用 0-1 归一化坐标；前端按图片尺寸缩放渲染。

- `DEMO_MODE=true`：直接返回 mock（但必须符合结构）  
- `DEMO_MODE=false`：调用 `INFERENCE_ENDPOINT`（HTTP）并透传结果（必要时做字段映射）

---

## 8. Worker 任务（Celery tasks，v0.1 必须实现至少 2 个）

### 8.1 `process_data_item(data_item_id)`
触发时机：upload complete

步骤：
1) 从 S3 拉取文件（或用 HEAD 获取大小）
2) 计算 sha256（大文件可跳过；但图片建议算）
3) 若图片：读宽高、生成缩略图并上传到 `thumb/`
4) 更新 `data_items` 的 width/height/sha256/meta_json
5) 写 audit log：`data_item.processed`

### 8.2 `run_training_job(job_id)`（Mock 训练）
步骤（严格按状态机写）：
1) job.status: pending → running（写 DB，updated_at）
2) 创建 training_run（started_at=now）
3) 每 1s 写一行日志（可写到 redis stream 或直接 append 到 `summary_json.logs`；v0.1 允许简化）
4) 写 5-20 条 metrics（loss 下降的假数据）
5) 上传一个 artifact 文件（例如 `runs/{run_id}/artifacts/report.json`）
6) run.status → succeeded，finished_at
7) job.status → succeeded
8) 自动创建/更新一个 model_version（若 project 没有 model，则创建默认 model）
9) 写 audit log：`training_job.succeeded`

失败分支：
- 捕获异常：job.status → failed；run.status → failed；写 audit log 与 error.details

---

## 9. 前端页面规格（必须逐页实现最小可用）

> 要求：公共站与控制台使用同一套设计系统；控制台必须有 Sidebar 与面包屑。

### 9.1 公共站
- `/`：Hero（价值主张 + CTA）、场景卡片、Demo 入口、Waitlist 表单、Footer
- `/product`：产品形态（圆盘盒 + 胸前相机）示意、离线/在线模式、训练模式分层（4 层）
- `/how-it-works`：链路图（上传→推理→圆盘屏/耳机）、隐私原则
- `/demo`：上传图片→选择任务→展示结果
  - 左侧：Chat/Prompt
  - 右侧：图片+bbox overlay + 圆盘屏模拟器
  - 下方：结构化输出（json 折叠可选）
- `/privacy`：隐私说明（v0.1 可简版）
- `/waitlist`：单独页面表单（同首页）
- `/pricing`、`/contact`：占位即可（但要有内容，不要空白）

### 9.2 控制台（/app，需要登录）
- `/app` Dashboard
  - 展示：项目数、数据集数、最近训练任务、当前 prod 模型版本
- `/app/projects`：项目列表 + 新建
- `/app/projects/{id}`：项目概览
  - 卡片：Datasets、Training Jobs、Models
- `/app/datasets`：数据集列表 + 新建
- `/app/datasets/{id}`：样本浏览
  - 上传按钮（调用 presign/complete）
  - 图片墙/表格切换
  - 标签编辑（annotation=tag）
  - 提交版本（commit）
- `/app/train`：训练任务列表 + 创建任务
- `/app/train/{id}`：训练详情
  - 状态、参数、日志（SSE/轮询）、指标曲线、产物列表
- `/app/models`：模型列表
- `/app/models/{id}`：版本列表 + alias 管理（prod/staging）
- `/app/eval`：评测占位（v0.1 允许只做“回放单模型”）
- `/app/settings`：账户、API key、数据删除
- `/app/devices`：占位页（说明未来绑定）

---

## 10. 前端复用组件清单（必须有）

- `AppShell`：顶部栏 + Sidebar + 内容区
- `DataTable`：分页/搜索/筛选
- `StatusBadge`：pending/running/succeeded/failed
- `Uploader`：上传队列、进度、失败重试
- `ImageCanvas`：图片展示 + bbox overlay
- `DiscScreenSimulator`：圆盘屏模拟器（SVG）
  - 输入：`case_display_text`, `status_icons`
  - 输出：可视化圆盘与文字；状态 icon（cloud/privacy）
- `JobLogViewer`：日志滚动 + 复制
- `MetricChart`：折线图（loss/acc）

---

## 11. Docker Compose（必须可一键启动）

`docker/docker-compose.yml` 至少包含：
- postgres:15
- redis:7
- minio + minio console
- api（uvicorn）
- worker（celery -A ... worker）
- 可选：web

验收：执行 `docker compose up` 后，API 与 Worker 正常启动；MinIO 可打开；API 能连 DB。

---

## 12. Milestones（交付拆分 + DoD）

### M1 公共站 + Demo
- DoD：
  - 所有公共页面可访问；Demo 可上传图片并显示 mock 结果
  - waitlist 写入 DB
  - DiscScreenSimulator 可用

### M2 登录 + 项目/数据集
- DoD：
  - Auth 可用；/app 受保护
  - Project/Dataset CRUD
  - 上传与样本浏览、tag 标注、提交 dataset_version

### M3 训练任务（Mock）+ 日志/指标
- DoD：
  - 创建 training_job → worker 跑完 → 详情页看到日志/曲线/产物
  - 状态机完整；失败分支可触发（可用手动按钮模拟失败）

### M4 Model Registry + 发布/回滚
- DoD：
  - model_versions 与 aliases 可管理
  - alias 切换与回滚写审计日志

### M5（可选）Dreams 3D
- DoD：
  - 3D Viewer 页面可展示示例数据或 mock 结果

---

## 13. 交付物清单（仓库内必须有）

- `README.md`：本地启动步骤（含 docker compose），常见问题
- `.env.example`：web/api/worker
- `docker/docker-compose.yml`
- Alembic 初始迁移可运行
- 最少 1 个 API 集成测试（pytest）与 1 个前端页面 smoke test（可选）

---

## 14. 验收脚本（人工验收步骤）

1) 打开 `/` → `/demo` 上传图片 → 得到结果 + 圆盘屏显示  
2) 注册 → 进入 `/app`  
3) 创建 Project → 创建 Dataset → 上传 5 张图 → 打 tag → Commit 版本  
4) 创建 Training Job（recipe=mock）→ 进入详情页看日志与曲线 → 成功  
5) 在 Models 里看到新版本 → 设置 alias=prod → 再回滚到旧版本  
6) 删除 Dataset → 刷新后样本不可见；后台任务最终删除对象存储（v0.1 可先不做彻底删除但要有状态）

---

> 完成以上即视为 v0.1 “可演示 + 可复现 + 可扩展”达标。

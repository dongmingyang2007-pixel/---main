# Console Extension Pages: Devices + Discover + Model Detail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the devices management page, discover marketplace (memory packs + models), and model detail page.

**Architecture:** Devices page is a consumer-friendly device status + settings UI. Discover page combines memory pack browsing with the existing model catalog API. Model detail page shows capabilities in consumer language using the existing `/api/v1/models/catalog/{id}` endpoint.

**Tech Stack:** Next.js 16 App Router, React 18, Tailwind CSS, next-intl, clsx

**Spec:** `docs/superpowers/specs/2026-03-19-console-consumer-redesign.md`

---

### Task 1: Build devices page

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/devices/page.tsx`
- Modify: `apps/web/styles/globals.css`
- Modify: `apps/web/messages/zh/console-devices.json`
- Modify: `apps/web/messages/en/console-devices.json`

- [ ] **Step 1: Read current devices page and i18n files**

Read the current placeholder at `apps/web/app/[locale]/(console)/app/devices/page.tsx` and both `console-devices.json` files to understand existing keys.

- [ ] **Step 2: Rewrite devices page**

Replace the page with a consumer device management layout:

**Top bar:** "设备" title + "配对新设备" primary button

**Device Hero Card** (when a device is connected — use mock data for now):
- Left: Earphone SVG illustration (headphone icon, large) + green pulse dot for connection status
- Right:
  - Device name ("我的铭润耳机") + "已连接" badge
  - Model info: "铭润 MR-1 · 固件 v1.2.3"
  - 3 stat cards in a row: 电量 78% (with progress bar), 今日使用 4.2h, 今日对话 23
  - 3 action buttons: 检查更新, 设备设置, 设备信息

**Settings area** (two-column grid below hero):
- Left card "语音设置": 唤醒词 (dropdown: "嘿，小铭"), 语音识别语言 (dropdown: "中文"), 持续聆听 (toggle switch)
- Right card "音频": 助手语音 (dropdown: "温柔女声"), 语速 (dropdown: "正常"), 降噪 (toggle switch, default on)

**No device state:** When no device connected, show a pairing guide placeholder

All data is mock/static for now — no device API exists yet. The UI is ready for future backend integration.

- [ ] **Step 3: Add devices CSS**

Add to `globals.css`:
- `.devices-page` — layout container
- `.devices-topbar` — top bar
- `.device-hero` — hero card with flex layout
- `.device-visual` — earphone illustration area with pulse animation
- `.device-stats` — 3-column stats grid
- `.device-stat` — individual stat with progress bar
- `.device-actions` — action button row
- `.device-settings-grid` — 2-column settings grid
- `.device-settings-card` — settings card
- `.device-setting-row` — individual setting with label + control
- `.device-toggle` — toggle switch (on/off states)

- [ ] **Step 4: Update devices i18n**

Update `console-devices.json` (zh + en) with new keys for the consumer layout — hero card labels, settings labels, button texts, stat labels.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: build consumer devices page with hero card and settings"
```

---

### Task 2: Build discover page — memory packs + models marketplace

**Files:**
- Modify: `apps/web/app/[locale]/(console)/app/discover/page.tsx`
- Modify: `apps/web/styles/globals.css`
- Modify: `apps/web/messages/zh/console.json`
- Modify: `apps/web/messages/en/console.json`

- [ ] **Step 1: Read ModelPickerModal for API patterns**

Read `apps/web/components/console/ModelPickerModal.tsx` to understand how the model catalog API is consumed and what data structure `CatalogModel` returns.

- [ ] **Step 2: Build discover page**

Replace the placeholder with a full marketplace:

**Top bar:** "发现" title + search input (right-aligned, 260px, pill shape)

**Category tabs:** 全部 / 记忆包 / 模型 (pill toggle, "全部" default)

**Memory Packs section** (shown when tab is "全部" or "记忆包"):
- Section header: "热门记忆包" + "查看全部" link
- 3-column card grid:
  - Card 1: "线性代数基础" by 数学老王, 48 条记忆, 2.3k 下载, "获取" button, "热门" badge
  - Card 2: "日语 N3 词汇" by Yuki, 120 条记忆, 856 下载, "获取" button, "新上架" badge
  - Card 3: Upload CTA card — "分享你的记忆包" with upload icon, dashed border
- All memory pack data is mock/static — no backend API yet

**Models section** (shown when tab is "全部" or "模型"):
- Section header: "模型" + "查看全部" link
- 3-column card grid, fetched from `GET /api/v1/models/catalog`
- Each model card shows:
  - Provider logo placeholder (letter in colored box)
  - Model name + provider
  - Capability tags (消费者语言: "对话", "视觉", "深度推理" etc.)
  - Short description (消费者语言)
  - Action button: "替换对话模型" or "使用中" (if current model)
- Use `apiGet<CatalogModel[]>("/api/v1/models/catalog")` to fetch
- Map category to consumer label: llm→"对话", asr→"语音识别", tts→"语音合成", vision→"视觉理解"
- Map capabilities to consumer tags

Click on a model card navigates to `/app/discover/models/{modelId}`.

- [ ] **Step 3: Add discover CSS**

Add to `globals.css`:
- `.discover-page` — layout
- `.discover-topbar` — top bar with search
- `.discover-tabs` — category tab toggle
- `.discover-section` — section with header + grid
- `.discover-grid` — 3-column card grid
- `.pack-card` — memory pack card with hover effect
- `.pack-badge` — hot/new corner badge
- `.pack-dl-btn` — "获取" button
- `.upload-cta` — upload CTA card (dashed border)
- `.model-card` — model card
- `.model-tag` — capability tag pill
- `.model-use-btn` — action button

- [ ] **Step 4: Add discover i18n keys**

Add to `console.json` (zh + en):
- `"discover.title"`, `"discover.search"`, `"discover.tabAll"`, `"discover.tabPacks"`, `"discover.tabModels"`
- `"discover.hotPacks"`, `"discover.viewAll"`, `"discover.models"`
- `"discover.get"`, `"discover.inUse"`, `"discover.sharePack"`, `"discover.sharePackDesc"`
- `"discover.badgeHot"`, `"discover.badgeNew"`
- `"discover.replace"`, `"discover.category.llm"`, `"discover.category.asr"`, `"discover.category.tts"`, `"discover.category.vision"`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: build discover page with memory packs and model marketplace"
```

---

### Task 3: Build model detail page

**Files:**
- Create: `apps/web/app/[locale]/(console)/app/discover/models/[modelId]/page.tsx`
- Modify: `apps/web/styles/globals.css`
- Modify: `apps/web/messages/zh/console.json`
- Modify: `apps/web/messages/en/console.json`

- [ ] **Step 1: Check the model catalog detail API response**

Read `apps/api/app/routers/model_catalog.py` to understand what `GET /api/v1/models/catalog/{model_id}` returns — especially the `ModelCatalogDetailOut` schema with capabilities, modalities, pricing.

- [ ] **Step 2: Build model detail page**

Create the route page:

**Header:**
- Model name (large, bold) + provider name
- Capability tags row (consumer language)
- "使用此模型" primary CTA button

**Description section:**
- Consumer-friendly description of what the model does

**Capability matrix:**
- Input modalities row with icons (文本/图像/音频/视频) — check/cross for each
- Output modalities row — same
- Core capabilities checklist: 联网搜索, 工具调用, 深度思考, 缓存加速 etc.

**Suitable scenarios:**
- 2-3 use case cards

**Back button:** "← 返回发现" linking to /app/discover

Data: fetch from `apiGet("/api/v1/models/catalog/{modelId}")`. Map technical fields to consumer language.

- [ ] **Step 3: Add model detail CSS**

Add to `globals.css`:
- `.model-detail` — page layout
- `.model-detail-header` — header with name, tags, CTA
- `.model-detail-section` — content section
- `.model-capability-matrix` — modality grid
- `.model-capability-item` — individual capability with check/cross icon

- [ ] **Step 4: Add model detail i18n keys**

Add to `console.json` (zh + en):
- `"modelDetail.useModel"`, `"modelDetail.backToDiscover"`, `"modelDetail.description"`, `"modelDetail.capabilities"`, `"modelDetail.inputModalities"`, `"modelDetail.outputModalities"`, `"modelDetail.scenarios"`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add model detail page with capability matrix"
```

---

### Task 4: Verify build

- [ ] **Step 1: Run build**

```bash
cd apps/web && npx next build
```

Expected: Build succeeds.

- [ ] **Step 2: Commit fixes if needed**

```bash
git add -A && git commit -m "fix: resolve build issues from Plan 3"
```

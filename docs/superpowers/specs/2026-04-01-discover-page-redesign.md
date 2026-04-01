# 发现页全面重设计

## 概述

将发现页从"模型搜索工具"重设计为 **Hub 式发现首页**，包含场景导航、首推模型、分类模型目录和记忆包社区四大内容板块。目标用户为普通消费者和企业用户。

## 设计决策

| 决策点 | 选择 | 原因 |
|--------|------|------|
| 整体结构 | Hub 式分区布局 | 消费者需要引导而非纯搜索 |
| 视觉风格 | 延续玻璃拟态 | 与现有控制台设计语言统一 |
| 图标 | 全部原创 SVG 矢量图标 | 不使用 emoji |
| 场景导航 | 7 个场景，按 pipeline_slot 1:1 映射 | 技术准确，覆盖所有模型类型 |
| 首推模型 | 后端 featured 字段驱动 | 运营可控，无需改代码 |
| 模型目录 | 按类别分区展示，每区横向滚动 | 参考百炼的分类浏览体验 |
| 记忆包 | UI 框架先行，后端就绪后对接 | 记忆包后端尚未完成 |
| 参考 | 阿里云百炼（分类导航）+ OpenAI（大卡片视觉） | 用户提供的参考方向 |

## 页面结构

页面从上到下分为 5 个区域：

### 1. Header + 全局搜索

- 精简标题：左侧 "DISCOVER / 发现"
- 右侧搜索栏，placeholder "搜索模型、场景、记忆包..."
- 搜索覆盖全部三类内容（模型、场景、记忆包）
- 搜索使用现有的客户端过滤逻辑，匹配 display_name / provider / description / category / aliases

### 2. 场景导航

7 个场景卡片，按 pipeline_slot 1:1 映射：

| pipeline_slot | 场景名称 | 渐变色 | 图标描述 |
|---------------|----------|--------|----------|
| `llm` | 文本对话 | indigo→violet (#6366f1→#8b5cf6) | 文本行 + 编辑笔 |
| `asr` | 语音识别 | blue→light-blue (#3b82f6→#60a5fa) | 麦克风 + 声波 |
| `tts` | 语音合成 | cyan→light-cyan (#06b6d4→#22d3ee) | 喇叭 + 扩散波 |
| `vision` | 视觉理解 | amber→yellow (#f59e0b→#fbbf24) | 眼睛 + 瞳孔 |
| `realtime` | 实时对话 | green→emerald (#10b981→#34d399) | 同心圆 + 信号点 |
| `realtime_asr` | 实时语音识别 | violet→light-violet (#8b5cf6→#a78bfa) | 麦克风 + 闪电标记 |
| `realtime_tts` | 实时语音合成 | pink→light-pink (#ec4899→#f472b6) | 喇叭 + 闪电标记 |

**交互：** 点击场景卡片 → 滚动到模型目录区域，自动筛选到对应 pipeline_slot 的类别。

**数据来源：** 从 catalog API 返回的模型数据中提取所有出现过的 pipeline_slot 值，动态生成场景列表。前端维护 slot → 场景名称/图标/颜色 的静态映射表。

**布局：** 7 列网格，移动端改为横向滚动。

### 3. 首推模型

不对称网格大卡片，展示后端标记为 featured 的旗舰模型。

**布局：** 3 列不对称网格（比例 1.4:1:1），第一张卡片更大。移动端改为纵向堆叠。

**卡片内容：**
- 渐变色背景（根据模型类别自动分配）
- 右上角装饰性 SVG 图案（每个类别有独特图案）
- 类别标签（如"深度思考"）
- 模型名称（大字重）
- 一行描述

**数据来源：** 后端 API 需要新增 `featured` 或 `is_featured` 字段。前端过滤 `featured === true` 的模型，按 `official_order` 排序，取前 3 个展示。

**降级方案：** 如果后端尚未添加 featured 字段，前端暂时按规则自动选取：每个主要类别取 `official_order` 最小且 `is_selectable_in_console === true` 的模型。

### 4. 模型目录（按类别分区）

参考百炼风格，每个类别独立一个区块，区内模型横向滚动展示。

**区块结构：**
- 左侧：类别 SVG 图标 + 类别名称 + 模型数量 badge
- 右侧："查看全部 →" 链接
- 下方：横向滚动的模型卡片

**模型卡片内容（紧凑版）：**
- Provider badge（缩写字母 + 品牌色背景）
- 模型名称
- Provider 名称
- 一行描述（截断）
- 能力标签（仅显示以下内容，必须使用中文翻译）：
  - 模态标签：文本 / 图像 / 音频 / 视频
  - 工具标签：工具调用 / 联网搜索
  - 核心能力标签：深度思考
- 可用状态 badge

**不显示的标签（过于技术化）：**
- streaming（流式输出）
- structured_output（结构化输出）
- cache（上下文缓存）
- ranking（重排序）

这些标签仅在模型详情页展示。

**国际化要求：** 所有标签必须通过 `labelForToken()` 翻译后展示。中文模式下不得出现英文原始 token（如 "text" 必须显示为 "文本"）。

**类别排列顺序：** 按 taxonomy 中的 `order` 字段排序。空类别（count === 0）不显示。

**数据来源：** 复用现有 `/api/v1/models/catalog?view=discover` API，前端按 `official_category_key` 分组。

### 5. 记忆包社区

用户分享的记忆链路展示区域。

**布局：** 3 列网格。移动端 1 列。

**卡片内容：**
- 用户头像（渐变圆形 + SVG 人物轮廓）
- 用户名 + 发布时间
- 记忆包标题
- 一行描述
- 社交指标：点赞数（SVG 心形图标）+ 下载数（SVG 下载图标）

**数据来源：** 后端 API 尚未就绪。前端先搭建 UI 框架，使用 mock 数据或空状态展示。预留 API 接口结构：

```typescript
interface MemoryPack {
  id: string;
  title: string;
  description: string;
  author: {
    id: string;
    name: string;
    avatar_url?: string;
  };
  created_at: string;
  likes_count: number;
  downloads_count: number;
  tags?: string[];
}
```

**空状态：** 在后端就绪前，显示占位卡片 + "记忆包社区即将上线" 的提示文案，与现有 Packs 区域的路线图 pills 保持一致。

## 交互设计

### 搜索行为

- 搜索框输入时实时过滤（复用现有 `useDeferredValue` 逻辑）
- 搜索结果影响所有区域：场景导航高亮匹配项、模型目录过滤、记忆包过滤
- 清空搜索恢复默认状态
- URL 参数同步：`?q=关键词`

### 场景导航点击

- 点击场景卡片 → 平滑滚动到模型目录区域
- 模型目录高亮对应类别区块，其他类别保持可见但视觉弱化
- URL 参数同步：`?slot=llm`

### 模型卡片点击

- 点击任意模型卡片 → 导航到模型详情页 `/app/discover/models/{modelId}`
- Picker 模式下保持现有行为（传递 picker/category/current_model_id/from 参数）

### Picker 模式

- 从助手配置页进入时（`?picker=1`），隐藏场景导航和记忆包社区
- 仅显示搜索 + 首推模型 + 模型目录
- 顶部显示 picker context bar（沿用现有设计）

## 移动端适配

| 区域 | 桌面端 | 移动端 |
|------|--------|--------|
| 场景导航 | 7 列网格 | 横向滚动，2 行 |
| 首推模型 | 3 列不对称网格 | 纵向堆叠 |
| 模型目录 | 横向滚动卡片 | 同，卡片宽度调整 |
| 记忆包 | 3 列网格 | 1 列堆叠 |

## 文件影响

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `apps/web/app/[locale]/(console)/app/discover/page.tsx` | 重写 | 新的 Hub 布局和组件结构 |
| `apps/web/styles/globals.css` | 修改 | 更新 discover 相关样式 |
| `apps/web/lib/discover-labels.ts` | 修改 | 新增 pipeline_slot → 场景名称映射 |
| `apps/web/messages/zh/console.json` | 修改 | 新增场景导航、记忆包社区的中文文案 |
| `apps/web/messages/en/console.json` | 修改 | 新增对应英文文案 |

模型详情页 (`discover/models/[...modelId]/page.tsx`) 不在本次改动范围内。

## 不做的事情

- 不改动模型详情页
- 不改动后端 API（除了建议后端新增 featured 字段）
- 不实现记忆包的完整功能（仅 UI 框架）
- 不添加动画/过渡效果（后续迭代）
- 发现页模型卡片不展示技术性标签（streaming / structured_output / cache / ranking）

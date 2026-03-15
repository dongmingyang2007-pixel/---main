# 统一导航设计

**日期**: 2026-03-15
**状态**: 已批准

## 背景

当前公开站和控制台使用两套完全隔离的导航系统（SiteHeader + ConsoleShell/TopBar），导致：
1. 退出登录后仍可通过 URL 直接进入控制台（middleware auth 检测不可靠，依赖跨域 HttpOnly cookie）
2. 公开站 header 始终显示"登录控制台"，无法感知用户登录状态
3. 公开站和控制台切换时体验割裂，用户感知为两个独立网站

## 设计方案

### 1. 统一 Header 组件（UnifiedHeader）

替换 SiteHeader + TopBar，全站共用一个 header 组件。根据当前路径自动适配两种模式：

**公开站模式**（`/`、`/product`、`/ecosystem`、`/demo`、`/pricing`、`/support`、`/updates`）：
- 左：品牌 logo（可点击回首页）
- 中：产品 | AI 生态 | 在线体验 | 定价 | 支持（导航链接）
- 右：语言切换 + 登录按钮（未登录）/ 用户头像菜单（已登录）

**控制台模式**（`/app/*`）：
- 左：品牌 logo + 「控制台」文字标识
- 中：留空
- 右：语言切换 + 用户头像菜单

Header 高度、背景、滚动行为全站统一。滚动进度条保留。

### 2. 用户菜单

**未登录状态**：
- 右侧显示蓝色实心「登录」按钮，点击跳转 `/login`

**已登录状态**：
- 右侧显示用户头像图标，点击展开下拉菜单：
  - 进入控制台（公开站时显示）/ 返回官网（控制台时显示）
  - 账号设置（→ `/app/settings`）
  - 分隔线
  - 退出登录（调 logout API，清除 cookie，跳转首页）

### 3. 控制台布局调整

- **删除 TopBar 组件**：其功能由 UnifiedHeader 和内容区承担
- **面包屑**：从 TopBar 下移到控制台内容区顶部（workspace 区域内）
- **项目切换器**：同样下移到内容区顶部，紧跟面包屑
- **侧边栏（ActivityBar）**：保持不变，继续负责控制台内部导航
- **StatusBar**：保持不变

调整后的控制台布局层级：
```
UnifiedHeader（全站统一）
├── console-shell-body
│   ├── ActivityBar（左侧图标栏）
│   └── console-shell-workspace
│       ├── InlineTopBar（面包屑 + 项目切换器 + 汉堡按钮(移动端)）
│       └── [页面内容]
└── StatusBar
```

### 4. 移动端导航

统一为一个汉堡菜单按钮，但展开内容根据上下文不同：
- **公开站**：展开公开站导航项（产品、AI 生态、Demo 等）+ 登录/用户菜单
- **控制台**：展开控制台侧边栏导航项（仪表盘、项目、数据集等）+ 用户菜单

### 5. 登录状态检测

引入前端可读的 `auth_state` cookie 作为 UI 状态标记：

- **登录成功时**：前端写 `auth_state=1` cookie（非 HttpOnly，JS 可读，Path=/，SameSite=Lax）
- **退出登录时**：前端清除 `auth_state` + `qihang_workspace_id` cookie
- **Header 组件**：读 `auth_state` cookie 决定显示「登录按钮」还是「用户头像菜单」
- **Middleware（proxy.ts）**：用 `auth_state` cookie 做 `/app` 路由拦截，替代当前不可靠的 `access_token` / `qihang_workspace_id` 检测
- **安全边界**：`auth_state` 仅用于 UI 展示和路由守卫，真正的 API 鉴权仍由后端 HttpOnly `access_token` cookie 负责。即使用户伪造 `auth_state=1`，API 调用仍会因无有效 `access_token` 而返回 401

### 6. 文件变更清单

**新建：**
- `components/UnifiedHeader.tsx` — 统一 header 组件
- `components/console/InlineTopBar.tsx` — 控制台内容区顶部的面包屑+项目切换器

**修改：**
- `app/[locale]/(public)/layout.tsx` — 替换 SiteHeader 为 UnifiedHeader
- `app/[locale]/(console)/layout.tsx` — 替换 ConsoleShell 内的 TopBar 为 UnifiedHeader
- `components/console/ConsoleShell.tsx` — 移除 TopBar 引用，添加 InlineTopBar
- `lib/api.ts` — 登录/退出时管理 `auth_state` cookie
- `proxy.ts` — middleware 改用 `auth_state` 检测
- `components/public/MobileNav.tsx` — 适配统一导航的移动端行为
- `components/console/MobileConsoleNav.tsx` — 适配统一导航的移动端行为

**可删除（功能已合并）：**
- `components/public/SiteHeader.tsx` — 功能合并到 UnifiedHeader
- `components/console/TopBar.tsx` — 功能拆分到 UnifiedHeader + InlineTopBar

### 7. 不变的部分

- 登录/注册/忘记密码页面（auth layout）：继续使用 SiteHeader 或改用 UnifiedHeader（行为相同，因为在公开站模式下）
- API 鉴权机制：不变
- 控制台侧边栏（ActivityBar）：不变
- 控制台 StatusBar：不变
- 滚动进度条：保留在 UnifiedHeader 中

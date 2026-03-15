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

Header 高度、背景全站统一。

**滚动行为**：
- 公开站模式：保留 `useScrollNav()`（滚动自动隐藏 + 滚动进度条）
- 控制台模式：**不使用** `useScrollNav()`——header 始终固定可见，无进度条。控制台页面的滚动发生在 workspace 内部面板中，而非整个文档。

### 2. 用户菜单

**未登录状态**：
- 右侧显示蓝色实心「登录」按钮，点击跳转 `/login`

**已登录状态**：
- 右侧显示用户头像图标，点击展开下拉菜单：
  - 进入控制台（公开站时显示）/ 返回官网（控制台时显示）
  - 账号设置（→ `/app/settings`）
  - 分隔线
  - 退出登录（调用集中式 `logout()` 函数）

### 3. 控制台布局调整

- **删除 TopBar 组件**：其功能由 UnifiedHeader 和内容区承担
- **面包屑**：从 TopBar 下移到控制台内容区顶部（workspace 区域内）
- **项目切换器**：同样下移到内容区顶部，紧跟面包屑
- **侧边栏（ActivityBar）**：保持不变，继续负责控制台内部导航
- **StatusBar**：保持不变

调整后的控制台布局层级：
```
UnifiedHeader（全站统一，控制台模式下固定不隐藏）
├── console-shell-body
│   ├── ActivityBar（左侧图标栏）
│   └── console-shell-workspace
│       ├── InlineTopBar（面包屑 + 项目切换器 + 汉堡按钮(移动端)）
│       └── [页面内容]
└── StatusBar
```

### 4. 移动端导航

替换现有的 `MobileNav` + `MobileConsoleNav` 两个组件，新建一个 `UnifiedMobileNav` 组件。根据上下文切换展开内容：
- **公开站**：展开公开站导航项（产品、AI 生态、Demo 等）+ 登录/用户菜单
- **控制台**：展开控制台侧边栏导航项（仪表盘、项目、数据集等）+ 用户菜单

### 5. 登录状态检测

引入前端可读的 `auth_state` cookie 作为 UI 状态标记：

- **登录成功时**：前端写 `auth_state=1` cookie（非 HttpOnly，JS 可读，Path=/，SameSite=Lax，Max-Age 与后端 `JWT_EXPIRE_MINUTES` 对齐，默认 3600 秒）
- **退出登录时**：集中式 `logout()` 函数清除 `auth_state` + `mingrun_workspace_id` cookie + 调用 logout API + 跳转首页
- **Header 组件**：读 `auth_state` cookie 决定显示「登录按钮」还是「用户头像菜单」
- **Middleware**：`middleware.ts`（新建，导入并调用 `proxy()` 函数）用 `auth_state` cookie 做 `/app` 路由拦截
- **401 自动清除**：`lib/api.ts` 的 `parseResponse` 在收到 401/403 响应时，除了清除 CSRF 缓存外，同时清除 `auth_state` cookie，防止 token 过期后 UI 仍显示已登录状态
- **安全边界**：`auth_state` 仅用于 UI 展示和路由守卫，真正的 API 鉴权仍由后端 HttpOnly `access_token` cookie 负责。即使用户伪造 `auth_state=1`，API 调用仍会因无有效 `access_token` 而返回 401

**Cookie 重命名**：将现有的 `qihang_workspace_id` cookie 重命名为 `mingrun_workspace_id`，与品牌迁移保持一致。`lib/api.ts` 中的 `WORKSPACE_COOKIE_NAME` 常量同步更新。

### 6. 集中式 logout 函数

在 `lib/api.ts` 中新增 `logout()` 函数，供所有退出登录的调用点使用：

```typescript
export async function logout(): Promise<void> {
  try {
    await apiPost("/api/v1/auth/logout", {});
  } catch {
    // Ignore — clear client state regardless
  }
  clearCookie("auth_state");
  clearCookie("mingrun_workspace_id");
  clearCachedSecurityState();
  window.location.href = "/login";
}
```

所有现有的退出登录调用点（TopBar 用户菜单、设置页、UnifiedHeader 用户菜单）统一改为调用此函数。

### 7. 文件变更清单

**新建：**
- `components/UnifiedHeader.tsx` — 统一 header 组件
- `components/UnifiedMobileNav.tsx` — 统一移动端导航组件
- `components/console/InlineTopBar.tsx` — 控制台内容区顶部的面包屑+项目切换器
- `middleware.ts` — Next.js middleware 入口，导入并调用 `proxy()`

**修改：**
- `app/[locale]/(public)/layout.tsx` — 替换 SiteHeader 为 UnifiedHeader
- `app/[locale]/(console)/layout.tsx` — 替换 ConsoleShell 内的 TopBar 为 UnifiedHeader
- `app/[locale]/(auth)/layout.tsx` — 替换 SiteHeader 为 UnifiedHeader（删除 SiteHeader 后必须更新）
- `components/console/ConsoleShell.tsx` — 移除 TopBar 引用，添加 InlineTopBar
- `lib/api.ts` — 新增 `logout()` 函数，重命名 cookie 常量，401 时清除 `auth_state`
- `proxy.ts` — middleware 改用 `auth_state` 检测
- `messages/zh/common.json` — 新增用户菜单翻译键（进入控制台、返回官网、账号设置、退出登录）
- `messages/en/common.json` — 同上英文翻译
- `app/[locale]/(console)/app/settings/page.tsx` — 退出登录改用集中式 `logout()`

**可删除（功能已合并）：**
- `components/public/SiteHeader.tsx` — 功能合并到 UnifiedHeader
- `components/console/TopBar.tsx` — 功能拆分到 UnifiedHeader + InlineTopBar
- `components/public/MobileNav.tsx` — 功能合并到 UnifiedMobileNav
- `components/console/MobileConsoleNav.tsx` — 功能合并到 UnifiedMobileNav

### 8. 不变的部分

- API 鉴权机制：不变
- 控制台侧边栏（ActivityBar）：不变
- 控制台 StatusBar：不变
- CommandPalette（Cmd+K）：不变，仍在 console layout 中
- Toaster（toast 通知）：不变，仍在 console layout 中
- ProjectProvider：不变，仍包裹 ConsoleShell。UnifiedHeader 不直接依赖 ProjectContext。
- 404 页面（`app/not-found.tsx`、`app/[locale]/not-found.tsx`）：保持独立 header 渲染，不使用 UnifiedHeader

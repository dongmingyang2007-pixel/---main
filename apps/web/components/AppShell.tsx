"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

const nav = [
  { href: "/app", label: "总览", meta: "Dashboard" },
  { href: "/app/projects", label: "项目", meta: "Projects" },
  { href: "/app/datasets", label: "数据集", meta: "Datasets" },
  { href: "/app/train", label: "训练", meta: "Train" },
  { href: "/app/models", label: "模型仓", meta: "Models" },
  { href: "/app/eval", label: "评测", meta: "Eval" },
  { href: "/app/settings", label: "设置", meta: "Settings" },
  { href: "/app/devices", label: "设备", meta: "Devices" },
  { href: "/app/billing", label: "计费", meta: "Billing" },
];

const routeMeta = [
  {
    match: (pathname: string) => pathname === "/app",
    kicker: "Studio Overview",
    title: "数据工作台总览",
    description: "先看状态，再决定下一步进入项目、数据集、训练还是模型仓。",
  },
  {
    match: (pathname: string) => pathname.startsWith("/app/projects"),
    kicker: "Projects",
    title: "项目空间",
    description: "按项目切开数据、训练和模型版本的边界。",
  },
  {
    match: (pathname: string) => pathname.startsWith("/app/datasets"),
    kicker: "Datasets",
    title: "数据集与版本",
    description: "上传样本、冻结版本，再让训练和评测复用同一批数据。",
  },
  {
    match: (pathname: string) => pathname.startsWith("/app/train"),
    kicker: "Train",
    title: "训练作业",
    description: "创建任务，查看状态、日志、指标和产物。",
  },
  {
    match: (pathname: string) => pathname.startsWith("/app/models"),
    kicker: "Models",
    title: "模型仓库",
    description: "登记版本，发布 alias，并保留回滚路径。",
  },
  {
    match: (pathname: string) => pathname.startsWith("/app/eval"),
    kicker: "Eval",
    title: "评测回放",
    description: "对照版本结果，为发布决策提供依据。",
  },
  {
    match: (pathname: string) => pathname.startsWith("/app/settings"),
    kicker: "Settings",
    title: "账户与安全",
    description: "管理账户、安全和后续敏感操作入口。",
  },
  {
    match: (pathname: string) => pathname.startsWith("/app/devices"),
    kicker: "Devices",
    title: "设备与固件",
    description: "为设备绑定、固件版本和硬件诊断预留入口。",
  },
  {
    match: (pathname: string) => pathname.startsWith("/app/billing"),
    kicker: "Billing",
    title: "计费与套餐",
    description: "为后续算力、存储和团队额度管理保留信息架构。",
  },
];

export function AppShell({ title, children }: { title: string; children: ReactNode }) {
  const pathname = usePathname();
  const currentMeta = routeMeta.find((item) => item.match(pathname));

  return (
    <div className="shell-grid console-frame">
      <aside className="console-aside">
        <div className="console-brand">
          <div className="console-kicker text-white/70">QIHANG Studio</div>
          <div className="display-face mt-2">Control Console</div>
          <p className="mt-3 text-sm leading-6 text-white/72">把数据、训练和发布收在一套更安静的工作台里。</p>
          <div className="console-brand-pills">
            <span>离线优先</span>
            <span>可回滚</span>
            <span>可追溯</span>
          </div>
        </div>

        <nav className="console-nav">
          {nav.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={clsx("console-nav-link", isActive && "is-active")}
              >
                <span>{item.label}</span>
                <span className="text-xs text-[var(--muted-soft)]">{item.meta}</span>
              </Link>
            );
          })}
        </nav>

        <div className="console-panel">
          <div className="console-panel-body">
            <div className="console-kicker">Workspace</div>
            <div className="mt-2 text-sm font-semibold text-[var(--fg)]">Personal AI Studio</div>
            <div className="mt-2 text-sm leading-6 text-[var(--muted)]">当前以单 workspace 为主，权限边界仍以后端校验为准。</div>
            <div className="console-side-metadata">
              <span>Signed Access</span>
              <span>Workspace Bound</span>
              <span>Audit Ready</span>
            </div>
          </div>
        </div>
      </aside>
      <main className="console-main">
        <header className="console-header">
          <div className="console-header-copy">
            <div className="console-kicker">{currentMeta?.kicker || "Personal AI Studio"}</div>
            <h1 className="console-title">{currentMeta?.title || title}</h1>
            <p className="console-description">{currentMeta?.description || "统一的数据工作台视图。"}</p>
          </div>
          <div className="console-header-actions">
            <div className="console-header-rail">
              <span>离线优先</span>
              <span>版本可回退</span>
              <span>审计可追溯</span>
            </div>
            <Link className="console-button-secondary" href="/">
              返回官网
            </Link>
          </div>
        </header>
        <div className="console-surface">{children}</div>
      </main>
    </div>
  );
}

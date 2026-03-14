"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { apiPost } from "@/lib/api";

export default function SettingsPage() {
  const [msg, setMsg] = useState("");
  const t = useTranslations("console-settings");

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-6">
          <div>
            <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)] uppercase">
              {t("kicker")}
            </p>
            <h1 className="mt-2 text-2xl font-bold">{t("title")}</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("description")}</p>
          </div>

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <h2 className="console-panel-title">{t("panel.title")}</h2>
            <p className="console-panel-description">{t("panel.description")}</p>
          </div>
        </div>
        <div className="console-panel-body">
          <div className="console-actions">
            <button
              className="console-button"
              onClick={async () => {
                await apiPost("/api/v1/auth/logout", {});
                window.location.href = "/login";
              }}
            >
              退出登录
            </button>
            <button
              className="console-button-danger"
              onClick={() => setMsg("删除流程已受理（v0.1 占位，后端异步清理队列）")}
            >
              发起数据删除
            </button>
          </div>
          {msg ? <div className="console-inline-notice is-success mt-4">{msg}</div> : null}
        </div>
      </section>

      <aside className="console-panel">
        <div className="console-panel-body">
          <div className="console-kicker">Security Notes</div>
          <ul className="site-feature-list mt-4">
            <li>危险请求会自动附带 CSRF 令牌与 `X-Workspace-ID`。</li>
            <li>登录状态由 Cookie 判断，最终权限校验仍以后端为准。</li>
            <li>后续会把 API Key 与设备授权也并入这一页。</li>
          </ul>
        </div>
      </aside>
    </div>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}

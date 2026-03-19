"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { PageTransition } from "@/components/console/PageTransition";
import { apiGet } from "@/lib/api";

type Project = { id: string; name: string };

export default function DashboardPage() {
  const t = useTranslations("console");
  const router = useRouter();
  const [assistants, setAssistants] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void apiGet<{ items: Project[] }>("/api/v1/projects")
      .then((data) => setAssistants(data.items || []))
      .catch(() => setAssistants([]))
      .finally(() => setLoading(false));
  }, []);

  const firstAssistant = assistants[0];

  return (
    <PageTransition>
      <div className="dashboard-consumer">
        {/* Welcome */}
        <div className="dashboard-welcome">
          <h1 className="dashboard-welcome-title">{t("dashboard.welcome")}</h1>
          <p className="dashboard-welcome-sub">{t("dashboard.welcomeSub")}</p>
        </div>

        {/* Assistant card */}
        {firstAssistant && (
          <div className="dashboard-assistant-card" onClick={() => router.push(`/app/assistants/${firstAssistant.id}`)}>
            <div className="dashboard-assistant-avatar">
              <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8V4H8" />
                <rect width={16} height={12} x={4} y={8} rx={2} />
                <path d="M15 13v2" />
                <path d="M9 13v2" />
              </svg>
            </div>
            <div className="dashboard-assistant-info">
              <div className="dashboard-assistant-name">{firstAssistant.name}</div>
              <div className="dashboard-assistant-meta">{t("dashboard.assistantOnline")}</div>
            </div>
            <button
              type="button"
              className="dashboard-chat-btn"
              onClick={(e) => { e.stopPropagation(); router.push("/app/chat"); }}
            >
              {t("dashboard.startChat")}
            </button>
          </div>
        )}

        {/* Stats */}
        <div className="dashboard-stats">
          <div className="dashboard-stat-card">
            <div className="dashboard-stat-value">{assistants.length}</div>
            <div className="dashboard-stat-label">{t("dashboard.stat.assistants")}</div>
          </div>
          <div className="dashboard-stat-card">
            <div className="dashboard-stat-value">-</div>
            <div className="dashboard-stat-label">{t("dashboard.stat.memories")}</div>
          </div>
          <div className="dashboard-stat-card">
            <div className="dashboard-stat-value">-</div>
            <div className="dashboard-stat-label">{t("dashboard.stat.devices")}</div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}

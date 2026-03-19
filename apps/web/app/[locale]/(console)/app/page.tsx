"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { PageTransition } from "@/components/console/PageTransition";
import { apiGet } from "@/lib/api";

type Project = { id: string; name: string };

interface RecentConversation {
  id: string;
  title: string;
  updated_at: string;
}

function formatRelativeTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "";
    if (diffMin < 60) return `${diffMin}m`;
    const diffHrs = Math.floor(diffMin / 60);
    if (diffHrs < 24) return `${diffHrs}h`;
    const diffDays = Math.floor(diffHrs / 24);
    return `${diffDays}d`;
  } catch {
    return "";
  }
}

export default function DashboardPage() {
  const t = useTranslations("console");
  const router = useRouter();
  const [assistants, setAssistants] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [recentChats, setRecentChats] = useState<RecentConversation[]>([]);

  useEffect(() => {
    void apiGet<{ items: Project[] }>("/api/v1/projects")
      .then((data) => setAssistants(data.items || []))
      .catch(() => setAssistants([]))
      .finally(() => setLoading(false));
  }, []);

  const firstAssistant = assistants[0];

  useEffect(() => {
    if (!firstAssistant) return;
    void apiGet<RecentConversation[]>(
      `/api/v1/chat/conversations?project_id=${firstAssistant.id}`,
    )
      .then((data) => {
        const list = Array.isArray(data) ? data : [];
        setRecentChats(list.slice(0, 3));
      })
      .catch(() => setRecentChats([]));
  }, [firstAssistant]);

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

        {/* Recent Conversations */}
        <div className="dashboard-section-title">{t("dashboard.recentChats")}</div>
        <div className="dashboard-recent-list">
          {recentChats.length === 0 ? (
            <div className="dashboard-recent-item" style={{ justifyContent: "center", cursor: "default" }}>
              <span className="dashboard-recent-text" style={{ color: "var(--text-secondary)" }}>
                {t("dashboard.noChats")}
              </span>
            </div>
          ) : (
            recentChats.map((chat) => (
              <Link key={chat.id} href={`/app/chat?conv=${chat.id}`} className="dashboard-recent-item">
                <span className="dashboard-recent-text">
                  {chat.title || t("dashboard.noChats")}
                </span>
                <span className="dashboard-recent-time">
                  {formatRelativeTime(chat.updated_at)}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </PageTransition>
  );
}

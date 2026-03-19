"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { Link } from "@/i18n/navigation";
import { apiGet } from "@/lib/api";

type ProfileTab = "overview" | "personality" | "knowledge" | "models";

interface ProjectData {
  id: string;
  name: string;
  description: string;
  created_at: string;
}

interface ConversationItem {
  id: string;
  title: string;
  updated_at: string;
}

interface ParsedMeta {
  model: string;
  modelTier: string;
  personality: string;
  tags: string[];
  color: string;
  greeting: string;
}

function parseDescription(description: string): ParsedMeta {
  const meta: ParsedMeta = {
    model: "",
    modelTier: "",
    personality: "",
    tags: [],
    color: "accent",
    greeting: "",
  };

  if (!description) return meta;

  const modelMatch = description.match(/\[model:([^|]*)\|([^\]]*)\]/);
  if (modelMatch) {
    meta.model = modelMatch[1];
    meta.modelTier = modelMatch[2];
  }

  const personalityMatch = description.match(/\[personality:([\s\S]*?)\]/);
  if (personalityMatch) {
    meta.personality = personalityMatch[1];
  }

  const tagsMatch = description.match(/\[tags:([^\]]*)\]/);
  if (tagsMatch) {
    meta.tags = tagsMatch[1].split(",").filter(Boolean);
  }

  const colorMatch = description.match(/\[color:([^\]]*)\]/);
  if (colorMatch) {
    meta.color = colorMatch[1];
  }

  const greetingMatch = description.match(/\[greeting:([\s\S]*?)\]/);
  if (greetingMatch) {
    meta.greeting = greetingMatch[1];
  }

  return meta;
}

function formatModelName(modelId: string): string {
  const map: Record<string, string> = {
    "qwen3.5-plus": "Qwen 3.5 Plus",
    "qwen-plus": "Qwen Plus",
    "qwen-max": "Qwen Max",
    "qwen-turbo": "Qwen Turbo",
  };
  return map[modelId] || modelId || "Qwen 3.5 Plus";
}

function formatDate(iso: string): string {
  if (!iso) return "---";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const COLOR_MAP: Record<string, string> = {
  accent: "#c8734a",
  blue: "#3b82f6",
  green: "#22c55e",
  purple: "#a855f7",
  pink: "#ec4899",
  orange: "#f97316",
  red: "#ef4444",
};

function getColorValue(color: string): string {
  return COLOR_MAP[color] || color || "#c8734a";
}

export default function AssistantDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;
  const t = useTranslations("console-assistants");

  const [activeTab, setActiveTab] = useState<ProfileTab>("overview");
  const [project, setProject] = useState<ProjectData | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [proj, convos] = await Promise.all([
          apiGet<ProjectData>(`/api/v1/projects/${projectId}`),
          apiGet<ConversationItem[]>(
            `/api/v1/chat/conversations?project_id=${projectId}`,
          ),
        ]);
        if (cancelled) return;
        setProject(proj);
        setConversations(Array.isArray(convos) ? convos : []);
      } catch {
        if (!cancelled) {
          setProject(null);
          setConversations([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (loading) {
    return (
      <PanelLayout>
        <PageTransition>
          <div className="assistant-profile">
            <div style={{ padding: "40px", textAlign: "center", color: "var(--text-secondary)" }}>
              Loading...
            </div>
          </div>
        </PageTransition>
      </PanelLayout>
    );
  }

  const meta = parseDescription(project?.description || "");
  const colorVal = getColorValue(meta.color);
  const conversationCount = conversations.length;
  const personalityExcerpt = meta.personality
    ? meta.personality.length > 100
      ? meta.personality.slice(0, 100) + "..."
      : meta.personality
    : "";

  const tabs: { key: ProfileTab; label: string }[] = [
    { key: "overview", label: t("profile.tab.overview") },
    { key: "personality", label: t("profile.tab.personality") },
    { key: "knowledge", label: t("profile.tab.knowledge") },
    { key: "models", label: t("profile.tab.models") },
  ];

  return (
    <PanelLayout>
      <PageTransition>
        <div className="assistant-profile">
          {/* ── Header ── */}
          <div className="assistant-profile-header">
            <div
              className="assistant-profile-avatar"
              style={{
                background: `linear-gradient(135deg, ${colorVal}, color-mix(in srgb, ${colorVal} 70%, white))`,
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8V4H8" />
                <rect x="8" y="8" width="8" height="8" rx="1" />
                <path d="M2 12h2M20 12h2M12 2v2M12 20v2" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            </div>

            <div className="assistant-profile-info">
              <h1 className="assistant-profile-name">{project?.name || "---"}</h1>
              {personalityExcerpt && (
                <div className="assistant-profile-tagline">{personalityExcerpt}</div>
              )}
              <div className="assistant-profile-meta">
                <span className="assistant-profile-meta-item">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  {formatDate(project?.created_at || "")}
                </span>
                <span className="assistant-profile-meta-item">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  {conversationCount} {t("profile.stat.conversations")}
                </span>
                <span className="assistant-profile-meta-item">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polygon points="12 6 9 12 15 12" fill="none" />
                    <line x1="12" y1="12" x2="12" y2="18" />
                  </svg>
                  0 {t("profile.stat.memories")}
                </span>
              </div>
            </div>

            <div className="assistant-profile-actions">
              <Link href={`/app/chat?project_id=${projectId}`} className="profile-btn primary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                {t("profile.startChat")}
              </Link>
              <button type="button" className="profile-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                {t("profile.settings")}
              </button>
            </div>
          </div>

          {/* ── Tabs ── */}
          <div className="assistant-profile-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`profile-tab${activeTab === tab.key ? " active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Tab Content ── */}
          {activeTab === "overview" && (
            <div className="profile-grid">
              {/* Personality Card */}
              <div className="profile-card">
                <div className="profile-card-title">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  {t("profile.card.personality")}
                  <button type="button" className="profile-card-action">{t("profile.edit")}</button>
                </div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)", marginBottom: "6px" }}>
                  {meta.tags.length > 0 ? meta.tags.join(", ") : t("profile.customPersonality")}
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  {personalityExcerpt || t("canvas.personalityUnset")}
                </div>
              </div>

              {/* Activity Card */}
              <div className="profile-card">
                <div className="profile-card-title">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                  {t("profile.card.activity")}
                </div>
                <div className="profile-stat-row">
                  <div className="profile-stat-block">
                    <div className="profile-stat-num">{conversationCount}</div>
                    <div className="profile-stat-label">{t("profile.stat.conversations")}</div>
                  </div>
                  <div className="profile-stat-block">
                    <div className="profile-stat-num">&mdash;</div>
                    <div className="profile-stat-label">{t("profile.stat.memories")}</div>
                  </div>
                  <div className="profile-stat-block">
                    <div className="profile-stat-num">&mdash;</div>
                    <div className="profile-stat-label">{t("profile.stat.hours")}</div>
                  </div>
                </div>
              </div>

              {/* Model Config Card */}
              <div className="profile-card">
                <div className="profile-card-title">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <rect x="9" y="9" width="6" height="6" />
                    <line x1="9" y1="1" x2="9" y2="4" />
                    <line x1="15" y1="1" x2="15" y2="4" />
                    <line x1="9" y1="20" x2="9" y2="23" />
                    <line x1="15" y1="20" x2="15" y2="23" />
                    <line x1="20" y1="9" x2="23" y2="9" />
                    <line x1="20" y1="14" x2="23" y2="14" />
                    <line x1="1" y1="9" x2="4" y2="9" />
                    <line x1="1" y1="14" x2="4" y2="14" />
                  </svg>
                  {t("profile.card.models")}
                </div>
                <div className="profile-model-row">
                  <div className="profile-model-icon">LLM</div>
                  <div className="profile-model-info">
                    <div className="profile-model-label">{t("profile.model.llm")}</div>
                    <div className="profile-model-name">{formatModelName(meta.model)}</div>
                  </div>
                  <button type="button" className="profile-model-change">{t("profile.change")}</button>
                </div>
                <div className="profile-model-row">
                  <div className="profile-model-icon">ASR</div>
                  <div className="profile-model-info">
                    <div className="profile-model-label">{t("profile.model.asr")}</div>
                    <div className="profile-model-name">Paraformer-v2</div>
                  </div>
                  <button type="button" className="profile-model-change">{t("profile.change")}</button>
                </div>
                <div className="profile-model-row">
                  <div className="profile-model-icon">TTS</div>
                  <div className="profile-model-info">
                    <div className="profile-model-label">{t("profile.model.tts")}</div>
                    <div className="profile-model-name">CosyVoice-v1</div>
                  </div>
                  <button type="button" className="profile-model-change">{t("profile.change")}</button>
                </div>
              </div>

              {/* Knowledge Card */}
              <div className="profile-card">
                <div className="profile-card-title">
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                  {t("profile.card.knowledge")}
                  <button type="button" className="profile-card-action">{t("profile.manage")}</button>
                </div>
                <div style={{ fontSize: "13px", color: "var(--text-secondary)", padding: "16px 0", textAlign: "center" }}>
                  {t("profile.noFiles")}
                </div>
              </div>
            </div>
          )}

          {activeTab === "personality" && (
            <div style={{ padding: "24px 0", color: "var(--text-secondary)", fontSize: "13px" }}>
              {meta.personality || t("canvas.personalityUnset")}
            </div>
          )}

          {activeTab === "knowledge" && (
            <div style={{ padding: "24px 0", color: "var(--text-secondary)", fontSize: "13px" }}>
              {t("profile.noFiles")}
            </div>
          )}

          {activeTab === "models" && (
            <div style={{ padding: "24px 0", color: "var(--text-secondary)", fontSize: "13px" }}>
              {formatModelName(meta.model)} / Paraformer-v2 / CosyVoice-v1
            </div>
          )}
        </div>
      </PageTransition>
    </PanelLayout>
  );
}

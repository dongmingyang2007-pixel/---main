"use client";

import { Link } from "@/i18n/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { GlassCard } from "@/components/console/glass";
import { apiGet, apiDelete } from "@/lib/api";
import { useProjectSelection } from "@/lib/useProjectSelection";

type Project = { id: string; name: string; description?: string; created_at: string };

/** Strip [model:...] [personality:...] [tags:...] [color:...] metadata from description */
function cleanDescription(desc?: string): string {
  if (!desc) return "";
  return desc
    .replace(/\[model:[^\]]*\]/g, "")
    .replace(/\[personality:[^\]]*\]/g, "")
    .replace(/\[tags:[^\]]*\]/g, "")
    .replace(/\[color:[^\]]*\]/g, "")
    .trim();
}

/** Extract model name from description metadata */
function extractModelName(desc?: string): string | null {
  if (!desc) return null;
  const match = desc.match(/\[model:([^|]*)\|/);
  return match ? match[1] : null;
}

/** Extract color from description metadata */
function extractColor(desc?: string): string {
  if (!desc) return "#6366f1";
  const match = desc.match(/\[color:([^\]]*)\]/);
  const COLOR_MAP: Record<string, string> = {
    accent: "#c8734a",
    blue: "#3b82f6",
    green: "#22c55e",
    purple: "#a855f7",
    pink: "#ec4899",
    orange: "#f97316",
    red: "#ef4444",
  };
  return match ? (COLOR_MAP[match[1]] || match[1] || "#6366f1") : "#6366f1";
}

export default function AssistantsPage() {
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const t = useTranslations("console-assistants");
  const { projectId: selectedProjectId } = useProjectSelection();

  useEffect(() => {
    let active = true;

    void apiGet<{ items: Project[] }>("/api/v1/projects")
      .then((data) => {
        if (!active) return;
        setItems(data.items || []);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const filteredItems = selectedProjectId
    ? items.filter((project) => project.id === selectedProjectId)
    : items;

  return (
    <PageTransition>
      <div className="console-page-shell" style={{ padding: "28px 32px" }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{
            fontSize: 22,
            fontWeight: 700,
            color: "var(--console-text-primary, var(--text-primary))",
            marginBottom: 4,
          }}>{t("title")}</h1>
          <p style={{
            fontSize: 13,
            color: "var(--console-text-secondary, var(--text-secondary))",
          }}>{t("description")}</p>
        </div>

        {loading ? (
          <div className="assistants-glass-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <GlassCard key={i}>
                <div style={{ minHeight: 100 }} className="animate-pulse">
                  <div style={{
                    height: 14,
                    width: "66%",
                    borderRadius: 6,
                    background: "var(--console-border, var(--border))",
                    marginBottom: 12,
                  }} />
                  <div style={{
                    height: 10,
                    width: "100%",
                    borderRadius: 6,
                    background: "var(--console-border, var(--border))",
                  }} />
                </div>
              </GlassCard>
            ))}
          </div>
        ) : (
          <div className="assistants-glass-grid">
            {/* Create New card */}
            <Link href="/app/assistants/new" className="assistants-glass-create-card">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t("createNew")}</span>
            </Link>

            {filteredItems.map((project) => {
              const modelName = extractModelName(project.description);
              const desc = cleanDescription(project.description);
              const color = extractColor(project.description);
              return (
                <Link
                  key={project.id}
                  href={`/app/assistants/${project.id}`}
                  className="assistants-glass-card-link"
                >
                  <GlassCard hover className="assistants-glass-card" style={{ position: "relative" }}>
                    <button
                      type="button"
                      title={t("profile.delete")}
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!window.confirm(t("profile.deleteCardConfirm", { name: project.name }))) return;
                        try {
                          await apiDelete(`/api/v1/projects/${project.id}`);
                          setItems((prev) => prev.filter((p) => p.id !== project.id));
                        } catch {
                          // ignore
                        }
                      }}
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 4,
                        borderRadius: 4,
                        color: "var(--console-text-secondary, var(--text-secondary))",
                        opacity: 0.5,
                        transition: "opacity 0.15s, color 0.15s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = "#ef4444"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; e.currentTarget.style.color = "var(--console-text-secondary, var(--text-secondary))"; }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: "var(--console-radius-md, 12px)",
                          background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 70%, white))`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 8V4H8" />
                          <rect x="8" y="8" width="8" height="8" rx="1" />
                          <path d="M2 12h2M20 12h2M12 2v2M12 20v2" />
                          <circle cx="12" cy="12" r="2" />
                        </svg>
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "var(--console-text-primary, var(--text-primary))",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>{project.name}</div>
                        {modelName && (
                          <div style={{
                            fontSize: 11,
                            color: "var(--console-accent, #6366f1)",
                            fontWeight: 500,
                            marginTop: 1,
                          }}>{modelName}</div>
                        )}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 12,
                      color: "var(--console-text-secondary, var(--text-secondary))",
                      lineHeight: 1.5,
                      overflow: "hidden",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                    }}>
                      {desc || t("noDescription")}
                    </div>
                  </GlassCard>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </PageTransition>
  );
}

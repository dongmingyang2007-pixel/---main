"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";

import { PageTransition } from "@/components/console/PageTransition";
import { GlassCard } from "@/components/console/glass";

export default function DevicesPage() {
  const t = useTranslations("console-devices");
  const [continuous, setContinuous] = useState(false);
  const [noise, setNoise] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const toggleStyle = (on: boolean): React.CSSProperties => ({
    position: "relative",
    display: "inline-flex",
    height: 24,
    width: 44,
    flexShrink: 0,
    borderRadius: 9999,
    border: "none",
    cursor: "pointer",
    transition: "background 0.2s ease",
    background: on
      ? "var(--console-accent, var(--accent))"
      : "var(--console-border, var(--border))",
    padding: 0,
  });

  const toggleKnobStyle = (on: boolean): React.CSSProperties => ({
    display: "inline-block",
    height: 20,
    width: 20,
    borderRadius: 9999,
    background: "white",
    boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
    transform: on ? "translateX(22px)" : "translateX(2px)",
    transition: "transform 0.2s ease",
    marginTop: 2,
  });

  const settingRow: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 0",
    borderBottom: "1px solid var(--console-border, var(--border))",
  };

  const settingLabel: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 500,
    color: "var(--console-text-primary, var(--text-primary))",
  };

  const settingDesc: React.CSSProperties = {
    fontSize: 11,
    color: "var(--console-text-secondary, var(--text-secondary))",
    marginTop: 2,
  };

  const selectStyle: React.CSSProperties = {
    padding: "5px 10px",
    fontSize: 12,
    borderRadius: 8,
    border: "1px solid var(--console-border, var(--border))",
    background: "var(--console-surface, rgba(255,255,255,0.06))",
    color: "var(--console-text-primary, var(--text-primary))",
    cursor: "pointer",
  };

  const actionBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 9999,
    border: "1px solid var(--console-border, var(--border))",
    background: "var(--console-surface, rgba(255,255,255,0.06))",
    color: "var(--console-text-secondary, var(--text-secondary))",
    cursor: "pointer",
    transition: "all 0.15s ease",
  };

  const sectionTitle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--console-text-primary, var(--text-primary))",
    marginBottom: 12,
  };

  return (
    <PageTransition>
      <div className="console-page-shell" style={{ padding: "28px 32px", maxWidth: 900 }}>
        {/* ── Top Bar ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <h1 style={{
            fontSize: 22,
            fontWeight: 700,
            color: "var(--console-text-primary, var(--text-primary))",
          }}>{t("title")}</h1>
          <button style={{
            ...actionBtn,
            background: "linear-gradient(135deg, var(--console-accent, var(--accent)), color-mix(in srgb, var(--console-accent, var(--accent)) 80%, white))",
            color: "#fff",
            border: "1px solid transparent",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t("addDevice")}
          </button>
        </div>

        {/* ── Device Hero Card ── */}
        <GlassCard className="devices-hero-glass">
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
            {/* Left: Visual */}
            <div style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 100,
              height: 100,
              borderRadius: "var(--console-radius-lg, 16px)",
              background: "var(--console-surface, rgba(255,255,255,0.04))",
              border: "1px solid var(--console-border, var(--border))",
              flexShrink: 0,
              position: "relative",
            }}>
              <svg width="56" height="56" viewBox="0 0 80 80" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 40C14 25.6406 25.6406 14 40 14C54.3594 14 66 25.6406 66 40V52" />
                <rect x="10" y="44" width="12" height="22" rx="4" fill="color-mix(in srgb, var(--accent) 15%, transparent)" stroke="var(--accent)" />
                <rect x="58" y="44" width="12" height="22" rx="4" fill="color-mix(in srgb, var(--accent) 15%, transparent)" stroke="var(--accent)" />
                <path d="M22 55H26C28 55 30 53 30 51V49" stroke="var(--text-secondary)" />
                <path d="M58 55H54C52 55 50 53 50 51V49" stroke="var(--text-secondary)" />
              </svg>
              <span style={{
                position: "absolute",
                bottom: 8,
                right: 8,
                width: 10,
                height: 10,
                borderRadius: 9999,
                background: "var(--success, #22c55e)",
                boxShadow: "0 0 6px var(--success, #22c55e)",
              }} />
            </div>

            {/* Right: Info */}
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <span style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "var(--console-text-primary, var(--text-primary))",
                }}>{t("deviceName")}</span>
                <span style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 9999,
                  background: "rgba(34,197,94,0.12)",
                  color: "var(--success, #22c55e)",
                }}>{t("connected")}</span>
              </div>
              <div style={{
                fontSize: 12,
                color: "var(--console-text-secondary, var(--text-secondary))",
                marginBottom: 16,
              }}>{t("modelInfo")}</div>

              {/* Stats */}
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
                {[
                  { value: "78%", label: t("stat.battery"), pct: 78, color: "var(--success)" },
                  { value: "4.2h", label: t("stat.usage"), pct: 52, color: "var(--accent)" },
                  { value: "23", label: t("stat.conversations"), pct: 38, color: "var(--accent)" },
                ].map((stat) => (
                  <div key={stat.label} style={{ minWidth: 80 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--console-text-primary, var(--text-primary))" }}>{stat.value}</div>
                    <div style={{ fontSize: 11, color: "var(--console-text-secondary, var(--text-secondary))", marginBottom: 4 }}>{stat.label}</div>
                    <div style={{
                      height: 4,
                      borderRadius: 9999,
                      background: "var(--console-border, var(--border))",
                      overflow: "hidden",
                    }}>
                      <div style={{ height: "100%", width: `${stat.pct}%`, borderRadius: 9999, background: stat.color }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={actionBtn} onClick={() => showToast(t("toast.checkUpdate"))}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  {t("action.checkUpdate")}
                </button>
                <button style={actionBtn} onClick={() => showToast(t("toast.settings"))}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  {t("action.settings")}
                </button>
                <button style={actionBtn} onClick={() => showToast(t("toast.info"))}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  {t("action.info")}
                </button>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* ── Settings Grid ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 20 }}>
          {/* Voice Settings */}
          <GlassCard>
            <div style={sectionTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              {t("voice.title")}
            </div>

            <div style={settingRow}>
              <div>
                <div style={settingLabel}>{t("voice.wakeWord")}</div>
              </div>
              <select style={selectStyle} defaultValue="hey">
                <option value="hey">{"\u563F\uFF0C\u5C0F\u94ED"}</option>
              </select>
            </div>

            <div style={settingRow}>
              <div>
                <div style={settingLabel}>{t("voice.language")}</div>
              </div>
              <select style={selectStyle} defaultValue="zh">
                <option value="zh">{"\u4E2D\u6587"}</option>
                <option value="en">English</option>
              </select>
            </div>

            <div style={{ ...settingRow, borderBottom: "none" }}>
              <div>
                <div style={settingLabel}>{t("voice.continuous")}</div>
                <div style={settingDesc}>{t("voice.continuousDesc")}</div>
              </div>
              <button
                type="button"
                style={toggleStyle(continuous)}
                aria-label={t("voice.continuous")}
                onClick={() => setContinuous(v => !v)}
              >
                <span style={toggleKnobStyle(continuous)} />
              </button>
            </div>
          </GlassCard>

          {/* Audio Settings */}
          <GlassCard>
            <div style={sectionTitle}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
              {t("audio.title")}
            </div>

            <div style={settingRow}>
              <div>
                <div style={settingLabel}>{t("audio.voice")}</div>
                <div style={settingDesc}>{t("audio.voiceDesc")}</div>
              </div>
              <select style={selectStyle} defaultValue="gentle">
                <option value="gentle">{"\u6E29\u67D4\u5973\u58F0"}</option>
              </select>
            </div>

            <div style={settingRow}>
              <div>
                <div style={settingLabel}>{t("audio.speed")}</div>
              </div>
              <select style={selectStyle} defaultValue="normal">
                <option value="normal">{"\u6B63\u5E38"}</option>
              </select>
            </div>

            <div style={{ ...settingRow, borderBottom: "none" }}>
              <div>
                <div style={settingLabel}>{t("audio.noise")}</div>
                <div style={settingDesc}>{t("audio.noiseDesc")}</div>
              </div>
              <button
                type="button"
                style={toggleStyle(noise)}
                aria-label={t("audio.noise")}
                onClick={() => setNoise(v => !v)}
              >
                <span style={toggleKnobStyle(noise)} />
              </button>
            </div>
          </GlassCard>
        </div>
      </div>

      {toast && (
        <div style={{
          position: "fixed",
          bottom: 24,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "8px 20px",
          borderRadius: 9999,
          fontSize: 13,
          fontWeight: 500,
          background: "var(--console-surface, rgba(30,30,30,0.9))",
          color: "var(--console-text-primary, var(--text-primary))",
          border: "1px solid var(--console-border, var(--border))",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          zIndex: 1000,
        }}>{toast}</div>
      )}
    </PageTransition>
  );
}

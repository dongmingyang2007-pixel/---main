"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import clsx from "clsx";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";

export default function DevicesPage() {
  const t = useTranslations("console-devices");
  const [continuous, setContinuous] = useState(false);
  const [noise, setNoise] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  return (
    <PanelLayout>
      <PageTransition>
        <div className="devices-page">
          {/* ── Top Bar ── */}
          <div className="devices-topbar">
            <h1 className="devices-topbar-title">{t("title")}</h1>
            <button className="devices-add-btn">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              {t("addDevice")}
            </button>
          </div>

          {/* ── Device Hero Card ── */}
          <div className="device-hero">
            {/* Left: Visual */}
            <div className="device-visual">
              <svg viewBox="0 0 80 80" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 40C14 25.6406 25.6406 14 40 14C54.3594 14 66 25.6406 66 40V52" />
                <rect x="10" y="44" width="12" height="22" rx="4" fill="color-mix(in srgb, var(--accent) 15%, transparent)" stroke="var(--accent)" />
                <rect x="58" y="44" width="12" height="22" rx="4" fill="color-mix(in srgb, var(--accent) 15%, transparent)" stroke="var(--accent)" />
                <path d="M22 55H26C28 55 30 53 30 51V49" stroke="var(--text-secondary)" />
                <path d="M58 55H54C52 55 50 53 50 51V49" stroke="var(--text-secondary)" />
              </svg>
              <span className="device-pulse" />
            </div>

            {/* Right: Info */}
            <div className="device-info">
              <div className="device-name-row">
                <span className="device-name">{t("deviceName")}</span>
                <span className="device-status-badge">{t("connected")}</span>
              </div>
              <div className="device-model-info">{t("modelInfo")}</div>

              {/* Stats */}
              <div className="device-stats">
                <div className="device-stat">
                  <div className="device-stat-value">78%</div>
                  <div className="device-stat-label">{t("stat.battery")}</div>
                  <div className="device-stat-bar">
                    <div className="device-stat-fill" style={{ width: "78%", background: "var(--success)" }} />
                  </div>
                </div>
                <div className="device-stat">
                  <div className="device-stat-value">4.2h</div>
                  <div className="device-stat-label">{t("stat.usage")}</div>
                  <div className="device-stat-bar">
                    <div className="device-stat-fill" style={{ width: "52%", background: "var(--accent)" }} />
                  </div>
                </div>
                <div className="device-stat">
                  <div className="device-stat-value">23</div>
                  <div className="device-stat-label">{t("stat.conversations")}</div>
                  <div className="device-stat-bar">
                    <div className="device-stat-fill" style={{ width: "38%", background: "var(--accent)" }} />
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="device-actions">
                <button className="device-action-btn" onClick={() => showToast(t("toast.checkUpdate"))}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1 4 1 10 7 10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  {t("action.checkUpdate")}
                </button>
                <button className="device-action-btn" onClick={() => showToast(t("toast.settings"))}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  {t("action.settings")}
                </button>
                <button className="device-action-btn" onClick={() => showToast(t("toast.info"))}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  {t("action.info")}
                </button>
              </div>
            </div>
          </div>

          {/* ── Settings Grid ── */}
          <div className="device-settings-grid">
            {/* Voice Settings */}
            <div className="device-settings-card">
              <div className="device-settings-title">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
                {t("voice.title")}
              </div>

              <div className="device-setting-row">
                <div>
                  <div className="device-setting-label">{t("voice.wakeWord")}</div>
                </div>
                <select className="device-setting-select" defaultValue="hey">
                  <option value="hey">{"\u563F\uFF0C\u5C0F\u94ED"}</option>
                </select>
              </div>

              <div className="device-setting-row">
                <div>
                  <div className="device-setting-label">{t("voice.language")}</div>
                </div>
                <select className="device-setting-select" defaultValue="zh">
                  <option value="zh">{"\u4E2D\u6587"}</option>
                  <option value="en">English</option>
                </select>
              </div>

              <div className="device-setting-row">
                <div>
                  <div className="device-setting-label">{t("voice.continuous")}</div>
                  <div className="device-setting-desc">{t("voice.continuousDesc")}</div>
                </div>
                <button type="button" className={clsx("device-toggle", continuous && "on")} aria-label={t("voice.continuous")} onClick={() => setContinuous(v => !v)} />
              </div>
            </div>

            {/* Audio Settings */}
            <div className="device-settings-card">
              <div className="device-settings-title">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
                {t("audio.title")}
              </div>

              <div className="device-setting-row">
                <div>
                  <div className="device-setting-label">{t("audio.voice")}</div>
                  <div className="device-setting-desc">{t("audio.voiceDesc")}</div>
                </div>
                <select className="device-setting-select" defaultValue="gentle">
                  <option value="gentle">{"\u6E29\u67D4\u5973\u58F0"}</option>
                </select>
              </div>

              <div className="device-setting-row">
                <div>
                  <div className="device-setting-label">{t("audio.speed")}</div>
                </div>
                <select className="device-setting-select" defaultValue="normal">
                  <option value="normal">{"\u6B63\u5E38"}</option>
                </select>
              </div>

              <div className="device-setting-row">
                <div>
                  <div className="device-setting-label">{t("audio.noise")}</div>
                  <div className="device-setting-desc">{t("audio.noiseDesc")}</div>
                </div>
                <button type="button" className={clsx("device-toggle", noise && "on")} aria-label={t("audio.noise")} onClick={() => setNoise(v => !v)} />
              </div>
            </div>
          </div>
        </div>
        {toast && (
          <div className="device-toast">{toast}</div>
        )}
      </PageTransition>
    </PanelLayout>
  );
}

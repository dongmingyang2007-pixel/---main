"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRealtimeVoice } from "@/hooks/useRealtimeVoice";
import { useSyntheticRealtimeVoice } from "@/hooks/useSyntheticRealtimeVoice";
import type { ChatMode } from "./chat-types";

interface RealtimeVoicePanelProps {
  chatMode: ChatMode; // "omni_realtime" | "synthetic_realtime"
  conversationId: string;
  projectId: string;
  allowVideoInput?: boolean;
  onTurnComplete: (payload: { userText: string; assistantText: string }) => void;
  onTranscriptUpdate: (payload: {
    role: "user" | "assistant";
    text: string;
    final: boolean;
    action?: "upsert" | "discard";
  }) => void;
  onError: (msg: string) => void;
  onStateChange: (state: string) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function WaveformBars({ levels, barCount = 5 }: { levels: number[]; barCount?: number }) {
  return (
    <div className={`rt-waveform${barCount > 5 ? " is-large" : ""}`}>
      {Array.from({ length: barCount }, (_, i) => (
        <div
          key={i}
          className="rt-waveform-bar"
          style={{ height: `${(levels[i % levels.length] || 0.15) * 100}%` }}
        />
      ))}
    </div>
  );
}

/** Convert volume (0-1) to an array of bar levels for WaveformBars */
function volumeToLevels(volume: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const base = 0.15;
    const h = base + volume * (1 + Math.sin(i * 1.2)) * 0.42;
    return Math.min(h, 1);
  });
}

export default function RealtimeVoicePanel({
  chatMode,
  conversationId,
  projectId,
  allowVideoInput = false,
  onTurnComplete,
  onTranscriptUpdate,
  onError,
  onStateChange,
}: RealtimeVoicePanelProps) {
  const t = useTranslations("console-chat");
  const [expanded, setExpanded] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);

  const isSynthetic = chatMode === "synthetic_realtime";

  const handleRealtimeError = useCallback(
    (msg: string) => {
      const friendlyMessage =
        msg === "model_api_unconfigured" ? t("errors.modelUnconfigured") : msg;
      console.error("[RealtimeVoicePanel]", friendlyMessage);
      onError(friendlyMessage);
    },
    [onError, t],
  );

  // IMPORTANT: Both hooks must be called unconditionally to satisfy React's
  // rules of hooks. Both start idle; only the active one's connect() is called.
  const omni = useRealtimeVoice({
    conversationId,
    projectId,
    onTurnComplete,
    onTranscriptUpdate,
    onError: handleRealtimeError,
  });

  const synthetic = useSyntheticRealtimeVoice({
    conversationId,
    projectId,
    onTurnComplete,
    onTranscriptUpdate,
    onError: handleRealtimeError,
  });

  // Select active hook result based on chatMode
  const active = isSynthetic ? synthetic : omni;
  const {
    state,
    transcript,
    timer,
    connect,
    disconnect,
    toggleMute,
    isMuted,
    userVolume,
    aiVolume,
  } = active;

  // Synthetic-only fields
  const pendingMedia = isSynthetic ? synthetic.pendingMedia : null;
  const attachMediaFile = synthetic.attachMediaFile;
  const clearPendingMedia = synthetic.clearPendingMedia;

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  useEffect(() => {
    onStateChange(state);
  }, [onStateChange, state]);

  const isListening = state === "listening" || state === "ready";
  const isSpeaking = state === "ai_speaking";

  // Derive status class for the dot indicator
  const statusClass = isMuted
    ? "muted"
    : isSpeaking
      ? "speaking"
      : isListening
        ? "listening"
        : state === "connecting" || state === "reconnecting"
          ? "connecting"
          : state === "error"
            ? "error"
            : "idle";

  const waveformLevels = volumeToLevels(isListening ? userVolume : aiVolume, 8);

  const entryLabel = isSynthetic ? t("syntheticEntry") : t("realtimeEntry");

  const handleHangup = useCallback(() => {
    setExpanded(false);
    disconnect();
  }, [disconnect]);

  // ─── Idle / error state: entry capsule ────────────────────────
  if (state === "idle" || state === "error") {
    return (
      <div className="rt-float">
        <button className="rt-capsule" onClick={connect} style={{ cursor: "pointer" }}>
          <span className="rt-capsule-label">
            {state === "error" ? t("realtimeRetry") : entryLabel}
          </span>
        </button>
      </div>
    );
  }

  // ─── Active + collapsed: capsule with info ────────────────────
  if (!expanded) {
    return (
      <div className="rt-float">
        <div className="rt-capsule">
          <span className={`rt-status-dot is-${statusClass}`} />
          <span className="rt-capsule-label">
            {t("realtimeTitle") || "AI \u52A9\u624B"}
          </span>
          <span className="rt-capsule-timer">{formatTime(timer)}</span>
          <WaveformBars levels={waveformLevels} barCount={3} />
          <button
            className="rt-capsule-expand"
            onClick={() => setExpanded(true)}
          >
            ━
          </button>
        </div>
      </div>
    );
  }

  // ─── Active + expanded: card ──────────────────────────────────
  return (
    <div className="rt-float">
      {/* Hidden file inputs for synthetic media */}
      {isSynthetic && (
        <>
          <input
            ref={uploadRef}
            type="file"
            accept={allowVideoInput ? "image/*,video/*" : "image/*"}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file && (allowVideoInput || !file.type.startsWith("video/"))) {
                void attachMediaFile(file);
              }
              event.target.value = "";
            }}
          />
          <input
            ref={captureRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void attachMediaFile(file);
              }
              event.target.value = "";
            }}
          />
        </>
      )}

      <div className="rt-card">
        <div className="rt-card-header">
          <span className={`rt-status-dot is-${statusClass}`} />
          <span className="rt-card-title">
            {t("realtimeTitle") || "AI \u52A9\u624B"}
          </span>
          <span className="rt-card-timer">{formatTime(timer)}</span>
          <button className="rt-card-collapse" onClick={() => setExpanded(false)}>
            ━
          </button>
        </div>

        <WaveformBars levels={waveformLevels} barCount={8} />

        <div className="rt-card-transcript" ref={transcriptRef}>
          {transcript.slice(-2).map((entry, i) => (
            <div
              key={i}
              className={`rt-card-transcript-line${entry.role === "user" ? " is-user" : ""}`}
            >
              {entry.text}
              {!entry.final && <span className="rt-cursor">▊</span>}
            </div>
          ))}
        </div>

        <div className="rt-card-controls">
          <button
            className={`rt-card-control-btn${isMuted ? " is-muted" : ""}`}
            onClick={toggleMute}
            title={isMuted ? t("realtimeUnmute") : t("realtimeMute")}
          >
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              {isMuted && <line x1="1" y1="1" x2="23" y2="23" stroke="#ef4444" strokeWidth={2.5} />}
            </svg>
          </button>

          <button className="rt-card-hangup" onClick={handleHangup}>
            <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor">
              <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth={2.5} />
              <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth={2.5} />
            </svg>
          </button>

          {isSynthetic ? (
            <button
              className="rt-card-control-btn"
              title={t("syntheticUpload")}
              onClick={() => uploadRef.current?.click()}
            >
              <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </button>
          ) : (
            <button className="rt-card-control-btn" title={t("realtimeSpeaker")}>
              <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={2}>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            </button>
          )}
        </div>

        {/* Media bar for synthetic mode */}
        {isSynthetic && pendingMedia && (
          <div className="rt-card-media">
            <span className="profile-model-badge">
              {pendingMedia.kind === "video" ? t("syntheticVideo") : t("syntheticImage")}
            </span>
            <span>{pendingMedia.filename}</span>
            <button type="button" className="chat-audio-btn" onClick={clearPendingMedia}>
              {t("syntheticClearMedia")}
            </button>
          </div>
        )}

        {/* Synthetic-only: media toolbar */}
        {isSynthetic && (
          <div className="rt-media-toolbar">
            <button
              type="button"
              className="chat-audio-btn"
              onClick={() => uploadRef.current?.click()}
            >
              {allowVideoInput ? t("syntheticUpload") : t("syntheticUploadImageOnly")}
            </button>
            <button
              type="button"
              className="chat-audio-btn"
              onClick={() => captureRef.current?.click()}
            >
              {t("syntheticCapture")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

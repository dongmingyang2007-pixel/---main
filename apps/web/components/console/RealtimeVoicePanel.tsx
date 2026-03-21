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

function WaveformBars({ volume, color }: { volume: number; color: string }) {
  const barCount = 5;
  const bars = Array.from({ length: barCount }, (_, i) => {
    const base = 4;
    const maxH = 20;
    const h = base + volume * maxH * (1 + Math.sin(i * 1.2)) * 0.5;
    return Math.min(h, maxH);
  });

  return (
    <div className="rt-waveform">
      {bars.map((h, i) => (
        <div
          key={i}
          className="rt-waveform-bar"
          style={{ height: `${h}px`, backgroundColor: color }}
        />
      ))}
    </div>
  );
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

  const indicatorColor = isListening ? "#22c55e" : isSpeaking ? "#818cf8" : "#64748b";
  const waveColor = isListening ? "#4ade80" : "#818cf8";

  const statusText = isSynthetic
    ? state === "connecting"
      ? t("syntheticPreparing")
      : state === "reconnecting"
        ? t("realtimeReconnecting")
        : isListening
          ? t("syntheticListening")
          : isSpeaking
            ? t("syntheticSpeaking")
            : state === "error"
              ? t("realtimeConnectionFailed")
              : ""
    : state === "connecting"
      ? t("realtimePreparing")
      : state === "reconnecting"
        ? t("realtimeReconnecting")
        : isListening
          ? t("realtimeListening")
          : isSpeaking
            ? t("realtimeSpeaking")
            : state === "error"
              ? t("realtimeConnectionFailed")
              : "";

  const entryLabel = isSynthetic ? t("syntheticEntry") : t("realtimeEntry");
  const panelTitle = isSynthetic ? t("syntheticAssistant") : t("realtimeAssistant");

  // Idle / error state: entry button
  if (state === "idle" || state === "error") {
    return (
      <div className="rt-float rt-entry" onClick={connect}>
        <span className="rt-entry-icon">
          <svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          </svg>
        </span>
        <span className="rt-entry-label">
          {state === "error" ? t("realtimeRetry") : entryLabel}
        </span>
      </div>
    );
  }

  // Active state: collapsed pill
  if (!expanded) {
    return (
      <div className="rt-float rt-pill" onClick={() => setExpanded(true)}>
        <div className="rt-indicator" style={{ backgroundColor: indicatorColor }} />
        {state === "connecting" ? (
          <div className="rt-spinner" />
        ) : (
          <WaveformBars volume={isListening ? userVolume : aiVolume} color={waveColor} />
        )}
        <span className="rt-pill-status">{statusText}</span>
        <span className="rt-pill-timer">{formatTime(timer)}</span>
        <button
          className="rt-hangup-small"
          onClick={(e) => {
            e.stopPropagation();
            disconnect();
          }}
        >
          ✕
        </button>
      </div>
    );
  }

  // Expanded panel
  return (
    <div className="rt-float rt-panel">
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

      <div className="rt-panel-header">
        <div className="rt-panel-header-left">
          <div className="rt-indicator" style={{ backgroundColor: indicatorColor }} />
          <span className="rt-panel-title">{panelTitle}</span>
          <span className="rt-panel-timer">{formatTime(timer)}</span>
        </div>
        <button className="rt-collapse-btn" onClick={() => setExpanded(false)}>
          −
        </button>
      </div>

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
          {pendingMedia ? (
            <button type="button" className="chat-audio-btn" onClick={clearPendingMedia}>
              {t("syntheticClearMedia")}
            </button>
          ) : null}
        </div>
      )}

      {/* Synthetic-only: pending media badge */}
      {isSynthetic && pendingMedia ? (
        <div className="rt-pending-media">
          <span className="profile-model-badge">
            {pendingMedia.kind === "video" ? t("syntheticVideo") : t("syntheticImage")}
          </span>
          <span>{pendingMedia.filename}</span>
        </div>
      ) : null}

      <div className="rt-transcript" ref={transcriptRef}>
        {transcript.map((entry, i) => (
          <div key={i} className={`rt-transcript-entry rt-transcript-${entry.role}`}>
            <div className="rt-transcript-label">
              {entry.role === "user" ? t("realtimeUser") : t("realtimeAI")}
            </div>
            <div className="rt-transcript-bubble">
              {entry.text}
              {!entry.final && <span className="rt-cursor">▊</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="rt-controls">
        <button
          className={`rt-control-btn ${isMuted ? "rt-muted" : ""}`}
          onClick={toggleMute}
          title={isMuted ? t("realtimeUnmute") : t("realtimeMute")}
        >
          {isMuted ? (
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .74-.11 1.45-.32 2.12" />
            </svg>
          ) : (
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            </svg>
          )}
        </button>
        <button className="rt-hangup" onClick={disconnect}>
          ✕
        </button>
        {isSynthetic ? (
          <button
            className="rt-control-btn"
            title={t("syntheticUpload")}
            onClick={() => uploadRef.current?.click()}
          >
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </button>
        ) : (
          <button className="rt-control-btn" title={t("realtimeSpeaker")}>
            <svg
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRealtimeVoice } from "@/hooks/useRealtimeVoice";

interface RealtimeVoiceProps {
  conversationId: string;
  projectId: string;
  onTurnComplete?: (payload: { userText: string; assistantText: string }) => void;
  onError?: (message: string) => void;
  onStateChange?: (state: string) => void;
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

export default function RealtimeVoice({
  conversationId,
  projectId,
  onTurnComplete,
  onError,
  onStateChange,
}: RealtimeVoiceProps) {
  const t = useTranslations("console-chat");
  const [expanded, setExpanded] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const handleRealtimeError = useCallback((msg: string) => {
    console.error("[RealtimeVoice]", msg);
    onError?.(msg);
  }, [onError]);

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
  } = useRealtimeVoice({
    conversationId,
    projectId,
    onTurnComplete,
    onError: handleRealtimeError,
  });

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  useEffect(() => {
    onStateChange?.(state);
  }, [onStateChange, state]);

  const isListening = state === "listening" || state === "ready";
  const isSpeaking = state === "ai_speaking";

  const indicatorColor = isListening ? "#22c55e" : isSpeaking ? "#818cf8" : "#64748b";
  const waveColor = isListening ? "#4ade80" : "#818cf8";
  const statusText =
    state === "connecting"
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

  // Idle / error state: entry button
  if (state === "idle" || state === "error") {
    return (
      <div className="rt-float rt-entry" onClick={connect}>
        <span className="rt-entry-icon"><svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg></span>
        <span className="rt-entry-label">
          {state === "error" ? t("realtimeRetry") : t("realtimeEntry")}
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
      <div className="rt-panel-header">
        <div className="rt-panel-header-left">
          <div className="rt-indicator" style={{ backgroundColor: indicatorColor }} />
          <span className="rt-panel-title">{t("realtimeAssistant")}</span>
          <span className="rt-panel-timer">{formatTime(timer)}</span>
        </div>
        <button className="rt-collapse-btn" onClick={() => setExpanded(false)}>
          −
        </button>
      </div>

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
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .74-.11 1.45-.32 2.12"/></svg>
          ) : (
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
          )}
        </button>
        <button className="rt-hangup" onClick={disconnect}>
          ✕
        </button>
        <button className="rt-control-btn" title={t("realtimeSpeaker")}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        </button>
      </div>
    </div>
  );
}

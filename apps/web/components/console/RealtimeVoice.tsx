"use client";

import { useEffect, useRef, useState } from "react";
import { useRealtimeVoice, type RealtimeState } from "@/hooks/useRealtimeVoice";

interface RealtimeVoiceProps {
  conversationId: string;
  projectId: string;
  workspaceId: string;
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
  workspaceId,
}: RealtimeVoiceProps) {
  const [expanded, setExpanded] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);

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
    workspaceId,
    onError: (msg) => console.error("[RealtimeVoice]", msg),
  });

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript]);

  const isActive = state !== "idle" && state !== "error";
  const isListening = state === "listening" || state === "ready";
  const isSpeaking = state === "ai_speaking";

  const indicatorColor = isListening ? "#22c55e" : isSpeaking ? "#818cf8" : "#64748b";
  const waveColor = isListening ? "#4ade80" : "#818cf8";
  const statusText =
    state === "connecting"
      ? "正在准备..."
      : state === "reconnecting"
        ? "重连中..."
        : isListening
          ? "聆听中"
          : isSpeaking
            ? "回复中"
            : state === "error"
              ? "连接失败"
              : "";

  // Idle / error state: entry button
  if (state === "idle" || state === "error") {
    return (
      <div className="rt-float rt-entry" onClick={connect}>
        <span className="rt-entry-icon">🎙</span>
        <span className="rt-entry-label">
          {state === "error" ? "重试对话" : "实时对话"}
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
          <span className="rt-panel-title">AI 助手</span>
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
              {entry.role === "user" ? "你" : "AI"}
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
          title={isMuted ? "取消静音" : "静音"}
        >
          {isMuted ? "🔇" : "🎤"}
        </button>
        <button className="rt-hangup" onClick={disconnect}>
          ✕
        </button>
        <button className="rt-control-btn" title="扬声器">
          🔊
        </button>
      </div>
    </div>
  );
}

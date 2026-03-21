"use client";

import { useCallback, useRef, useState } from "react";
import {
  useRealtimeVoiceBase,
  type RealtimeState,
  type TranscriptEntry,
} from "./useRealtimeVoiceBase";

export type SyntheticRealtimeState = RealtimeState;

export interface SyntheticPendingMedia {
  kind: "image" | "video";
  filename: string;
  mimeType: string;
  dataUrl: string;
}

interface UseSyntheticRealtimeVoiceOptions {
  conversationId: string;
  projectId: string;
  onError?: (msg: string) => void;
  onTurnComplete?: (payload: {
    userText: string;
    assistantText: string;
  }) => void;
  onTranscriptUpdate?: (payload: {
    role: "user" | "assistant";
    text: string;
    final: boolean;
    action?: "upsert" | "discard";
  }) => void;
}

interface UseSyntheticRealtimeVoiceReturn {
  state: SyntheticRealtimeState;
  transcript: TranscriptEntry[];
  timer: number;
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  isMuted: boolean;
  userVolume: number;
  aiVolume: number;
  pendingMedia: SyntheticPendingMedia | null;
  attachMediaFile: (file: File) => Promise<void>;
  clearPendingMedia: () => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("failed_to_read_file"));
    reader.readAsDataURL(file);
  });
}

export function useSyntheticRealtimeVoice({
  conversationId,
  projectId,
  onError,
  onTurnComplete,
  onTranscriptUpdate,
}: UseSyntheticRealtimeVoiceOptions): UseSyntheticRealtimeVoiceReturn {
  const [pendingMedia, setPendingMedia] = useState<SyntheticPendingMedia | null>(null);
  const pendingMediaRef = useRef<SyntheticPendingMedia | null>(null);

  const sendPendingMedia = useCallback((ws: WebSocket) => {
    const media = pendingMediaRef.current;
    if (!media || ws.readyState !== WebSocket.OPEN) return;
    ws.send(
      JSON.stringify({
        type: "media.set",
        data_url: media.dataUrl,
        filename: media.filename,
      }),
    );
  }, []);

  const base = useRealtimeVoiceBase({
    conversationId,
    projectId,
    wsPath: "/api/v1/realtime/composed-voice",
    audioSendMode: "vad-gated",
    enableInterrupt: true,
    vadConfig: {
      speechThreshold: "auto",
      silenceCommitMs: 420,
    },
    onError,
    onTurnComplete,
    onTranscriptUpdate,
    onSessionReady: sendPendingMedia,
    onCustomMessage: (data) => {
      if (data.type === "media.attached") {
        // acknowledged by server, nothing to do
      } else if (data.type === "media.cleared") {
        setPendingMedia(null);
        pendingMediaRef.current = null;
      }
    },
  });

  const attachMediaFile = useCallback(
    async (file: File) => {
      const dataUrl = await readFileAsDataUrl(file);
      const nextMedia: SyntheticPendingMedia = {
        kind: file.type.startsWith("video/") ? "video" : "image",
        filename: file.name,
        mimeType:
          file.type || (file.name.toLowerCase().endsWith(".mp4") ? "video/mp4" : "image/jpeg"),
        dataUrl,
      };
      pendingMediaRef.current = nextMedia;
      setPendingMedia(nextMedia);

      base.sendJson({
        type: "media.set",
        data_url: nextMedia.dataUrl,
        filename: nextMedia.filename,
      });
    },
    [base],
  );

  const clearPendingMedia = useCallback(() => {
    pendingMediaRef.current = null;
    setPendingMedia(null);
    base.sendJson({ type: "media.clear" });
  }, [base]);

  return {
    state: base.state,
    transcript: base.transcript,
    timer: base.timer,
    connect: base.connect,
    disconnect: base.disconnect,
    toggleMute: base.toggleMute,
    isMuted: base.isMuted,
    userVolume: base.userVolume,
    aiVolume: base.aiVolume,
    pendingMedia,
    attachMediaFile,
    clearPendingMedia,
  };
}

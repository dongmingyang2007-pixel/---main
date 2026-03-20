"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "@/lib/env";

export type RealtimeState =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "ai_speaking"
  | "error"
  | "reconnecting";

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

interface UseRealtimeVoiceOptions {
  conversationId: string;
  projectId: string;
  onError?: (msg: string) => void;
  onTurnComplete?: (payload: {
    userText: string;
    assistantText: string;
  }) => void;
}

interface UseRealtimeVoiceReturn {
  state: RealtimeState;
  transcript: TranscriptEntry[];
  timer: number;
  connect: () => Promise<void>;
  disconnect: () => void;
  toggleMute: () => void;
  isMuted: boolean;
  userVolume: number;
  aiVolume: number;
}

const MAX_RECONNECT_ATTEMPTS = 3;

export function useRealtimeVoice({
  conversationId,
  projectId,
  onError,
  onTurnComplete,
}: UseRealtimeVoiceOptions): UseRealtimeVoiceReturn {
  const [state, setState] = useState<RealtimeState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [timer, setTimer] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);
  const [userVolume, setUserVolume] = useState(0);
  const [aiVolume, setAiVolume] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const playbackSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const manualDisconnectRef = useRef(false);
  const terminalErrorMessageRef = useRef<string | null>(null);
  const sessionEndReasonRef = useRef<string | null>(null);
  const currentUserTextRef = useRef("");
  const currentAssistantTextRef = useRef("");
  const openConnectionRef = useRef<(mode: "connect" | "reconnect") => void>(() => undefined);
  const sessionContextRef = useRef(`${projectId}:${conversationId}`);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const clearTurnBuffers = useCallback(() => {
    currentUserTextRef.current = "";
    currentAssistantTextRef.current = "";
  }, []);

  const discardAssistantPartial = useCallback(() => {
    currentAssistantTextRef.current = "";
    setTranscript((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && !last.final) {
        return prev.slice(0, -1);
      }
      return prev;
    });
  }, []);

  const resetTimerTracking = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    startTimeRef.current = 0;
    setTimer(0);
  }, []);

  useEffect(() => {
    const isActive =
      state === "connecting" ||
      state === "ready" ||
      state === "listening" ||
      state === "ai_speaking" ||
      state === "reconnecting";

    if (!isActive) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (!startTimeRef.current) {
      startTimeRef.current = Date.now();
    }
    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        setTimer(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    }
  }, [state]);

  useEffect(() => {
    return () => {
      clearReconnectTimer();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [clearReconnectTimer]);

  const ensurePlaybackContext = useCallback(async (): Promise<AudioContext> => {
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
      nextPlayTimeRef.current = playbackCtxRef.current.currentTime;
    }
    const ctx = playbackCtxRef.current;
    if (ctx.state === "suspended") {
      await ctx.resume().catch(() => {});
    }
    return ctx;
  }, []);

  const resetPlaybackQueue = useCallback(() => {
    const activeSources = playbackSourcesRef.current.splice(0);
    for (const source of activeSources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // ignore sources that already ended
      }
      try {
        source.disconnect();
      } catch {
        // ignore disconnect races
      }
    }
    if (playbackCtxRef.current) {
      nextPlayTimeRef.current = playbackCtxRef.current.currentTime;
    }
    setAiVolume(0);
  }, []);

  const closePlaybackContext = useCallback(() => {
    resetPlaybackQueue();
    if (playbackCtxRef.current) {
      playbackCtxRef.current.close().catch(() => {});
      playbackCtxRef.current = null;
      nextPlayTimeRef.current = 0;
    }
    setAiVolume(0);
  }, [resetPlaybackQueue]);

  const playPcmChunk = useCallback((pcmData: ArrayBuffer) => {
    let ctx = playbackCtxRef.current;
    if (!ctx) {
      ctx = new AudioContext({ sampleRate: 24000 });
      playbackCtxRef.current = ctx;
      nextPlayTimeRef.current = ctx.currentTime;
    }
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }

    const int16 = new Int16Array(pcmData);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    playbackSourcesRef.current.push(source);
    source.onended = () => {
      playbackSourcesRef.current = playbackSourcesRef.current.filter((entry) => entry !== source);
      try {
        source.disconnect();
      } catch {
        // ignore disconnect races
      }
    };

    let sum = 0;
    for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
    setAiVolume(Math.sqrt(sum / float32.length));

    source.connect(ctx.destination);
    const playTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    source.start(playTime);
    nextPlayTimeRef.current = playTime + buffer.duration;
  }, []);

  const startCapture = useCallback(async (ws: WebSocket) => {
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let processor: ScriptProcessorNode | null = null;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access is not supported");
      }

      stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
      });
      streamRef.current = stream;

      audioCtx = new AudioContext({ sampleRate: 16000 });
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === "suspended") {
        await audioCtx.resume().catch(() => {});
      }

      const source = audioCtx.createMediaStreamSource(stream);
      processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (isMutedRef.current || ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);

        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        setUserVolume(Math.sqrt(sum / input.length));

        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(pcm.buffer);
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);
    } catch (error) {
      processor?.disconnect();
      if (audioCtx) {
        await audioCtx.close().catch(() => {});
      }
      if (audioCtxRef.current === audioCtx) {
        audioCtxRef.current = null;
      }
      stream?.getTracks().forEach((track) => track.stop());
      if (streamRef.current === stream) {
        streamRef.current = null;
      }
      setUserVolume(0);
      throw error;
    }
  }, []);

  const stopCapture = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setUserVolume(0);
  }, []);

  const teardownMedia = useCallback((options?: { closePlayback?: boolean }) => {
    wsRef.current = null;
    stopCapture();
    if (options?.closePlayback === false) {
      resetPlaybackQueue();
      return;
    }
    closePlaybackContext();
  }, [closePlaybackContext, resetPlaybackQueue, stopCapture]);

  const finalizeConnection = useCallback(
    (nextState: RealtimeState, options?: { clearTranscript?: boolean; message?: string }) => {
      clearReconnectTimer();
      teardownMedia();
      clearTurnBuffers();
      resetTimerTracking();
      if (options?.clearTranscript) {
        setTranscript([]);
      }
      setState(nextState);
      if (options?.message) {
        onError?.(options.message);
      }
    },
    [clearReconnectTimer, clearTurnBuffers, onError, resetTimerTracking, teardownMedia],
  );

  const scheduleReconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      finalizeConnection("error", { message: "WebSocket connection failed" });
      return;
    }

    teardownMedia({ closePlayback: false });
    const delayMs = Math.min(500 * 2 ** reconnectAttemptsRef.current, 2000);
    reconnectAttemptsRef.current += 1;
    setState("reconnecting");
    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      openConnectionRef.current("reconnect");
    }, delayMs);
  }, [finalizeConnection, teardownMedia]);

  const openConnection = useCallback(
    (mode: "connect" | "reconnect") => {
      const existingSocket = wsRef.current;
      if (
        existingSocket &&
        (existingSocket.readyState === WebSocket.OPEN ||
          existingSocket.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }

      clearReconnectTimer();
      manualDisconnectRef.current = false;
      terminalErrorMessageRef.current = null;
      sessionEndReasonRef.current = null;

      if (mode === "connect") {
        reconnectAttemptsRef.current = 0;
        clearTurnBuffers();
        setTranscript([]);
        resetTimerTracking();
      }

      setState(mode === "reconnect" ? "reconnecting" : "connecting");
      if (!startTimeRef.current) {
        startTimeRef.current = Date.now();
      }

      const apiBaseUrl = new URL(getApiBaseUrl());
      const protocol = apiBaseUrl.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${apiBaseUrl.host}/api/v1/realtime/voice`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "session.start",
            conversation_id: conversationId,
            project_id: projectId,
          }),
        );
      };

      ws.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
          playPcmChunk(event.data);
          setState("ai_speaking");
          return;
        }

        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "session.ready":
            reconnectAttemptsRef.current = 0;
            setState("ready");
            try {
              await startCapture(ws);
              setState("listening");
            } catch {
              terminalErrorMessageRef.current = "Microphone permission is required";
              ws.close();
            }
            break;

          case "transcript.partial":
            setTranscript((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "user" && !last.final) {
                return [...prev.slice(0, -1), { role: "user", text: msg.text, final: false }];
              }
              return [...prev, { role: "user", text: msg.text, final: false }];
            });
            break;

          case "transcript.final":
            currentUserTextRef.current = msg.text || "";
            setTranscript((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "user" && !last.final) {
                return [...prev.slice(0, -1), { role: "user", text: msg.text, final: true }];
              }
              return [...prev, { role: "user", text: msg.text, final: true }];
            });
            break;

          case "response.text":
            currentAssistantTextRef.current += msg.text || "";
            setTranscript((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant" && !last.final) {
                return [
                  ...prev.slice(0, -1),
                  { role: "assistant", text: last.text + msg.text, final: false },
                ];
              }
              return [...prev, { role: "assistant", text: msg.text, final: false }];
            });
            break;

          case "response.done":
            setTranscript((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant") {
                return [...prev.slice(0, -1), { ...last, final: true }];
              }
              return prev;
            });
            if (currentUserTextRef.current || currentAssistantTextRef.current) {
              onTurnComplete?.({
                userText: currentUserTextRef.current.trim(),
                assistantText: currentAssistantTextRef.current.trim(),
              });
            }
            clearTurnBuffers();
            reconnectAttemptsRef.current = 0;
            setState("listening");
            break;

          case "interrupt.ack":
            resetPlaybackQueue();
            discardAssistantPartial();
            setState("listening");
            break;

          case "session.idle":
            break;

          case "session.end":
            sessionEndReasonRef.current = typeof msg.reason === "string" ? msg.reason : "";
            ws.close();
            break;

          case "error":
            terminalErrorMessageRef.current = msg.message || "Unknown error";
            ws.close();
            break;
        }
      };

      ws.onclose = (event) => {
        const errorMessage = terminalErrorMessageRef.current;
        const sessionEndReason = sessionEndReasonRef.current;
        terminalErrorMessageRef.current = null;
        sessionEndReasonRef.current = null;

        if (manualDisconnectRef.current) {
          manualDisconnectRef.current = false;
          finalizeConnection("idle", { clearTranscript: true });
          return;
        }

        if (errorMessage) {
          finalizeConnection("error", { message: errorMessage });
          return;
        }

        if (sessionEndReason) {
          finalizeConnection(
            sessionEndReason === "auth_revoked" ? "error" : "idle",
            sessionEndReason === "auth_revoked"
              ? { message: "Authentication expired" }
              : undefined,
          );
          return;
        }

        if (event.code === 1000) {
          finalizeConnection("idle");
          return;
        }

        scheduleReconnect();
      };

      ws.onerror = () => undefined;
    },
    [
      clearReconnectTimer,
      clearTurnBuffers,
      conversationId,
      discardAssistantPartial,
      finalizeConnection,
      playPcmChunk,
      projectId,
      resetTimerTracking,
      resetPlaybackQueue,
      scheduleReconnect,
      startCapture,
      onTurnComplete,
    ],
  );

  useEffect(() => {
    openConnectionRef.current = openConnection;
  }, [openConnection]);

  useEffect(() => {
    const nextContextKey = `${projectId}:${conversationId}`;
    if (sessionContextRef.current === nextContextKey) {
      return;
    }
    sessionContextRef.current = nextContextKey;

    const hasLiveSession =
      wsRef.current !== null ||
      state === "connecting" ||
      state === "ready" ||
      state === "listening" ||
      state === "ai_speaking" ||
      state === "reconnecting";

    if (!hasLiveSession) {
      return;
    }

    clearReconnectTimer();
    manualDisconnectRef.current = true;
    terminalErrorMessageRef.current = null;
    sessionEndReasonRef.current = null;

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "session.end" }));
      } catch {
        // Ignore close races.
      }
    }
    ws?.close();
    finalizeConnection("idle", {
      clearTranscript: true,
      message: "Conversation changed. Please restart voice.",
    });
  }, [clearReconnectTimer, conversationId, finalizeConnection, projectId, state]);

  const disconnect = useCallback(() => {
    clearReconnectTimer();
    manualDisconnectRef.current = true;
    terminalErrorMessageRef.current = null;
    sessionEndReasonRef.current = null;

    const ws = wsRef.current;
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      finalizeConnection("idle", { clearTranscript: true });
      return;
    }

    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "session.end" }));
      } catch {
        // Ignore close races.
      }
    }
    ws.close();
  }, [clearReconnectTimer, finalizeConnection]);

  const connect = useCallback(async () => {
    if (state !== "idle" && state !== "error") return;
    await ensurePlaybackContext();
    openConnection("connect");
  }, [ensurePlaybackContext, openConnection, state]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      isMutedRef.current = !prev;
      return !prev;
    });
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    state,
    transcript,
    timer,
    connect,
    disconnect,
    toggleMute,
    isMuted,
    userVolume,
    aiVolume,
  };
}

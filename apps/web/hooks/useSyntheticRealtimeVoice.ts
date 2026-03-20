"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "@/lib/env";

export type SyntheticRealtimeState =
  | "idle"
  | "connecting"
  | "ready"
  | "listening"
  | "ai_speaking"
  | "error"
  | "reconnecting";

export interface SyntheticPendingMedia {
  kind: "image" | "video";
  filename: string;
  mimeType: string;
  dataUrl: string;
}

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

interface UseSyntheticRealtimeVoiceOptions {
  conversationId: string;
  projectId: string;
  onError?: (msg: string) => void;
  onTurnComplete?: (payload: {
    userText: string;
    assistantText: string;
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

const MAX_RECONNECT_ATTEMPTS = 3;
const SPEECH_THRESHOLD = 0.018;
const SILENCE_COMMIT_MS = 420;

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
}: UseSyntheticRealtimeVoiceOptions): UseSyntheticRealtimeVoiceReturn {
  const [state, setState] = useState<SyntheticRealtimeState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [timer, setTimer] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);
  const [userVolume, setUserVolume] = useState(0);
  const [aiVolume, setAiVolume] = useState(0);
  const [pendingMedia, setPendingMedia] = useState<SyntheticPendingMedia | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const playbackQueueRef = useRef<string[]>([]);
  const activePlaybackUrlRef = useRef<string | null>(null);
  const aiVolumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPlaybackActiveRef = useRef(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const manualDisconnectRef = useRef(false);
  const terminalErrorMessageRef = useRef<string | null>(null);
  const sessionEndReasonRef = useRef<string | null>(null);
  const currentUserTextRef = useRef("");
  const currentAssistantTextRef = useRef("");
  const openConnectionRef = useRef<(mode: "connect" | "reconnect") => void>(() => undefined);
  const pumpPlaybackQueueRef = useRef<() => void>(() => undefined);
  const speechActiveRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const hasSegmentAudioRef = useRef(false);
  const pendingMediaRef = useRef<SyntheticPendingMedia | null>(null);
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

  const clearAiPulse = useCallback(() => {
    if (aiVolumeTimeoutRef.current) {
      clearTimeout(aiVolumeTimeoutRef.current);
      aiVolumeTimeoutRef.current = null;
    }
  }, []);

  const pulseAiVolume = useCallback(() => {
    clearAiPulse();
    setAiVolume(0.7);
    aiVolumeTimeoutRef.current = setTimeout(() => {
      setAiVolume(0);
      aiVolumeTimeoutRef.current = null;
    }, 180);
  }, [clearAiPulse]);

  const resetPlaybackQueue = useCallback(() => {
    clearAiPulse();
    const player = audioPlayerRef.current;
    if (player) {
      player.pause();
      player.removeAttribute("src");
      player.load();
    }
    if (activePlaybackUrlRef.current) {
      URL.revokeObjectURL(activePlaybackUrlRef.current);
      activePlaybackUrlRef.current = null;
    }
    for (const queuedUrl of playbackQueueRef.current) {
      URL.revokeObjectURL(queuedUrl);
    }
    playbackQueueRef.current = [];
    isPlaybackActiveRef.current = false;
    setAiVolume(0);
  }, [clearAiPulse]);

  const closePlaybackContext = useCallback(() => {
    resetPlaybackQueue();
    clearAiPulse();
    if (audioPlayerRef.current) {
      audioPlayerRef.current.onended = null;
      audioPlayerRef.current.onerror = null;
      audioPlayerRef.current.pause();
      audioPlayerRef.current.removeAttribute("src");
      audioPlayerRef.current.load();
      audioPlayerRef.current = null;
    }
    setAiVolume(0);
  }, [clearAiPulse, resetPlaybackQueue]);

  const ensureAudioPlayer = useCallback(() => {
    if (audioPlayerRef.current) {
      return audioPlayerRef.current;
    }
    const player = new Audio();
    player.preload = "auto";
    player.onended = () => {
      clearAiPulse();
      setAiVolume(0);
      if (activePlaybackUrlRef.current) {
        URL.revokeObjectURL(activePlaybackUrlRef.current);
        activePlaybackUrlRef.current = null;
      }
      isPlaybackActiveRef.current = false;
      pumpPlaybackQueueRef.current();
    };
    player.onerror = () => {
      clearAiPulse();
      setAiVolume(0);
      if (activePlaybackUrlRef.current) {
        URL.revokeObjectURL(activePlaybackUrlRef.current);
        activePlaybackUrlRef.current = null;
      }
      isPlaybackActiveRef.current = false;
      pumpPlaybackQueueRef.current();
    };
    audioPlayerRef.current = player;
    return player;
  }, [clearAiPulse]);

  const pumpPlaybackQueue = useCallback(() => {
    if (isPlaybackActiveRef.current) {
      return;
    }
    const nextUrl = playbackQueueRef.current.shift();
    if (!nextUrl) {
      return;
    }

    const player = ensureAudioPlayer();
    isPlaybackActiveRef.current = true;
    activePlaybackUrlRef.current = nextUrl;
    player.src = nextUrl;
    pulseAiVolume();
    void player.play().catch(() => {
      clearAiPulse();
      setAiVolume(0);
      if (activePlaybackUrlRef.current === nextUrl) {
        URL.revokeObjectURL(nextUrl);
        activePlaybackUrlRef.current = null;
      }
      isPlaybackActiveRef.current = false;
      pumpPlaybackQueueRef.current();
    });
  }, [clearAiPulse, ensureAudioPlayer, pulseAiVolume]);

  const playPcmChunk = useCallback((pcmData: ArrayBuffer) => {
    const blob = new Blob([pcmData], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    playbackQueueRef.current.push(url);
    pumpPlaybackQueueRef.current();
  }, []);

  const sendPendingMedia = useCallback((ws: WebSocket) => {
    const media = pendingMediaRef.current;
    if (!media || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(
      JSON.stringify({
        type: "media.set",
        data_url: media.dataUrl,
        filename: media.filename,
      }),
    );
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
      speechActiveRef.current = false;
      hasSegmentAudioRef.current = false;
      lastSpeechAtRef.current = 0;

      processor.onaudioprocess = (e) => {
        if (isMutedRef.current || ws.readyState !== WebSocket.OPEN) {
          return;
        }

        const input = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);
        setUserVolume(rms);

        const now = performance.now();
        const isSpeech = rms >= SPEECH_THRESHOLD;
        if (isSpeech) {
          speechActiveRef.current = true;
          lastSpeechAtRef.current = now;
        }

        const shouldSendChunk =
          isSpeech ||
          (speechActiveRef.current && now - lastSpeechAtRef.current < SILENCE_COMMIT_MS);

        if (!shouldSendChunk) {
          if (speechActiveRef.current && hasSegmentAudioRef.current) {
            speechActiveRef.current = false;
            hasSegmentAudioRef.current = false;
            setUserVolume(0);
            ws.send(JSON.stringify({ type: "audio.stop" }));
          }
          return;
        }

        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        hasSegmentAudioRef.current = true;
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
    if (
      hasSegmentAudioRef.current &&
      wsRef.current &&
      wsRef.current.readyState === WebSocket.OPEN
    ) {
      try {
        wsRef.current.send(JSON.stringify({ type: "audio.stop" }));
      } catch {
        // ignore close races
      }
    }
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    speechActiveRef.current = false;
    hasSegmentAudioRef.current = false;
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
    (nextState: SyntheticRealtimeState, options?: { clearTranscript?: boolean; message?: string }) => {
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
      const wsUrl = `${protocol}//${apiBaseUrl.host}/api/v1/realtime/composed-voice`;

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
            sendPendingMedia(ws);
            try {
              await startCapture(ws);
              setState("listening");
            } catch {
              terminalErrorMessageRef.current = "Microphone permission is required";
              ws.close();
            }
            break;

          case "media.attached":
            break;

          case "media.cleared":
            setPendingMedia(null);
            pendingMediaRef.current = null;
            break;

          case "transcript.final":
            currentUserTextRef.current = msg.text || "";
            setTranscript((prev) => [...prev, { role: "user", text: msg.text, final: true }]);
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
      sendPendingMedia,
      startCapture,
      onTurnComplete,
    ],
  );

  useEffect(() => {
    openConnectionRef.current = openConnection;
  }, [openConnection]);

  useEffect(() => {
    pumpPlaybackQueueRef.current = pumpPlaybackQueue;
  }, [pumpPlaybackQueue]);

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
        // ignore close races
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
    openConnection("connect");
  }, [openConnection, state]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      isMutedRef.current = !prev;
      return !prev;
    });
  }, []);

  const attachMediaFile = useCallback(async (file: File) => {
    const dataUrl = await readFileAsDataUrl(file);
    const nextMedia: SyntheticPendingMedia = {
      kind: file.type.startsWith("video/") ? "video" : "image",
      filename: file.name,
      mimeType: file.type || (file.name.toLowerCase().endsWith(".mp4") ? "video/mp4" : "image/jpeg"),
      dataUrl,
    };
    pendingMediaRef.current = nextMedia;
    setPendingMedia(nextMedia);

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "media.set",
          data_url: nextMedia.dataUrl,
          filename: nextMedia.filename,
        }),
      );
    }
  }, []);

  const clearPendingMedia = useCallback(() => {
    pendingMediaRef.current = null;
    setPendingMedia(null);
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "media.clear" }));
    }
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
    pendingMedia,
    attachMediaFile,
    clearPendingMedia,
  };
}

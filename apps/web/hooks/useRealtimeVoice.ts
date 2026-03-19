"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  workspaceId: string;
  onError?: (msg: string) => void;
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

export function useRealtimeVoice({
  conversationId,
  projectId,
  workspaceId,
  onError,
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

  // Timer
  useEffect(() => {
    if (state === "listening" || state === "ai_speaking" || state === "ready") {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setTimer(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      if (state === "idle") setTimer(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state]);

  const playPcmChunk = useCallback((pcmData: ArrayBuffer) => {
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({ sampleRate: 24000 });
      nextPlayTimeRef.current = playbackCtxRef.current.currentTime;
    }
    const ctx = playbackCtxRef.current;
    const int16 = new Int16Array(pcmData);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    let sum = 0;
    for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
    setAiVolume(Math.sqrt(sum / float32.length));

    source.connect(ctx.destination);
    const playTime = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    source.start(playTime);
    nextPlayTimeRef.current = playTime + buffer.duration;
  }, []);

  const stopPlayback = useCallback(() => {
    if (playbackCtxRef.current) {
      playbackCtxRef.current.close().catch(() => {});
      playbackCtxRef.current = null;
      nextPlayTimeRef.current = 0;
    }
    setAiVolume(0);
  }, []);

  const startCapture = useCallback(async (ws: WebSocket) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
    });
    streamRef.current = stream;

    const audioCtx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
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
  }, []);

  const stopCapture = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setUserVolume(0);
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "session.end" }));
      wsRef.current.close();
    }
    wsRef.current = null;
    stopCapture();
    stopPlayback();
    setState("idle");
    setTranscript([]);
  }, [stopCapture, stopPlayback]);

  const connect = useCallback(async () => {
    if (state !== "idle" && state !== "error") return;

    setState("connecting");

    const tokenMatch = document.cookie.match(/access_token=([^;]+)/);
    const token = tokenMatch?.[1] ?? "";

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/v1/realtime/voice?token=${token}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "session.start",
          conversation_id: conversationId,
          project_id: projectId,
          workspace_id: workspaceId,
        })
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
          setState("listening");
          await startCapture(ws);
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
          setTranscript((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "user" && !last.final) {
              return [...prev.slice(0, -1), { role: "user", text: msg.text, final: true }];
            }
            return [...prev, { role: "user", text: msg.text, final: true }];
          });
          break;

        case "response.text":
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
          setState("listening");
          break;

        case "interrupt.ack":
          stopPlayback();
          setState("listening");
          break;

        case "session.idle":
          break;

        case "session.end":
          disconnect();
          break;

        case "error":
          onError?.(msg.message || "Unknown error");
          if (msg.code === "concurrent_limit" || msg.code === "unauthorized") {
            setState("error");
            ws.close();
          }
          break;
      }
    };

    ws.onclose = () => {
      stopCapture();
      stopPlayback();
      setState("idle");
    };

    ws.onerror = () => {
      onError?.("WebSocket connection failed");
      setState("error");
    };
  }, [state, conversationId, projectId, workspaceId, startCapture, stopCapture, stopPlayback, playPcmChunk, onError, disconnect]);

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

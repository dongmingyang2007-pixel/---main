"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";

import { apiGet, apiPost, apiPostFormData, isApiRequestError } from "@/lib/api";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import RealtimeVoice from "./RealtimeVoice";
import SyntheticRealtimeVoice from "./SyntheticRealtimeVoice";

type ChatMode = "standard" | "omni_realtime" | "synthetic_realtime";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  audioBase64?: string | null;
  memories_extracted?: string;
}

interface ApiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

interface DictationResponse {
  text_input: string;
}

interface SpeechResponse {
  audio_response: string | null;
}

interface ImageMessageResponse {
  message: ApiMessage;
  text_input: string;
  audio_response: string | null;
}

interface ProjectChatSettings {
  id: string;
  default_chat_mode: ChatMode;
}

interface PipelineConfigItem {
  model_type:
    | "llm"
    | "asr"
    | "tts"
    | "vision"
    | "realtime"
    | "realtime_asr"
    | "realtime_tts";
  model_id: string;
}

interface PipelineResponse {
  items: PipelineConfigItem[];
}

interface CatalogModelItem {
  model_id: string;
  capabilities: string[];
}

interface ChatInterfaceProps {
  conversationId?: string | null;
  projectId?: string | null;
  onConversationActivity?: (payload: {
    conversationId: string;
    previewText: string;
  }) => void;
}

const VOICE_ACTIVE_STATES = new Set([
  "connecting",
  "ready",
  "listening",
  "ai_speaking",
  "reconnecting",
]);

function createAudioPlayer(base64Audio: string) {
  const audioBytes = Uint8Array.from(atob(base64Audio), (c) =>
    c.charCodeAt(0),
  );
  const blob = new Blob([audioBytes], { type: "audio/mp3" });
  const url = URL.createObjectURL(blob);
  return {
    audio: new Audio(url),
    url,
  };
}

function getPipelineModelId(
  items: PipelineConfigItem[],
  modelType: PipelineConfigItem["model_type"],
  fallback: string,
) {
  return items.find((item) => item.model_type === modelType)?.model_id || fallback;
}

function modelSupportsCapability(
  catalogItems: CatalogModelItem[],
  modelId: string,
  ...required: string[]
) {
  const entry = catalogItems.find((item) => item.model_id === modelId);
  if (!entry) {
    return false;
  }
  const capabilities = new Set((entry.capabilities || []).map((value) => value.toLowerCase()));
  return required.every((value) => capabilities.has(value.toLowerCase()));
}

export function ChatInterface({
  conversationId,
  projectId,
  onConversationActivity,
}: ChatInterfaceProps) {
  const t = useTranslations("console-chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<
    "idle" | "recording" | "sending"
  >("idle");
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [autoReadEnabled, setAutoReadEnabled] = useState(false);
  const [loadingReadAloudId, setLoadingReadAloudId] = useState<string | null>(null);
  const [readingMessageId, setReadingMessageId] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<"auto" | "on" | "off">("auto");
  const [thinkState, setThinkState] = useState<"auto" | "on" | "off">("auto");
  const [projectDefaultMode, setProjectDefaultMode] = useState<ChatMode>("standard");
  const [pipelineItems, setPipelineItems] = useState<PipelineConfigItem[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogModelItem[]>([]);
  const [conversationModeOverrides, setConversationModeOverrides] = useState<Record<string, ChatMode>>({});
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [voiceSessionState, setVoiceSessionState] = useState("idle");

  function cycleState(current: "auto" | "on" | "off"): "auto" | "on" | "off" {
    if (current === "auto") return "on";
    if (current === "on") return "off";
    return "auto";
  }
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const imageCaptureRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const voiceContextRef = useRef<{
    conversationId: string | null;
    projectId: string | null;
    chatMode: ChatMode;
  }>({
    conversationId: conversationId ?? null,
    projectId: projectId ?? null,
    chatMode: projectDefaultMode,
  });
  const { isRecording, startRecording, stopRecording } = useAudioRecorder();

  const releaseAudioPlayer = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
    }
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setReadingMessageId(null);
  }, []);

  const stopReadAloud = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    releaseAudioPlayer();
  }, [releaseAudioPlayer]);

  const playMessageAudio = useCallback(
    (base64Audio: string, messageId: string) => {
      stopReadAloud();
      try {
        const { audio, url } = createAudioPlayer(base64Audio);
        audioRef.current = audio;
        audioUrlRef.current = url;
        setReadingMessageId(messageId);
        audio.onended = () => {
          releaseAudioPlayer();
        };
        audio.onerror = () => {
          releaseAudioPlayer();
          setVoiceNotice(t("errors.readAloudFailed"));
        };
        void audio.play().catch(() => {
          releaseAudioPlayer();
          setVoiceNotice(t("errors.readAloudFailed"));
        });
      } catch {
        releaseAudioPlayer();
        setVoiceNotice(t("errors.readAloudFailed"));
      }
    },
    [releaseAudioPlayer, stopReadAloud, t],
  );

  const cacheMessageAudio = useCallback((messageId: string, audioBase64: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId ? { ...message, audioBase64 } : message,
      ),
    );
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => () => stopReadAloud(), [stopReadAloud]);

  useEffect(() => {
    if (!projectId) {
      setProjectDefaultMode("standard");
      setPipelineItems([]);
      setCatalogItems([]);
      setConversationModeOverrides({});
      setPendingImageFile(null);
      return;
    }

    let cancelled = false;
    void Promise.all([
      apiGet<ProjectChatSettings>(`/api/v1/projects/${projectId}`),
      apiGet<PipelineResponse>(`/api/v1/pipeline?project_id=${projectId}`),
      apiGet<CatalogModelItem[]>("/api/v1/models/catalog"),
    ])
      .then(([projectData, pipelineData, catalogData]) => {
        if (cancelled) {
          return;
        }
        const nextPipeline = Array.isArray(pipelineData.items) ? pipelineData.items : [];
        const nextCatalog = Array.isArray(catalogData) ? catalogData : [];
        const llmModelId = getPipelineModelId(nextPipeline, "llm", "qwen3.5-plus");
        const syntheticSupported = modelSupportsCapability(nextCatalog, llmModelId, "vision");
        const nextDefault =
          projectData.default_chat_mode === "synthetic_realtime" && !syntheticSupported
            ? "standard"
            : projectData.default_chat_mode || "standard";
        setPipelineItems(nextPipeline);
        setCatalogItems(nextCatalog);
        setProjectDefaultMode(nextDefault);
        if (!syntheticSupported) {
          setConversationModeOverrides((prev) => {
            let changed = false;
            const next: Record<string, ChatMode> = {};
            for (const [key, value] of Object.entries(prev)) {
              if (value === "synthetic_realtime") {
                changed = true;
                continue;
              }
              next[key] = value;
            }
            return changed ? next : prev;
          });
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setProjectDefaultMode("standard");
        setPipelineItems([]);
        setCatalogItems([]);
        setConversationModeOverrides({});
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Load messages when conversationId changes
  useEffect(() => {
    stopReadAloud();
    setVoiceNotice(null);
    if (!conversationId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setLoadingMessages(true);

    apiGet<ApiMessage[]>(
      `/api/v1/chat/conversations/${conversationId}/messages`,
    )
      .then((data) => {
        if (!cancelled) {
          const list = Array.isArray(data) ? data : [];
          setMessages(
            list.map((m) => ({ id: m.id, role: m.role, content: m.content })),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, stopReadAloud]);

  const handleReadAloud = useCallback(
    async (message: Message) => {
      const text = message.content.trim();
      if (!conversationId || !text) {
        return;
      }

      setVoiceNotice(null);

      if (readingMessageId === message.id) {
        stopReadAloud();
        return;
      }

      if (message.audioBase64) {
        playMessageAudio(message.audioBase64, message.id);
        return;
      }

      setLoadingReadAloudId(message.id);
      try {
        const data = await apiPost<SpeechResponse>(
          `/api/v1/chat/conversations/${conversationId}/speech`,
          { content: text },
        );
        if (!data.audio_response) {
          throw new Error("missing audio response");
        }
        cacheMessageAudio(message.id, data.audio_response);
        playMessageAudio(data.audio_response, message.id);
      } catch (error) {
        let content = t("errors.readAloudFailed");
        if (isApiRequestError(error) && error.code === "inference_timeout") {
          content = t("errors.inferenceTimeout");
        }
        setVoiceNotice(content);
      } finally {
        setLoadingReadAloudId((current) =>
          current === message.id ? null : current,
        );
      }
    },
    [
      cacheMessageAudio,
      conversationId,
      playMessageAudio,
      readingMessageId,
      stopReadAloud,
      t,
    ],
  );

  const handleImageFileSelected = useCallback((file: File | null) => {
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setVoiceNotice(t("errors.imageUploadFailed"));
      return;
    }
    setPendingImageFile(file);
    setVoiceNotice(null);
  }, [t]);

  const clearPendingImage = useCallback(() => {
    setPendingImageFile(null);
  }, []);

  const handleSendImage = useCallback(async () => {
    const imageFile = pendingImageFile;
    if (!conversationId || !imageFile || isTyping) {
      return;
    }

    const prompt = input.trim();
    const submittedText = prompt || t("imageDefaultPrompt");
    const userMessage: Message = {
      id: `img-u-${Date.now()}`,
      role: "user",
      content: submittedText,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setPendingImageFile(null);
    setIsTyping(true);
    setVoiceNotice(null);
    onConversationActivity?.({
      conversationId,
      previewText: submittedText,
    });

    try {
      const formData = new FormData();
      formData.append("image", imageFile, imageFile.name);
      if (prompt) {
        formData.append("prompt", prompt);
      }

      const response = await apiPostFormData<ImageMessageResponse>(
        `/api/v1/chat/conversations/${conversationId}/image`,
        formData,
      );

      const assistantMessage: Message = {
        id: response.message?.id || `img-a-${Date.now()}`,
        role: "assistant",
        content: response.message?.content || "",
        audioBase64: response.audio_response,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      if (autoReadEnabled && assistantMessage.content.trim() && response.audio_response) {
        cacheMessageAudio(assistantMessage.id, response.audio_response);
        playMessageAudio(response.audio_response, assistantMessage.id);
      }
    } catch (error) {
      let content = t("errors.imageUploadFailed");
      if (isApiRequestError(error)) {
        if (error.code === "inference_timeout") {
          content = t("errors.inferenceTimeout");
        } else if (error.code === "model_api_unavailable") {
          content = t("errors.modelUnavailable");
        }
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `img-err-${Date.now()}`,
          role: "assistant",
          content,
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }, [
    autoReadEnabled,
    cacheMessageAudio,
    conversationId,
    input,
    isTyping,
    onConversationActivity,
    pendingImageFile,
    playMessageAudio,
    t,
  ]);

  const handleSend = useCallback(async () => {
    if (pendingImageFile) {
      await handleSendImage();
      return;
    }
    const text = input.trim();
    if (!text || isTyping || !conversationId) return;

    const userMessage: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);
    setVoiceNotice(null);
    onConversationActivity?.({
      conversationId,
      previewText: text,
    });

    try {
      const response = await apiPost<ApiMessage>(
        `/api/v1/chat/conversations/${conversationId}/messages`,
        { content: text },
      );
      const aiMessage: Message = {
        id: response.id || `a-${Date.now()}`,
        role: "assistant",
        content: response.content,
      };
      setMessages((prev) => [...prev, aiMessage]);
      if (autoReadEnabled && aiMessage.content.trim()) {
        void handleReadAloud(aiMessage);
      }
    } catch (error) {
      let content = t("errors.generic");
      if (isApiRequestError(error)) {
        if (error.code === "inference_timeout") {
          content = t("errors.inferenceTimeout");
        } else if (error.code === "model_api_unavailable") {
          content = t("errors.modelUnavailable");
        }
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content,
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }, [
    autoReadEnabled,
    conversationId,
    handleReadAloud,
    handleSendImage,
    input,
    isTyping,
    onConversationActivity,
    pendingImageFile,
    t,
  ]);

  const dictateVoiceInput = useCallback(
    async (audioBlob: Blob) => {
      if (!conversationId) return;
      setVoiceStatus("sending");
      setVoiceNotice(null);

      try {
        const formData = new FormData();
        formData.append("audio", audioBlob, "recording.webm");

        const data = await apiPostFormData<DictationResponse>(
          `/api/v1/chat/conversations/${conversationId}/dictate`,
          formData,
        );

        const dictatedText = data.text_input.trim();
        if (!dictatedText) {
          setVoiceNotice(t("errors.dictationFailed"));
          return;
        }
        setInput((current) =>
          current.trim()
            ? `${current.trimEnd()} ${dictatedText}`
            : dictatedText,
        );
        inputRef.current?.focus();
      } catch (error) {
        let content = t("errors.dictationFailed");
        if (isApiRequestError(error) && error.code === "inference_timeout") {
          content = t("errors.inferenceTimeout");
        }
        setVoiceNotice(content);
      } finally {
        setVoiceStatus("idle");
      }
    },
    [conversationId, t],
  );

  const handleMicClick = useCallback(async () => {
    if (isRecording) {
      const blob = await stopRecording();
      if (blob.size > 0) {
        await dictateVoiceInput(blob);
      } else {
        setVoiceStatus("idle");
      }
    } else {
      try {
        setVoiceNotice(null);
        await startRecording();
        setVoiceStatus("recording");
      } catch {
        setVoiceStatus("idle");
        setVoiceNotice(t("micPermissionDenied"));
      }
    }
  }, [dictateVoiceInput, isRecording, startRecording, stopRecording, t]);

  const handleRealtimeTurnComplete = useCallback(
    ({
      userText,
      assistantText,
    }: {
      userText: string;
      assistantText: string;
    }) => {
      if (!conversationId) {
        return;
      }
      const nextMessages: Message[] = [];
      const normalizedUserText = userText.trim();
      const normalizedAssistantText = assistantText.trim();

      if (normalizedUserText) {
        onConversationActivity?.({
          conversationId,
          previewText: normalizedUserText,
        });
        nextMessages.push({
          id: `rt-u-${Date.now()}`,
          role: "user",
          content: normalizedUserText,
        });
      } else if (normalizedAssistantText) {
        onConversationActivity?.({
          conversationId,
          previewText: normalizedAssistantText,
        });
      }

      if (normalizedAssistantText) {
        const assistantMessage: Message = {
          id: `rt-a-${Date.now()}`,
          role: "assistant",
          content: normalizedAssistantText,
        };
        nextMessages.push(assistantMessage);
      }

      if (nextMessages.length > 0) {
        setMessages((prev) => [...prev, ...nextMessages]);
      }
    },
    [conversationId, onConversationActivity],
  );

  const chatMode =
    conversationId && conversationModeOverrides[conversationId]
      ? conversationModeOverrides[conversationId]
      : projectDefaultMode;

  useEffect(() => {
    setPendingImageFile(null);
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || chatMode === "standard") {
      setVoiceSessionState("idle");
    }
  }, [chatMode, conversationId]);

  useEffect(() => {
    const previous = voiceContextRef.current;
    const next = {
      conversationId: conversationId ?? null,
      projectId: projectId ?? null,
      chatMode,
    };
    const contextChanged =
      previous.conversationId !== next.conversationId ||
      previous.projectId !== next.projectId ||
      previous.chatMode !== next.chatMode;

    if (
      contextChanged &&
      previous.chatMode !== "standard" &&
      VOICE_ACTIVE_STATES.has(voiceSessionState)
    ) {
      setVoiceNotice(t("realtimeRestartAfterContextChange"));
    }

    voiceContextRef.current = next;
  }, [chatMode, conversationId, projectId, t, voiceSessionState]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const llmModelId = getPipelineModelId(pipelineItems, "llm", "qwen3.5-plus");
  const syntheticModeAvailable = modelSupportsCapability(catalogItems, llmModelId, "vision");
  const syntheticVideoAvailable = modelSupportsCapability(catalogItems, llmModelId, "video");
  const chatModeOptions: { key: ChatMode; label: string; disabled?: boolean }[] = [
    { key: "standard", label: t("mode.standard") },
    { key: "omni_realtime", label: t("mode.omni") },
    {
      key: "synthetic_realtime",
      label: t("mode.synthetic"),
      disabled: !syntheticModeAvailable,
    },
  ];
  const isStandardMode = chatMode === "standard";
  const noConversation = !conversationId;

  return (
    <div className="chat-interface">
      <input
        ref={imageUploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={isTyping || noConversation}
        data-testid="chat-image-upload-input"
        onChange={(event) => {
          handleImageFileSelected(event.target.files?.[0] || null);
          event.target.value = "";
        }}
      />
      <input
        ref={imageCaptureRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        disabled={isTyping || noConversation}
        data-testid="chat-image-capture-input"
        onChange={(event) => {
          handleImageFileSelected(event.target.files?.[0] || null);
          event.target.value = "";
        }}
      />
      <div className="chat-mode-switcher">
        {chatModeOptions.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`chat-mode-chip${chatMode === option.key ? " is-active" : ""}`}
            onClick={() => {
              if (!option.disabled) {
                if (!conversationId) {
                  return;
                }
                setConversationModeOverrides((prev) => {
                  if (option.key === projectDefaultMode) {
                    if (!(conversationId in prev)) {
                      return prev;
                    }
                    const next = { ...prev };
                    delete next[conversationId];
                    return next;
                  }
                  return {
                    ...prev,
                    [conversationId]: option.key,
                  };
                });
              }
            }}
            disabled={option.disabled}
          >
            {option.label}
            {projectDefaultMode === option.key ? (
              <span className="chat-mode-default">{t("mode.default")}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="chat-messages">
        {loadingMessages && <div className="chat-empty">...</div>}

        {!loadingMessages && messages.length === 0 && !isTyping && (
          <div className="chat-empty">
            {noConversation ? t("emptyHint") : t("emptyConversationHint")}
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message ${msg.role === "user" ? "is-user" : "is-assistant"}`}
          >
            <div className="chat-message-stack">
              <div className="chat-bubble">{msg.content}</div>
              {msg.role === "assistant" && (
                <div className="chat-message-actions">
                  <button
                    className={`chat-audio-btn ${readingMessageId === msg.id ? "is-active" : ""}`}
                    onClick={() => void handleReadAloud(msg)}
                    title={
                      readingMessageId === msg.id
                        ? t("voiceStop")
                        : t("voicePlay")
                    }
                    disabled={loadingReadAloudId === msg.id}
                    type="button"
                  >
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    </svg>
                    <span>
                      {loadingReadAloudId === msg.id
                        ? t("voicePreparing")
                        : readingMessageId === msg.id
                          ? t("voiceStop")
                          : t("voicePlay")}
                    </span>
                  </button>
                </div>
              )}
              {msg.role === "assistant" && msg.memories_extracted && (
                <div className="chat-memory-indicator">
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                    <circle cx={12} cy={12} r={3} />
                    <path d="M12 2v4m0 12v4" />
                  </svg>
                  {t("memory.remembered")}：{msg.memories_extracted}
                </div>
              )}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="chat-message is-assistant">
            <div className="chat-message-stack">
              <div className="chat-bubble is-typing">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-bar-voice">
        {isStandardMode ? (
          <button
            className={`chat-mic-btn ${isRecording ? "is-recording" : ""}`}
            onClick={() => void handleMicClick()}
            disabled={voiceStatus === "sending" || (isTyping && !isRecording) || noConversation}
            title={isRecording ? t("voiceRecording") : t("voiceRecord")}
            type="button"
          >
            {isRecording ? (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            )}
          </button>
        ) : null}
        <input
          ref={inputRef}
          className="chat-input"
          type="text"
          placeholder={t("inputPlaceholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isTyping || noConversation}
        />
        <div className="chat-tool-chips">
          {isStandardMode ? (
            <button
              type="button"
              className="chat-tool-chip"
              data-state={autoReadEnabled ? "on" : "auto"}
              onClick={() => setAutoReadEnabled((state) => !state)}
            >
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
              {t("voiceAutoRead")}
            </button>
          ) : null}
          {isStandardMode ? (
            <button
              type="button"
              className="chat-tool-chip"
              onClick={() => imageUploadRef.current?.click()}
              disabled={isTyping || noConversation}
            >
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x={3} y={3} width={18} height={18} rx={2} ry={2} />
                <circle cx={8.5} cy={8.5} r={1.5} />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              {t("imageUpload")}
            </button>
          ) : null}
          {isStandardMode ? (
            <button
              type="button"
              className="chat-tool-chip"
              onClick={() => imageCaptureRef.current?.click()}
              disabled={isTyping || noConversation}
            >
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx={12} cy={13} r={4} />
              </svg>
              {t("imageCapture")}
            </button>
          ) : null}
          <button
            type="button"
            className="chat-tool-chip"
            data-state={searchState}
            onClick={() => setSearchState(s => cycleState(s))}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <circle cx={11} cy={11} r={8} />
              <line x1={21} y1={21} x2={16.65} y2={16.65} />
            </svg>
            {t("tool.search")}
          </button>
          <button
            type="button"
            className="chat-tool-chip"
            data-state={thinkState}
            onClick={() => setThinkState(s => cycleState(s))}
          >
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M12 2a7 7 0 0 0-7 7c0 3 2 5.5 4 7.5V19h6v-2.5c2-2 4-4.5 4-7.5a7 7 0 0 0-7-7z" />
              <line x1={9} y1={22} x2={15} y2={22} />
            </svg>
            {t("tool.think")}
          </button>
        </div>
        <button
          className="chat-send"
          onClick={() => void handleSend()}
          disabled={(!input.trim() && !pendingImageFile) || isTyping || noConversation}
        >
          {t("send")}
        </button>
      </div>

      {isStandardMode && pendingImageFile ? (
        <div className="chat-attachment-chip">
          <span className="chat-attachment-name">{pendingImageFile.name}</span>
          <button type="button" className="chat-audio-btn" onClick={clearPendingImage}>
            {t("imageClear")}
          </button>
        </div>
      ) : null}

      {isStandardMode && voiceStatus === "recording" && (
        <div className="chat-voice-indicator">{t("voiceRecording")}</div>
      )}
      {isStandardMode && voiceStatus === "sending" && (
        <div className="chat-voice-indicator">{t("voiceSending")}</div>
      )}
      {voiceNotice && (!isStandardMode || voiceStatus === "idle") && (
        <div className="chat-voice-indicator is-error">{voiceNotice}</div>
      )}

      {conversationId && projectId && chatMode === "omni_realtime" && (
        <RealtimeVoice
          key={`omni:${projectId}:${conversationId}:${chatMode}`}
          conversationId={conversationId}
          projectId={projectId}
          onTurnComplete={handleRealtimeTurnComplete}
          onError={setVoiceNotice}
          onStateChange={setVoiceSessionState}
        />
      )}
      {conversationId && projectId && chatMode === "synthetic_realtime" && syntheticModeAvailable ? (
        <SyntheticRealtimeVoice
          key={`synthetic:${projectId}:${conversationId}:${chatMode}`}
          conversationId={conversationId}
          projectId={projectId}
          onTurnComplete={handleRealtimeTurnComplete}
          onError={setVoiceNotice}
          onStateChange={setVoiceSessionState}
          allowVideoInput={syntheticVideoAvailable}
        />
      ) : null}
    </div>
  );
}

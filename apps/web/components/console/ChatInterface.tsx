"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";

import { apiGet, apiPost, apiPostFormData, isApiRequestError } from "@/lib/api";
import { apiStream } from "@/lib/api-stream";
import { getApiHttpBaseUrl } from "@/lib/env";
import type { PersistedRealtimeTurnPayload } from "@/hooks/useRealtimeVoice";
import RealtimeVoicePanel from "./RealtimeVoicePanel";
import { ChatMessageList, type ChatMessageListHandle } from "./ChatMessageList";
import { ChatInputBar } from "./ChatInputBar";
import { ChatModePanel } from "./ChatModePanel";
import { StandardVoiceControls } from "./StandardVoiceControls";
import {
  type ChatMode,
  type Message,
  type ApiMessage,
  type ImageMessageResponse,
  type ProjectChatSettings,
  type PipelineConfigItem,
  type PipelineResponse,
  type CatalogModelItem,
  type LiveTranscriptUpdate,
  VOICE_ACTIVE_STATES,
  getPipelineModelId,
  modelSupportsCapability,
  normalizeRetrievalTrace,
  normalizeSearchSources,
  toMessage,
  mergeAssistantMetadataPatch,
  getApiErrorMessage,
} from "./chat-types";

interface ChatInterfaceProps {
  conversationId?: string | null;
  projectId?: string | null;
  onConversationActivity?: (payload: {
    conversationId: string;
    previewText: string;
  }) => void;
  onConversationLoaded?: (payload: {
    conversationId: string;
    messages: ApiMessage[];
  }) => void;
}

export function ChatInterface({
  conversationId,
  projectId,
  onConversationActivity,
  onConversationLoaded,
}: ChatInterfaceProps) {
  const t = useTranslations("console-chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [autoReadEnabled, setAutoReadEnabled] = useState(false);
  const [projectDefaultMode, setProjectDefaultMode] = useState<ChatMode>("standard");
  const [pipelineItems, setPipelineItems] = useState<PipelineConfigItem[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogModelItem[]>([]);
  const [conversationModeOverrides, setConversationModeOverrides] = useState<Record<string, ChatMode>>({});
  const [sessionModeOverride, setSessionModeOverride] = useState<ChatMode | null>(null);
  const [voiceSessionState, setVoiceSessionState] = useState("idle");
  const [liveDictationText, setLiveDictationText] = useState("");
  const [isLiveDictating, setIsLiveDictating] = useState(false);
  const [isStreamingActive, setIsStreamingActive] = useState(false);
  const [pendingAutoRead, setPendingAutoRead] = useState<{
    messageId: string;
    audioBase64?: string | null;
  } | null>(null);

  const messageListRef = useRef<ChatMessageListHandle>(null);
  const messagesRef = useRef<Message[]>([]);
  const pendingAssistantMetadataRef = useRef<Record<string, unknown>>({});
  const pendingRealtimeTurnPersistenceRef = useRef<
    Array<{
      userRuntimeId: string | null;
      assistantRuntimeId: string | null;
      userText: string;
      assistantText: string;
    }>
  >([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamAbortReasonRef = useRef<"user" | "no_first_event" | "idle" | null>(null);
  const runtimeMessageCounterRef = useRef(0);
  const memoryExtractionSyncInFlightRef = useRef(false);
  const liveTurnIdsRef = useRef<{
    userId: string | null;
    assistantId: string | null;
  }>({
    userId: null,
    assistantId: null,
  });
  const voiceContextRef = useRef<{
    conversationId: string | null;
    projectId: string | null;
    chatMode: ChatMode;
  }>({
    conversationId: conversationId ?? null,
    projectId: projectId ?? null,
    chatMode: projectDefaultMode,
  });

  const nextRuntimeMessageId = useCallback((prefix: string) => {
    runtimeMessageCounterRef.current += 1;
    return `${prefix}-${Date.now()}-${runtimeMessageCounterRef.current}`;
  }, []);
  const queueAutoRead = useCallback((messageId: string, audioBase64?: string | null) => {
    setPendingAutoRead({ messageId, audioBase64 });
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const pendingEntries = Object.entries(pendingAssistantMetadataRef.current);
    if (!pendingEntries.length || !messages.length) {
      return;
    }

    let changed = false;
    const nextMessages = messages.map((message) => {
      const pendingMetadata = pendingAssistantMetadataRef.current[message.id];
      if (!pendingMetadata) {
        return message;
      }

      changed = true;
      delete pendingAssistantMetadataRef.current[message.id];
      return mergeAssistantMetadataPatch(message, pendingMetadata);
    });

    if (changed) {
      setMessages(nextMessages);
    }
  }, [messages]);

  useEffect(() => {
    if (!pendingAutoRead) {
      return;
    }

    const targetMessage = messages.find((message) => message.id === pendingAutoRead.messageId);
    if (!targetMessage || targetMessage.isStreaming) {
      return;
    }

    const hasPlayableContent = Boolean(
      targetMessage.content.trim() || targetMessage.audioBase64 || pendingAutoRead.audioBase64,
    );
    if (!hasPlayableContent) {
      return;
    }

    if (pendingAutoRead.audioBase64) {
      messageListRef.current?.playReadAloud(
        pendingAutoRead.messageId,
        pendingAutoRead.audioBase64,
      );
    } else {
      messageListRef.current?.playReadAloud(pendingAutoRead.messageId);
    }
    setPendingAutoRead((current) =>
      current?.messageId === pendingAutoRead.messageId ? null : current,
    );
  }, [messages, pendingAutoRead]);

  useEffect(() => {
    if (!projectId) {
      setProjectDefaultMode("standard");
      setPipelineItems([]);
      setCatalogItems([]);
      setConversationModeOverrides({});
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
    setVoiceNotice(null);
    messageListRef.current?.stopPlayback();
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
          setMessages(list.map(toMessage));
          onConversationLoaded?.({
            conversationId,
            messages: list,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([]);
          onConversationLoaded?.({
            conversationId,
            messages: [],
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMessages(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, onConversationLoaded]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    let eventSource: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const apiBase = getApiHttpBaseUrl();
      eventSource = new EventSource(
        `${apiBase}/api/v1/chat/conversations/${conversationId}/events`,
        { withCredentials: true },
      );

      eventSource.addEventListener("assistant_message_metadata", (event) => {
        try {
          const payload = JSON.parse(event.data) as {
            id?: string;
            metadata_json?: unknown;
          };
          if (!payload.id) {
            return;
          }
          pendingAssistantMetadataRef.current[payload.id] = payload.metadata_json ?? {};
          setMessages((prev) =>
            prev.map((message) => {
              if (message.id !== payload.id) {
                return message;
              }
              delete pendingAssistantMetadataRef.current[payload.id];
              return mergeAssistantMetadataPatch(message, payload.metadata_json);
            }),
          );
        } catch {
          // Ignore malformed event payloads.
        }
      });

      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = null;
        retryTimeout = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      eventSource?.close();
      if (retryTimeout) {
        clearTimeout(retryTimeout);
      }
    };
  }, [conversationId]);

  const syncConversationMessages = useCallback(
    async (targetConversationId: string) => {
      try {
        const data = await apiGet<ApiMessage[]>(
          `/api/v1/chat/conversations/${targetConversationId}/messages`,
        );
        const list = Array.isArray(data) ? data : [];
        setMessages(list.map(toMessage));
        onConversationLoaded?.({
          conversationId: targetConversationId,
          messages: list,
        });
      } catch {
        // Keep current optimistic UI if refresh fails.
      }
    },
    [onConversationLoaded],
  );

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const hasPendingMemoryExtraction = messages.some(
      (message) =>
        message.role === "assistant" &&
        !message.isStreaming &&
        message.memory_extraction_status === "pending",
    );
    if (!hasPendingMemoryExtraction) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (memoryExtractionSyncInFlightRef.current) {
        return;
      }
      memoryExtractionSyncInFlightRef.current = true;
      void syncConversationMessages(conversationId).finally(() => {
        memoryExtractionSyncInFlightRef.current = false;
      });
    }, 2500);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [conversationId, messages, syncConversationMessages]);

  const handleSend = useCallback(
    async (
      content: string,
      options: {
        enableThinking?: boolean | null;
        enableSearch?: boolean | null;
        imageFile?: File | null;
      },
    ) => {
      if (!conversationId || isTyping || isStreamingActive) {
        return;
      }

      const imageFile = options.imageFile ?? null;
      const enableThinking = options.enableThinking ?? null;
      const enableSearch = options.enableSearch ?? null;

      if (imageFile) {
        const submittedText = content || t("imageDefaultPrompt");
        const userMessage: Message = {
          id: nextRuntimeMessageId("img-u"),
          role: "user",
          content: submittedText,
        };

        setMessages((prev) => [...prev, userMessage]);
        setIsTyping(true);
        setVoiceNotice(null);
        onConversationActivity?.({
          conversationId,
          previewText: submittedText,
        });

        try {
          const formData = new FormData();
          formData.append("image", imageFile, imageFile.name);
          if (content) {
            formData.append("prompt", content);
          }
          if (enableThinking === true) {
            formData.append("enable_thinking", "true");
          } else if (enableThinking === false) {
            formData.append("enable_thinking", "false");
          }
          if (enableSearch === true) {
            formData.append("enable_search", "true");
          } else if (enableSearch === false) {
            formData.append("enable_search", "false");
          }

          const response = await apiPostFormData<ImageMessageResponse>(
            `/api/v1/chat/conversations/${conversationId}/image`,
            formData,
          );

          const assistantMessage: Message = {
            ...toMessage(response.message),
            id: response.message?.id || nextRuntimeMessageId("img-a"),
            audioBase64: response.audio_response,
            animateOnMount: true,
            isStreaming: false,
          };
          setMessages((prev) => [...prev, assistantMessage]);
          if (autoReadEnabled && response.audio_response) {
            queueAutoRead(assistantMessage.id, response.audio_response);
          }
        } catch (error) {
          const errorContent = isApiRequestError(error)
            ? getApiErrorMessage(error, t)
            : t("errors.imageUploadFailed");
          setMessages((prev) => [
            ...prev,
            {
              id: nextRuntimeMessageId("img-err"),
              role: "assistant",
              content: errorContent,
            },
          ]);
        } finally {
          setIsTyping(false);
        }
        return;
      }

      if (!content) {
        return;
      }

      const userMessage: Message = {
        id: nextRuntimeMessageId("u"),
        role: "user",
        content,
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsTyping(true);
      setVoiceNotice(null);
      onConversationActivity?.({
        conversationId,
        previewText: content,
      });

      const streamBody = {
        content,
        enable_thinking:
          enableThinking === true
            ? true
            : enableThinking === false
              ? false
              : undefined,
        enable_search:
          enableSearch === true
            ? true
            : enableSearch === false
              ? false
              : undefined,
      };

      const tempAssistantId = nextRuntimeMessageId("stream-a");
      let streamStarted = false;
      let finalizedAssistantId: string | null = null;
      let sawStreamEvent = false;
      let watchdogTimeout: ReturnType<typeof setTimeout> | null = null;
      const clearWatchdog = () => {
        if (watchdogTimeout) {
          clearTimeout(watchdogTimeout);
          watchdogTimeout = null;
        }
      };
      const updateStreamingAssistant = (
        updater: (current: Message | null) => Message,
      ) => {
        setMessages((prev) => {
          const index = prev.findIndex((message) => message.id === tempAssistantId);
          const current = index >= 0 ? prev[index] : null;
          const nextMessage = updater(current);
          if (index === -1) {
            return [...prev, nextMessage];
          }
          const next = prev.slice();
          next[index] = nextMessage;
          return next;
        });
      };
      const finalizeStreamingAssistant = (
        final: Omit<Message, "role"> & { role?: "assistant" },
      ) => {
        setMessages((prev) => {
          const index = prev.findIndex((message) => message.id === tempAssistantId);
          const current = index >= 0 ? prev[index] : null;
          const nextMessage: Message = {
            id: final.id,
            role: "assistant",
            content: final.content,
            reasoningContent: final.reasoningContent ?? null,
            sources: final.sources,
            retrievalTrace: final.retrievalTrace ?? null,
            audioBase64: final.audioBase64 ?? current?.audioBase64 ?? null,
            memories_extracted: final.memories_extracted,
            extracted_facts: final.extracted_facts,
            memory_extraction_status:
              final.memory_extraction_status ?? current?.memory_extraction_status ?? null,
            memory_extraction_attempts:
              final.memory_extraction_attempts ?? current?.memory_extraction_attempts ?? null,
            memory_extraction_error:
              final.memory_extraction_error ?? current?.memory_extraction_error ?? null,
            animateOnMount: final.animateOnMount ?? current?.animateOnMount ?? false,
            isStreaming: final.isStreaming,
          };
          if (index === -1) {
            return [...prev, nextMessage];
          }
          const next = prev.slice();
          next[index] = nextMessage;
          return next;
        });
      };

      try {
        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        streamAbortReasonRef.current = null;
        setIsStreamingActive(true);
        const armWatchdog = () => {
          clearWatchdog();
          watchdogTimeout = setTimeout(() => {
            streamAbortReasonRef.current = sawStreamEvent ? "idle" : "no_first_event";
            abortController.abort();
          }, sawStreamEvent ? 45000 : 15000);
        };

        const assistantPlaceholder: Message = {
          id: tempAssistantId,
          role: "assistant",
          content: "",
          isStreaming: true,
        };
        setMessages((prev) => [...prev, assistantPlaceholder]);
        setIsTyping(false);
        streamStarted = true;
        armWatchdog();

        for await (const event of apiStream(
          `/api/v1/chat/conversations/${conversationId}/stream`,
          streamBody,
          abortController.signal,
        )) {
          sawStreamEvent = true;
          armWatchdog();
          if (event.event === "token") {
            const delta = (event.data.content as string) ?? "";
            updateStreamingAssistant((current) => ({
              id: tempAssistantId,
              role: "assistant",
              content: (current?.content ?? "") + delta,
              reasoningContent: current?.reasoningContent ?? null,
              sources: current?.sources,
              retrievalTrace: current?.retrievalTrace ?? null,
              audioBase64: current?.audioBase64 ?? null,
              memories_extracted: current?.memories_extracted,
              extracted_facts: current?.extracted_facts,
              memory_extraction_status: current?.memory_extraction_status ?? null,
              memory_extraction_attempts: current?.memory_extraction_attempts ?? null,
              memory_extraction_error: current?.memory_extraction_error ?? null,
              animateOnMount: current?.animateOnMount ?? false,
              isStreaming: true,
            }));
          } else if (event.event === "reasoning") {
            const delta = (event.data.content as string) ?? "";
            updateStreamingAssistant((current) => ({
              id: tempAssistantId,
              role: "assistant",
              content: current?.content ?? "",
              reasoningContent: (current?.reasoningContent ?? "") + delta,
              sources: current?.sources,
              retrievalTrace: current?.retrievalTrace ?? null,
              audioBase64: current?.audioBase64 ?? null,
              memories_extracted: current?.memories_extracted,
              extracted_facts: current?.extracted_facts,
              memory_extraction_status: current?.memory_extraction_status ?? null,
              memory_extraction_attempts: current?.memory_extraction_attempts ?? null,
              memory_extraction_error: current?.memory_extraction_error ?? null,
              animateOnMount: current?.animateOnMount ?? false,
              isStreaming: true,
            }));
          } else if (event.event === "message_done") {
            const finalId = (event.data.id as string) || tempAssistantId;
            const finalContent = typeof event.data.content === "string" ? event.data.content : "";
            const finalReasoning =
              typeof event.data.reasoning_content === "string"
                ? event.data.reasoning_content
                : null;
            const memoriesExtracted = event.data.memories_extracted as string | undefined;
            const sources = normalizeSearchSources(event.data.sources);
            const retrievalTrace = normalizeRetrievalTrace(event.data.retrieval_trace);
            const memoryExtractionStatus =
              typeof event.data.memory_extraction_status === "string"
                ? event.data.memory_extraction_status
                : null;
            const memoryExtractionAttempts =
              typeof event.data.memory_extraction_attempts === "number"
                ? event.data.memory_extraction_attempts
                : null;
            const memoryExtractionError =
              typeof event.data.memory_extraction_error === "string"
                ? event.data.memory_extraction_error
                : null;
            finalizedAssistantId = finalId;
            finalizeStreamingAssistant({
              id: finalId,
              isStreaming: false,
              content: finalContent,
              reasoningContent: finalReasoning,
              memories_extracted: memoriesExtracted,
              sources,
              retrievalTrace,
              memory_extraction_status: memoryExtractionStatus,
              memory_extraction_attempts: memoryExtractionAttempts,
              memory_extraction_error: memoryExtractionError,
            });
          } else if (event.event === "error") {
            const errorMsg =
              (event.data.detail as string) ||
              (event.data.message as string) ||
              t("errors.streamError");
            finalizeStreamingAssistant({
              id: tempAssistantId,
              isStreaming: false,
              content: errorMsg,
              reasoningContent: null,
            });
          }
        }
        clearWatchdog();

        if (!finalizedAssistantId) {
          finalizedAssistantId = tempAssistantId;
          finalizeStreamingAssistant({
            id: tempAssistantId,
            isStreaming: false,
            content: messagesRef.current.find((message) => message.id === tempAssistantId)?.content ?? "",
            reasoningContent:
              messagesRef.current.find((message) => message.id === tempAssistantId)?.reasoningContent ?? null,
          });
        }

        if (autoReadEnabled) {
          queueAutoRead(finalizedAssistantId);
        }
      } catch (error) {
        const streamStatus =
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          typeof error.status === "number"
            ? error.status
            : null;
        const streamUnavailable =
          streamStatus === 404 || streamStatus === 405 || streamStatus === 501;
        const abortReason = streamAbortReasonRef.current;
        clearWatchdog();

        if (error instanceof DOMException && error.name === "AbortError") {
          const currentStreamingMessage = messagesRef.current.find((message) => message.id === tempAssistantId);
          if (abortReason === "user") {
            finalizeStreamingAssistant({
              id: tempAssistantId,
              isStreaming: false,
              content: currentStreamingMessage?.content ?? "",
              reasoningContent: currentStreamingMessage?.reasoningContent ?? null,
            });
          } else {
            finalizeStreamingAssistant({
              id: tempAssistantId,
              isStreaming: false,
              content: currentStreamingMessage?.content?.trim() || t("errors.streamError"),
              reasoningContent: currentStreamingMessage?.reasoningContent ?? null,
            });
            if (conversationId) {
              window.setTimeout(() => {
                void syncConversationMessages(conversationId);
              }, 1500);
            }
          }
        } else if (streamUnavailable) {
          setMessages((prev) => prev.filter((message) => message.id !== tempAssistantId));
          try {
            setIsTyping(true);
            const response = await apiPost<ApiMessage>(
              `/api/v1/chat/conversations/${conversationId}/messages`,
              streamBody,
            );
            const aiMessage: Message = {
              ...toMessage(response),
              id: response.id || nextRuntimeMessageId("a"),
              animateOnMount: true,
              isStreaming: false,
            };
            setMessages((prev) => [...prev, aiMessage]);
            if (autoReadEnabled) {
              queueAutoRead(aiMessage.id);
            }
          } catch (fallbackError) {
            const errorContent = isApiRequestError(fallbackError)
              ? getApiErrorMessage(fallbackError, t)
              : t("errors.generic");
            setMessages((prev) => [
              ...prev,
              {
                id: nextRuntimeMessageId("err"),
                role: "assistant",
                content: errorContent,
              },
            ]);
          } finally {
            setIsTyping(false);
          }
        } else if (streamStarted) {
          // Stream failed after starting — show error in the existing placeholder
          finalizeStreamingAssistant({
            id: tempAssistantId,
            isStreaming: false,
            content: t("errors.streamError"),
            reasoningContent: null,
          });
        } else {
          // Stream never started — fall back to non-streaming apiPost
          try {
            setIsTyping(true);
            const response = await apiPost<ApiMessage>(
              `/api/v1/chat/conversations/${conversationId}/messages`,
              streamBody,
            );
            const aiMessage: Message = {
              ...toMessage(response),
              id: response.id || nextRuntimeMessageId("a"),
              animateOnMount: true,
              isStreaming: false,
            };
            setMessages((prev) => [...prev, aiMessage]);
            if (autoReadEnabled) {
              queueAutoRead(aiMessage.id);
            }
          } catch (fallbackError) {
            const errorContent = isApiRequestError(fallbackError)
              ? getApiErrorMessage(fallbackError, t)
              : t("errors.generic");
            setMessages((prev) => [
              ...prev,
              {
                id: nextRuntimeMessageId("err"),
                role: "assistant",
                content: errorContent,
              },
            ]);
          } finally {
            setIsTyping(false);
          }
        }
      } finally {
        clearWatchdog();
        abortControllerRef.current = null;
        streamAbortReasonRef.current = null;
        setIsStreamingActive(false);
      }
    },
    [
      autoReadEnabled,
      conversationId,
      isStreamingActive,
      isTyping,
      onConversationActivity,
      queueAutoRead,
      syncConversationMessages,
      t,
    ],
  );

  const handleLiveTranscriptUpdate = useCallback(
    ({ role, text, final, action = "upsert" }: LiveTranscriptUpdate) => {
      if (!conversationId) {
        return;
      }

      const slot = role === "user" ? "userId" : "assistantId";
      if (action === "discard") {
        const currentId = liveTurnIdsRef.current[slot];
        if (!currentId) {
          return;
        }
        setMessages((prev) => prev.filter((message) => message.id !== currentId));
        liveTurnIdsRef.current[slot] = null;
        return;
      }

      if (!text.trim()) {
        return;
      }
      const nextText = final ? text.trim() : text;

      let messageId = liveTurnIdsRef.current[slot];
      const existingMessage = messageId
        ? messagesRef.current.find((message) => message.id === messageId)
        : null;
      if (
        existingMessage &&
        !existingMessage.isStreaming &&
        !(final && existingMessage.content.trim() === nextText.trim())
      ) {
        messageId = null;
      }
      if (!messageId) {
        messageId = nextRuntimeMessageId(role === "user" ? "rt-u" : "rt-a");
        liveTurnIdsRef.current[slot] = messageId;
      }

      setMessages((prev) => {
        const nextMessage: Message = {
          id: messageId,
          role,
          content: nextText,
          animateOnMount: false,
          isStreaming: !final,
        };
        const index = prev.findIndex((message) => message.id === messageId);
        if (index === -1) {
          return [...prev, nextMessage];
        }
        const next = prev.slice();
        next[index] = {
          ...next[index],
          content: nextText,
          isStreaming: !final,
        };
        return next;
      });

      if (role === "user" && final) {
        onConversationActivity?.({
          conversationId,
          previewText: nextText.trim(),
        });
      }
    },
    [conversationId, nextRuntimeMessageId, onConversationActivity],
  );

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
      const normalizedUserText = userText.trim();
      const normalizedAssistantText = assistantText.trim();

      if (normalizedUserText) {
        onConversationActivity?.({
          conversationId,
          previewText: normalizedUserText,
        });
      } else if (normalizedAssistantText) {
        onConversationActivity?.({
          conversationId,
          previewText: normalizedAssistantText,
        });
      }

      setMessages((prev) => {
        const next = prev.slice();

        if (normalizedUserText) {
          const userId = liveTurnIdsRef.current.userId;
          if (userId) {
            const index = next.findIndex((message) => message.id === userId);
            if (index >= 0) {
              next[index] = {
                ...next[index],
                content: normalizedUserText,
                isStreaming: false,
              };
            }
          }
          // Note: do NOT create a new message in the else branch —
          // handleLiveTranscriptUpdate already added it via onTranscriptUpdate.
          // Creating another one would cause duplicate user messages.
        }

        if (normalizedAssistantText) {
          const assistantId = liveTurnIdsRef.current.assistantId;
          if (assistantId) {
            const index = next.findIndex((message) => message.id === assistantId);
            if (index >= 0) {
              next[index] = {
                ...next[index],
                content: normalizedAssistantText,
                isStreaming: false,
              };
            }
          }
          // Note: do NOT create a new message in the else branch —
          // handleLiveTranscriptUpdate already added it via onTranscriptUpdate.
          // Creating another one would cause duplicate assistant messages.
        }

        return next;
      });
      if (normalizedUserText || normalizedAssistantText) {
        pendingRealtimeTurnPersistenceRef.current.push({
          userRuntimeId: liveTurnIdsRef.current.userId,
          assistantRuntimeId: liveTurnIdsRef.current.assistantId,
          userText: normalizedUserText,
          assistantText: normalizedAssistantText,
        });
      }
      liveTurnIdsRef.current = { userId: null, assistantId: null };
    },
    [conversationId, onConversationActivity],
  );

  const handleRealtimeTurnPersisted = useCallback(
    ({ userMessage, assistantMessage }: PersistedRealtimeTurnPayload) => {
      const normalizeText = (value?: string | null) => (typeof value === "string" ? value.trim() : "");
      const persistedUserText = normalizeText(userMessage?.content);
      const persistedAssistantText = normalizeText(assistantMessage?.content);

      const queuedTurns = pendingRealtimeTurnPersistenceRef.current;
      let queuedTurn:
        | {
            userRuntimeId: string | null;
            assistantRuntimeId: string | null;
            userText: string;
            assistantText: string;
          }
        | undefined;
      const queuedIndex = queuedTurns.findIndex(
        (entry) =>
          (!persistedUserText || entry.userText === persistedUserText) &&
          (!persistedAssistantText || entry.assistantText === persistedAssistantText),
      );
      if (queuedIndex >= 0) {
        queuedTurn = queuedTurns.splice(queuedIndex, 1)[0];
      } else if (queuedTurns.length > 0) {
        queuedTurn = queuedTurns.shift();
      }

      setMessages((prev) => {
        const next = prev.slice();

        const applyPersistedMessage = (
          rawMessage: ApiMessage | undefined,
          runtimeId: string | null | undefined,
        ) => {
          if (!rawMessage) {
            return;
          }

          let persistedMessage: Message = {
            ...toMessage(rawMessage),
            animateOnMount: false,
            isStreaming: false,
          };
          const pendingMetadata = pendingAssistantMetadataRef.current[persistedMessage.id];
          if (pendingMetadata) {
            delete pendingAssistantMetadataRef.current[persistedMessage.id];
            persistedMessage = mergeAssistantMetadataPatch(persistedMessage, pendingMetadata);
          }

          const existingPersistentIndex = next.findIndex((message) => message.id === persistedMessage.id);
          if (existingPersistentIndex >= 0) {
            next[existingPersistentIndex] = {
              ...next[existingPersistentIndex],
              ...persistedMessage,
              animateOnMount: false,
              isStreaming: false,
            };
            return;
          }

          if (runtimeId) {
            const runtimeIndex = next.findIndex((message) => message.id === runtimeId);
            if (runtimeIndex >= 0) {
              next[runtimeIndex] = {
                ...next[runtimeIndex],
                ...persistedMessage,
                animateOnMount: false,
                isStreaming: false,
              };
              return;
            }
          }

          next.push(persistedMessage);
        };

        applyPersistedMessage(userMessage as ApiMessage | undefined, queuedTurn?.userRuntimeId);
        applyPersistedMessage(assistantMessage as ApiMessage | undefined, queuedTurn?.assistantRuntimeId);
        return next;
      });
    },
    [],
  );

  const chatMode =
    conversationId && conversationModeOverrides[conversationId]
      ? conversationModeOverrides[conversationId]
      : sessionModeOverride ?? projectDefaultMode;

  useEffect(() => {
    if (!conversationId || !sessionModeOverride) {
      return;
    }
    setConversationModeOverrides((prev) => {
      if (prev[conversationId] === sessionModeOverride) {
        return prev;
      }
      return {
        ...prev,
        [conversationId]: sessionModeOverride,
      };
    });
  }, [conversationId, sessionModeOverride]);

  useEffect(() => {
    liveTurnIdsRef.current = { userId: null, assistantId: null };
    pendingRealtimeTurnPersistenceRef.current = [];
  }, [conversationId]);

  useEffect(() => {
    setLiveDictationText("");
    setIsLiveDictating(false);
  }, [conversationId, projectId]);

  useEffect(() => {
    setSessionModeOverride(null);
  }, [projectId]);

  const handleLiveDictationDraftChange = useCallback((text: string) => {
    setVoiceNotice(null);
    setLiveDictationText(text);
  }, []);

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

  const handleModeChange = useCallback(
    (mode: ChatMode) => {
      setSessionModeOverride(mode === projectDefaultMode ? null : mode);
      if (!conversationId) {
        return;
      }
      setConversationModeOverrides((prev) => {
        if (mode === projectDefaultMode) {
          if (!(conversationId in prev)) {
            return prev;
          }
          const next = { ...prev };
          delete next[conversationId];
          return next;
        }
        return {
          ...prev,
          [conversationId]: mode,
        };
      });
    },
    [conversationId, projectDefaultMode],
  );

  const handleStopGenerating = useCallback(() => {
    streamAbortReasonRef.current = "user";
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreamingActive(false);
  }, []);

  const llmModelId = getPipelineModelId(pipelineItems, "llm", "qwen3.5-plus");
  const syntheticModeAvailable = modelSupportsCapability(catalogItems, llmModelId, "vision");
  const syntheticVideoAvailable = modelSupportsCapability(catalogItems, llmModelId, "video");
  const webSearchAvailable = modelSupportsCapability(catalogItems, llmModelId, "web_search");
  const isStandardMode = chatMode === "standard";
  const noConversation = !conversationId;
  const workspaceHint = noConversation
    ? t("emptyHint")
    : messages.length === 0 && !loadingMessages
      ? t("emptyConversationHint")
      : t("description");

  return (
    <div className="chat-interface">
      <div className="chat-workspace-header" style={{ padding: "20px 24px 14px" }} data-testid="chat-workspace-header">
        <div className="chat-workspace-copy">
          <div className="chat-workspace-kicker">{t("title")}</div>
          <div className="chat-workspace-description">{workspaceHint}</div>
        </div>

        <div className="chat-workspace-controls" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ChatModePanel
            chatMode={chatMode}
            projectDefaultMode={projectDefaultMode}
            syntheticModeAvailable={syntheticModeAvailable}
            onModeChange={handleModeChange}
            disabled={noConversation}
          />
          {conversationId ? (
            <span className="chat-workspace-badge" data-testid="chat-toolbar-state">
              {t("toolbar.messages", { count: messages.length })}
            </span>
          ) : null}
        </div>
      </div>

      {loadingMessages && (
        <div className="chat-messages">
          <div className="chat-empty">...</div>
        </div>
      )}

      {!loadingMessages && (
        <ChatMessageList
          ref={messageListRef}
          messages={messages}
          onMessagesChange={setMessages}
          isTyping={isTyping}
          conversationId={conversationId}
          noConversation={noConversation}
          onError={setVoiceNotice}
        />
      )}

      {isStreamingActive && (
        <div className="chat-stop-generating">
          <button
            type="button"
            className="chat-stop-btn"
            onClick={handleStopGenerating}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
              <rect x={6} y={6} width={12} height={12} rx={2} />
            </svg>
            {t("stopGenerating")}
          </button>
        </div>
      )}

      <div className="chat-input-bar-voice">
        {isStandardMode && conversationId && projectId ? (
          <StandardVoiceControls
            conversationId={conversationId}
            projectId={projectId}
            isTyping={isTyping}
            disabled={noConversation}
            onDictationDraftChange={handleLiveDictationDraftChange}
            onDictationStateChange={setIsLiveDictating}
            onError={setVoiceNotice}
          />
        ) : null}
        <ChatInputBar
          onSend={(content, options) => void handleSend(content, options)}
          disabled={noConversation}
          isTyping={isTyping || isStreamingActive}
          isStandardMode={isStandardMode}
          searchAvailable={webSearchAvailable}
          autoReadEnabled={autoReadEnabled}
          onAutoReadToggle={() => setAutoReadEnabled((state) => !state)}
          liveExternalInputText={liveDictationText}
          isLiveExternalInputActive={isLiveDictating}
        />
      </div>

      {voiceNotice && (
        <div className="chat-voice-indicator is-error">{voiceNotice}</div>
      )}

      {conversationId && projectId && (chatMode === "omni_realtime" || (chatMode === "synthetic_realtime" && syntheticModeAvailable)) && (
        <RealtimeVoicePanel
          chatMode={chatMode}
          conversationId={conversationId}
          projectId={projectId}
          allowVideoInput={syntheticVideoAvailable}
          onTurnComplete={handleRealtimeTurnComplete}
          onTurnPersisted={handleRealtimeTurnPersisted}
          onTranscriptUpdate={handleLiveTranscriptUpdate}
          onError={setVoiceNotice}
          onStateChange={setVoiceSessionState}
        />
      )}
    </div>
  );
}

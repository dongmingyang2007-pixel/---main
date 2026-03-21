"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";

import { apiGet, apiPost, apiPostFormData, isApiRequestError } from "@/lib/api";
import { apiStream } from "@/lib/api-stream";
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
  toMessage,
  getApiErrorMessage,
} from "./chat-types";

interface ChatInterfaceProps {
  conversationId?: string | null;
  projectId?: string | null;
  onConversationActivity?: (payload: {
    conversationId: string;
    previewText: string;
  }) => void;
}

export function ChatInterface({
  conversationId,
  projectId,
  onConversationActivity,
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
  const [voiceSessionState, setVoiceSessionState] = useState("idle");
  const [dictationText, setDictationText] = useState<string | null>(null);
  const [isStreamingActive, setIsStreamingActive] = useState(false);

  const messageListRef = useRef<ChatMessageListHandle>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const runtimeMessageCounterRef = useRef(0);
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
  }, [conversationId]);

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

      if (imageFile) {
        const submittedText = content || t("imageDefaultPrompt");
        const userMessage: Message = {
          id: `img-u-${Date.now()}`,
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

          const response = await apiPostFormData<ImageMessageResponse>(
            `/api/v1/chat/conversations/${conversationId}/image`,
            formData,
          );

          const assistantMessage: Message = {
            id: response.message?.id || `img-a-${Date.now()}`,
            role: "assistant",
            content: response.message?.content || "",
            reasoningContent: response.message?.reasoning_content,
            audioBase64: response.audio_response,
            animateOnMount: true,
            isStreaming: false,
          };
          setMessages((prev) => [...prev, assistantMessage]);
          if (autoReadEnabled && response.audio_response) {
            messageListRef.current?.playReadAloud(
              assistantMessage.id,
              response.audio_response,
            );
          }
        } catch (error) {
          const errorContent = isApiRequestError(error)
            ? getApiErrorMessage(error, t)
            : t("errors.imageUploadFailed");
          setMessages((prev) => [
            ...prev,
            {
              id: `img-err-${Date.now()}`,
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
        id: `u-${Date.now()}`,
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
      };

      const tempAssistantId = `stream-a-${Date.now()}`;
      let streamStarted = false;

      try {
        const abortController = new AbortController();
        abortControllerRef.current = abortController;
        setIsStreamingActive(true);

        const assistantPlaceholder: Message = {
          id: tempAssistantId,
          role: "assistant",
          content: "",
          isStreaming: true,
        };
        setMessages((prev) => [...prev, assistantPlaceholder]);
        setIsTyping(false);
        streamStarted = true;

        for await (const event of apiStream(
          `/api/v1/chat/conversations/${conversationId}/stream`,
          streamBody,
          abortController.signal,
        )) {
          if (event.event === "token") {
            const delta = (event.data.content as string) ?? "";
            messageListRef.current?.updateMessage(
              tempAssistantId,
              (prev) => prev + delta,
            );
          } else if (event.event === "reasoning") {
            const delta = (event.data.content as string) ?? "";
            messageListRef.current?.updateReasoning(
              tempAssistantId,
              (prev) => prev + delta,
            );
          } else if (event.event === "message_done") {
            const finalId = (event.data.id as string) || tempAssistantId;
            const memoriesExtracted = event.data.memories_extracted as string | undefined;
            messageListRef.current?.finalizeMessage(tempAssistantId, {
              id: finalId,
              isStreaming: false,
              memories_extracted: memoriesExtracted,
            });
          } else if (event.event === "error") {
            const errorMsg =
              (event.data.detail as string) ||
              (event.data.message as string) ||
              t("errors.streamError");
            messageListRef.current?.updateMessage(
              tempAssistantId,
              () => errorMsg,
            );
            messageListRef.current?.finalizeMessage(tempAssistantId, {
              id: tempAssistantId,
              isStreaming: false,
            });
          }
        }

        // Stream finished normally — ensure finalized
        messageListRef.current?.finalizeMessage(tempAssistantId, {
          id: tempAssistantId,
          isStreaming: false,
        });

        if (autoReadEnabled) {
          messageListRef.current?.playReadAloud(tempAssistantId);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          // User clicked stop — finalize whatever we have so far
          messageListRef.current?.finalizeMessage(tempAssistantId, {
            id: tempAssistantId,
            isStreaming: false,
          });
        } else if (streamStarted) {
          // Stream failed after starting — show error in the existing placeholder
          messageListRef.current?.updateMessage(
            tempAssistantId,
            () => t("errors.streamError"),
          );
          messageListRef.current?.finalizeMessage(tempAssistantId, {
            id: tempAssistantId,
            isStreaming: false,
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
              id: response.id || `a-${Date.now()}`,
              animateOnMount: true,
              isStreaming: false,
            };
            setMessages((prev) => [...prev, aiMessage]);
            if (autoReadEnabled) {
              messageListRef.current?.playReadAloud(aiMessage.id);
            }
          } catch (fallbackError) {
            const errorContent = isApiRequestError(fallbackError)
              ? getApiErrorMessage(fallbackError, t)
              : t("errors.generic");
            setMessages((prev) => [
              ...prev,
              {
                id: `err-${Date.now()}`,
                role: "assistant",
                content: errorContent,
              },
            ]);
          } finally {
            setIsTyping(false);
          }
        }
      } finally {
        abortControllerRef.current = null;
        setIsStreamingActive(false);
      }
    },
    [autoReadEnabled, conversationId, isStreamingActive, isTyping, onConversationActivity, t],
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
    },
    [conversationId, nextRuntimeMessageId],
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
        let next = prev.slice();

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
          } else {
            next = [
              ...next,
              {
                id: nextRuntimeMessageId("rt-u"),
                role: "user",
                content: normalizedUserText,
                animateOnMount: false,
                isStreaming: false,
              },
            ];
          }
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
          } else {
            next = [
              ...next,
              {
                id: nextRuntimeMessageId("rt-a"),
                role: "assistant",
                content: normalizedAssistantText,
                animateOnMount: true,
                isStreaming: false,
              },
            ];
          }
        }

        return next;
      });
      liveTurnIdsRef.current = { userId: null, assistantId: null };
    },
    [conversationId, nextRuntimeMessageId, onConversationActivity],
  );

  const chatMode =
    conversationId && conversationModeOverrides[conversationId]
      ? conversationModeOverrides[conversationId]
      : projectDefaultMode;

  useEffect(() => {
    liveTurnIdsRef.current = { userId: null, assistantId: null };
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

  const handleModeChange = useCallback(
    (mode: ChatMode) => {
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

  const handleDictationResult = useCallback((text: string) => {
    setDictationText(text);
  }, []);

  const handleDictationTextConsumed = useCallback(() => {
    setDictationText(null);
  }, []);

  const handleStopGenerating = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreamingActive(false);
  }, []);

  const llmModelId = getPipelineModelId(pipelineItems, "llm", "qwen3.5-plus");
  const syntheticModeAvailable = modelSupportsCapability(catalogItems, llmModelId, "vision");
  const syntheticVideoAvailable = modelSupportsCapability(catalogItems, llmModelId, "video");
  const isStandardMode = chatMode === "standard";
  const noConversation = !conversationId;

  return (
    <div className="chat-interface">
      <ChatModePanel
        chatMode={chatMode}
        projectDefaultMode={projectDefaultMode}
        syntheticModeAvailable={syntheticModeAvailable}
        onModeChange={handleModeChange}
        disabled={noConversation}
      />

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
        {isStandardMode && conversationId ? (
          <StandardVoiceControls
            conversationId={conversationId}
            isTyping={isTyping}
            disabled={noConversation}
            onDictationResult={handleDictationResult}
            onError={setVoiceNotice}
          />
        ) : null}
        <ChatInputBar
          onSend={(content, options) => void handleSend(content, options)}
          disabled={noConversation}
          isTyping={isTyping || isStreamingActive}
          isStandardMode={isStandardMode}
          autoReadEnabled={autoReadEnabled}
          onAutoReadToggle={() => setAutoReadEnabled((state) => !state)}
          externalInputText={dictationText}
          onExternalInputTextConsumed={handleDictationTextConsumed}
        />
      </div>

      {voiceNotice && (
        <div className="chat-voice-indicator is-error">{voiceNotice}</div>
      )}

      {conversationId && projectId && (chatMode === "omni_realtime" || (chatMode === "synthetic_realtime" && syntheticModeAvailable)) && (
        <RealtimeVoicePanel
          key={`voice:${projectId}:${conversationId}:${chatMode}`}
          chatMode={chatMode}
          conversationId={conversationId}
          projectId={projectId}
          allowVideoInput={syntheticVideoAvailable}
          onTurnComplete={handleRealtimeTurnComplete}
          onTranscriptUpdate={handleLiveTranscriptUpdate}
          onError={setVoiceNotice}
          onStateChange={setVoiceSessionState}
        />
      )}
    </div>
  );
}

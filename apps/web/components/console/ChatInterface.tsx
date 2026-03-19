"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";

import { apiGet, apiPost, apiPostFormData, isApiRequestError } from "@/lib/api";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import RealtimeVoice from "./RealtimeVoice";

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

interface VoiceResponse {
  message: ApiMessage;
  text_input: string;
  audio_response: string | null;
}

interface ChatInterfaceProps {
  conversationId?: string | null;
  projectId?: string | null;
  onConversationActivity?: (payload: {
    conversationId: string;
    previewText: string;
  }) => void;
}

function playAudio(base64Audio: string) {
  const audioBytes = Uint8Array.from(atob(base64Audio), (c) =>
    c.charCodeAt(0),
  );
  const blob = new Blob([audioBytes], { type: "audio/mp3" });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.play().catch(() => {});
  audio.onended = () => URL.revokeObjectURL(url);
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
  const [searchState, setSearchState] = useState<"auto" | "on" | "off">("auto");
  const [thinkState, setThinkState] = useState<"auto" | "on" | "off">("auto");

  function cycleState(current: "auto" | "on" | "off"): "auto" | "on" | "off" {
    if (current === "auto") return "on";
    if (current === "on") return "off";
    return "auto";
  }
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { isRecording, startRecording, stopRecording } = useAudioRecorder();

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  // Load messages when conversationId changes
  useEffect(() => {
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
  }, [conversationId]);

  const handleSend = useCallback(async () => {
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
  }, [conversationId, input, isTyping, onConversationActivity, t]);

  const sendVoiceMessage = useCallback(
    async (audioBlob: Blob) => {
      if (!conversationId) return;
      setIsTyping(true);
      setVoiceStatus("sending");

      try {
        const formData = new FormData();
        formData.append("audio", audioBlob, "recording.webm");

        const data = await apiPostFormData<VoiceResponse>(
          `/api/v1/chat/conversations/${conversationId}/voice`,
          formData,
        );

        // Add user message (transcribed text)
        if (data.text_input) {
          onConversationActivity?.({
            conversationId,
            previewText: data.text_input,
          });
          setMessages((prev) => [
            ...prev,
            {
              id: `u-${Date.now()}`,
              role: "user",
              content: data.text_input,
            },
          ]);
        }

        // Add AI message
        const aiMsg = data.message;
        setMessages((prev) => [
          ...prev,
          {
            id: aiMsg.id,
            role: "assistant",
            content: aiMsg.content,
            audioBase64: data.audio_response,
          },
        ]);

        // Auto-play audio response
        if (data.audio_response) {
          playAudio(data.audio_response);
        }
      } catch (error) {
        let content = t("errors.voiceFailed");
        if (isApiRequestError(error) && error.code === "inference_timeout") {
          content = t("errors.inferenceTimeout");
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
        setVoiceStatus("idle");
      }
    },
    [conversationId, onConversationActivity, t],
  );

  const handleMicClick = useCallback(async () => {
    if (isRecording) {
      // Stop recording and send
      const blob = await stopRecording();
      if (blob.size > 0) {
        await sendVoiceMessage(blob);
      }
    } else {
      try {
        await startRecording();
        setVoiceStatus("recording");
      } catch {
        // Permission denied - error is logged in the hook
        setVoiceStatus("idle");
      }
    }
  }, [isRecording, startRecording, stopRecording, sendVoiceMessage]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const noConversation = !conversationId;

  return (
    <div className="chat-interface">
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
            <div className="chat-bubble">
              {msg.content}
              {msg.role === "assistant" && msg.audioBase64 && (
                <button
                  className="chat-audio-btn"
                  onClick={() => playAudio(msg.audioBase64!)}
                  title={t("voicePlay")}
                  type="button"
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                </button>
              )}
            </div>
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
        ))}

        {isTyping && (
          <div className="chat-message is-assistant">
            <div className="chat-bubble is-typing">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-bar-voice">
        <button
          className={`chat-mic-btn ${isRecording ? "is-recording" : ""}`}
          onClick={() => void handleMicClick()}
          disabled={(isTyping && !isRecording) || noConversation}
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
        <input
          className="chat-input"
          type="text"
          placeholder={t("inputPlaceholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isTyping || noConversation}
        />
        <div className="chat-tool-chips">
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
          disabled={!input.trim() || isTyping || noConversation}
        >
          {t("send")}
        </button>
      </div>

      {voiceStatus === "recording" && (
        <div className="chat-voice-indicator">{t("voiceRecording")}</div>
      )}
      {voiceStatus === "sending" && (
        <div className="chat-voice-indicator">{t("voiceSending")}</div>
      )}

      {conversationId && projectId && (
        <RealtimeVoice
          conversationId={conversationId}
          projectId={projectId}
          workspaceId={
            (typeof document !== "undefined" &&
              document.cookie.match(/mingrun_workspace_id=([^;]+)/)?.[1]) ||
            ""
          }
        />
      )}
    </div>
  );
}

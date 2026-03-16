"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";

import { apiGet, apiPost, apiPostFormData } from "@/lib/api";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  audioBase64?: string | null;
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

export function ChatInterface({ conversationId }: ChatInterfaceProps) {
  const t = useTranslations("console-chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<
    "idle" | "recording" | "sending"
  >("idle");
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
    } catch {
      // On error, show a fallback message
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  }, [input, isTyping, conversationId]);

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
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            content: "语音处理失败，请重试。",
          },
        ]);
      } finally {
        setIsTyping(false);
        setVoiceStatus("idle");
      }
    },
    [conversationId],
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
            {noConversation ? t("emptyHint") : t("emptyHint")}
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
                  &#x1f50a;
                </button>
              )}
            </div>
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
    </div>
  );
}

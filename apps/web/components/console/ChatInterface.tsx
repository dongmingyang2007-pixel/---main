"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";

import { apiGet, apiPost } from "@/lib/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ApiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

interface ChatInterfaceProps {
  conversationId?: string | null;
}

export function ChatInterface({ conversationId }: ChatInterfaceProps) {
  const t = useTranslations("console-chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
        {loadingMessages && (
          <div className="chat-empty">...</div>
        )}

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
            <div className="chat-bubble">{msg.content}</div>
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

      <div className="chat-input-bar">
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
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

const MOCK_RESPONSES = [
  "你好！我是你的 AI 助手，很高兴为你服务。有什么我可以帮你的吗？",
  "这是一个很好的问题。让我为你详细解答一下…",
  "根据我的知识库中的信息，我可以告诉你以下内容…",
  "明白了，让我想想最好的方式来回答你。",
  "感谢你的提问！这个话题很有趣，以下是我的看法…",
];

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function ChatInterface() {
  const t = useTranslations("console-chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  function handleSend() {
    const text = input.trim();
    if (!text || isTyping) return;

    const userMessage: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    const delay = 800 + Math.random() * 1200;
    setTimeout(() => {
      const response =
        MOCK_RESPONSES[Math.floor(Math.random() * MOCK_RESPONSES.length)];
      const aiMessage: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: response,
      };
      setMessages((prev) => [...prev, aiMessage]);
      setIsTyping(false);
    }, delay);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="chat-interface">
      <div className="chat-messages">
        {messages.length === 0 && !isTyping && (
          <div className="chat-empty">{t("emptyHint")}</div>
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
          disabled={isTyping}
        />
        <button
          className="chat-send"
          onClick={handleSend}
          disabled={!input.trim() || isTyping}
        >
          {t("send")}
        </button>
      </div>
    </div>
  );
}

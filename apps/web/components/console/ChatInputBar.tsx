"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";

import { cycleState } from "./chat-types";

export interface ChatInputBarProps {
  onSend: (
    content: string,
    options: {
      enableThinking?: boolean | null;
      enableSearch?: boolean | null;
      imageFile?: File | null;
    },
  ) => void;
  disabled: boolean;
  isTyping: boolean;
  isStandardMode: boolean;
  autoReadEnabled: boolean;
  onAutoReadToggle: () => void;
  /** When called externally (e.g. from dictation), sets the input text. */
  externalInputText?: string | null;
  /** Acknowledge that the external text was consumed. */
  onExternalInputTextConsumed?: () => void;
}

export function ChatInputBar({
  onSend,
  disabled,
  isTyping,
  isStandardMode,
  autoReadEnabled,
  onAutoReadToggle,
  externalInputText,
  onExternalInputTextConsumed,
}: ChatInputBarProps) {
  const t = useTranslations("console-chat");
  const [input, setInput] = useState("");
  const [searchState, setSearchState] = useState<"auto" | "on" | "off">("auto");
  const [thinkState, setThinkState] = useState<"auto" | "on" | "off">("auto");
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const imageCaptureRef = useRef<HTMLInputElement>(null);

  // Accept dictated / external text into the input field
  useEffect(() => {
    if (externalInputText != null && externalInputText !== "") {
      setInput((prev) => {
        const trimmed = prev.trim();
        return trimmed ? `${trimmed} ${externalInputText}` : externalInputText;
      });
      onExternalInputTextConsumed?.();
      // Focus the input so the user can review / edit before sending
      inputRef.current?.focus();
    }
  }, [externalInputText, onExternalInputTextConsumed]);

  const handleImageFileSelected = useCallback(
    (file: File | null) => {
      if (!file) {
        return;
      }
      if (!file.type.startsWith("image/")) {
        return;
      }
      setPendingImageFile(file);
    },
    [],
  );

  const clearPendingImage = useCallback(() => {
    setPendingImageFile(null);
  }, []);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if ((!text && !pendingImageFile) || isTyping || disabled) {
      return;
    }

    const enableThinking =
      thinkState === "on" ? true : thinkState === "off" ? false : null;
    const enableSearch =
      searchState === "on" ? true : searchState === "off" ? false : null;

    onSend(text, {
      enableThinking,
      enableSearch,
      imageFile: pendingImageFile,
    });

    setInput("");
    setPendingImageFile(null);
  }, [disabled, input, isTyping, onSend, pendingImageFile, searchState, thinkState]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <>
      <input
        ref={imageUploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={isTyping || disabled}
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
        disabled={isTyping || disabled}
        data-testid="chat-image-capture-input"
        onChange={(event) => {
          handleImageFileSelected(event.target.files?.[0] || null);
          event.target.value = "";
        }}
      />
      <input
        ref={inputRef}
        className="chat-input"
        type="text"
        placeholder={t("inputPlaceholder")}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={isTyping || disabled}
      />
      <div className="chat-tool-chips">
        {isStandardMode ? (
          <button
            type="button"
            className="chat-tool-chip"
            data-state={autoReadEnabled ? "on" : "auto"}
            onClick={onAutoReadToggle}
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
            disabled={isTyping || disabled}
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
            disabled={isTyping || disabled}
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
          onClick={() => setSearchState((s) => cycleState(s))}
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
          onClick={() => setThinkState((s) => cycleState(s))}
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
        onClick={handleSubmit}
        disabled={(!input.trim() && !pendingImageFile) || isTyping || disabled}
      >
        {t("send")}
      </button>
      {isStandardMode && pendingImageFile ? (
        <div className="chat-attachment-chip">
          <span className="chat-attachment-name">{pendingImageFile.name}</span>
          <button type="button" className="chat-audio-btn" onClick={clearPendingImage}>
            {t("imageClear")}
          </button>
        </div>
      ) : null}
    </>
  );
}

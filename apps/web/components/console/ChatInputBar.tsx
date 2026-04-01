"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useTranslations } from "next-intl";

import { appendNaturalText, cycleState } from "./chat-types";

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
  searchAvailable: boolean;
  autoReadEnabled: boolean;
  onAutoReadToggle: () => void;
  liveExternalInputText?: string | null;
  isLiveExternalInputActive?: boolean;
}

export function ChatInputBar({
  onSend,
  disabled,
  isTyping,
  isStandardMode,
  searchAvailable,
  autoReadEnabled,
  onAutoReadToggle,
  liveExternalInputText,
  isLiveExternalInputActive = false,
}: ChatInputBarProps) {
  const t = useTranslations("console-chat");
  const [input, setInput] = useState("");
  const [searchState, setSearchState] = useState<"auto" | "on" | "off">("auto");
  const [thinkState, setThinkState] = useState<"auto" | "on" | "off">("auto");
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [imageMenuOpen, setImageMenuOpen] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const imageCaptureRef = useRef<HTMLInputElement>(null);
  const liveExternalBaseRef = useRef<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const effectiveSearchState = searchAvailable ? searchState : "auto";

  useEffect(() => {
    if (!isLiveExternalInputActive) {
      liveExternalBaseRef.current = null;
      return;
    }

    setInput((prev) => {
      const base = liveExternalBaseRef.current ?? prev;
      liveExternalBaseRef.current = base;
      const draft = liveExternalInputText || "";
      if (!draft) {
        return base;
      }
      return appendNaturalText(base, draft);
    });
    textareaRef.current?.focus();
  }, [isLiveExternalInputActive, liveExternalInputText]);

  useEffect(() => {
    if (!menuOpen) {
      setImageMenuOpen(false);
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setImageMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const handleImageFileSelected = useCallback((file: File | null) => {
    if (!file || !file.type.startsWith("image/")) {
      return;
    }
    setPendingImageFile(file);
  }, []);

  const clearPendingImage = useCallback(() => {
    setPendingImageFile(null);
  }, []);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (
      (!text && !pendingImageFile) ||
      isTyping ||
      disabled ||
      isLiveExternalInputActive
    ) {
      return;
    }

    const enableThinking =
      thinkState === "on" ? true : thinkState === "off" ? false : null;
    const enableSearch = !searchAvailable
      ? null
      : effectiveSearchState === "on"
        ? true
        : effectiveSearchState === "off"
          ? false
          : null;

    onSend(text, {
      enableThinking,
      enableSearch,
      imageFile: pendingImageFile,
    });

    setInput("");
    setPendingImageFile(null);
    setMenuOpen(false);
    setImageMenuOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [
    disabled,
    effectiveSearchState,
    input,
    isLiveExternalInputActive,
    isTyping,
    onSend,
    pendingImageFile,
    searchAvailable,
    thinkState,
  ]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const activeTools = [
    isStandardMode && autoReadEnabled
      ? {
          key: "auto-read",
          label: t("activeTool.autoRead"),
          onRemove: onAutoReadToggle,
        }
      : null,
    searchAvailable && effectiveSearchState === "on"
      ? {
          key: "search",
          label: t("activeTool.search"),
          onRemove: () => setSearchState("auto"),
        }
      : null,
    thinkState === "on"
      ? {
          key: "think",
          label: t("activeTool.think"),
          onRemove: () => setThinkState("auto"),
        }
      : null,
    isStandardMode && pendingImageFile
      ? {
          key: "image",
          label: t("activeTool.image"),
          onRemove: clearPendingImage,
        }
      : null,
  ].filter(
    (
      item,
    ): item is {
      key: string;
      label: string;
      onRemove: () => void;
    } => item !== null,
  );

  const stateLabel = (state: "auto" | "on" | "off") => {
    if (state === "on") {
      return t("toolState.on");
    }
    if (state === "off") {
      return t("toolState.off");
    }
    return t("toolState.auto");
  };

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
      <div className="chat-input-bar">
        <div className="chat-input-shell">
          {activeTools.length ? (
            <div className="chat-active-tools" aria-label={t("toolsLabel")}>
              {activeTools.map((tool) => (
                <button
                  key={tool.key}
                  type="button"
                  className="chat-active-tool"
                  onClick={tool.onRemove}
                >
                  <span>{tool.label}</span>
                  <span className="chat-active-tool-dismiss">×</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="chat-input-container">
            <textarea
              ref={textareaRef}
              className="chat-input-textarea"
              value={input}
              onChange={(event) => {
                setInput(event.target.value);
                handleInput();
              }}
              onKeyDown={handleKeyDown}
              placeholder={t("inputPlaceholder")}
              aria-label={t("inputPlaceholder")}
              rows={1}
              disabled={isTyping || disabled || isLiveExternalInputActive}
            />

            {isStandardMode && pendingImageFile ? (
              <div className="chat-attachment-chip">
                <span className="chat-attachment-name">
                  {pendingImageFile.name}
                </span>
                <button
                  type="button"
                  className="chat-audio-btn"
                  onClick={clearPendingImage}
                >
                  {t("imageClear")}
                </button>
              </div>
            ) : null}

            <div className="chat-input-toolbar">
              <div
                className="chat-input-toolbar-group chat-input-toolbar-group--utilities"
                ref={menuRef}
              >
                <button
                  type="button"
                  className={`chat-tools-trigger${menuOpen ? " is-open" : ""}`}
                  onClick={() => setMenuOpen((current) => !current)}
                  disabled={disabled || isLiveExternalInputActive}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                >
                  <svg
                    width={14}
                    height={14}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 3v18" />
                    <path d="M3 12h18" />
                  </svg>
                  <span>{t("toolsLabel")}</span>
                </button>

                {menuOpen ? (
                  <div className="chat-tools-menu" role="menu">
                    {isStandardMode ? (
                      <button
                        type="button"
                        className="chat-tools-menu-item"
                        role="menuitem"
                        onClick={() => {
                          onAutoReadToggle();
                          setMenuOpen(false);
                        }}
                      >
                        <span>{t("voiceAutoRead")}</span>
                        <span>
                          {autoReadEnabled ? t("toolState.on") : t("toolState.off")}
                        </span>
                      </button>
                    ) : null}

                    {isStandardMode ? (
                      <div className="chat-tools-menu-group">
                        <button
                          type="button"
                          className="chat-tools-menu-item"
                          role="menuitem"
                          onClick={() => setImageMenuOpen((current) => !current)}
                          disabled={
                            isTyping || disabled || isLiveExternalInputActive
                          }
                        >
                          <span>{t("tool.addImage")}</span>
                          <span>{imageMenuOpen ? "−" : "+"}</span>
                        </button>
                        {imageMenuOpen ? (
                          <div className="chat-tools-submenu">
                            <button
                              type="button"
                              className="chat-tools-menu-item is-subitem"
                              role="menuitem"
                              onClick={() => {
                                imageUploadRef.current?.click();
                                setMenuOpen(false);
                                setImageMenuOpen(false);
                              }}
                            >
                              <span>{t("imageUpload")}</span>
                            </button>
                            <button
                              type="button"
                              className="chat-tools-menu-item is-subitem"
                              role="menuitem"
                              onClick={() => {
                                imageCaptureRef.current?.click();
                                setMenuOpen(false);
                                setImageMenuOpen(false);
                              }}
                            >
                              <span>{t("imageCapture")}</span>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {searchAvailable ? (
                      <button
                        type="button"
                        className="chat-tools-menu-item"
                        role="menuitem"
                        onClick={() =>
                          setSearchState((current) => cycleState(current))
                        }
                      >
                        <span>{t("tool.searchExpanded")}</span>
                        <span>{stateLabel(effectiveSearchState)}</span>
                      </button>
                    ) : null}

                    <button
                      type="button"
                      className="chat-tools-menu-item"
                      role="menuitem"
                      onClick={() =>
                        setThinkState((current) => cycleState(current))
                      }
                    >
                      <span>{t("tool.thinkExpanded")}</span>
                      <span>{stateLabel(thinkState)}</span>
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="chat-input-toolbar-group chat-input-toolbar-group--send">
                <button
                  type="button"
                  className={`chat-input-send${input.trim() || pendingImageFile ? " has-content" : ""}`}
                  onClick={handleSubmit}
                  disabled={
                    (!input.trim() && !pendingImageFile) ||
                    isTyping ||
                    disabled ||
                    isLiveExternalInputActive
                  }
                >
                  <span>{t("send")}</span>
                  <svg
                    width={14}
                    height={14}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

"use client";

import { useTranslations } from "next-intl";

import type { ChatMode } from "./chat-types";

export interface ChatModePanelProps {
  chatMode: ChatMode;
  projectDefaultMode: ChatMode;
  syntheticModeAvailable: boolean;
  onModeChange: (mode: ChatMode) => void;
  disabled: boolean;
}

export function ChatModePanel({
  chatMode,
  projectDefaultMode,
  syntheticModeAvailable,
  onModeChange,
  disabled,
}: ChatModePanelProps) {
  const t = useTranslations("console-chat");

  const options: { key: ChatMode; label: string; isDisabled?: boolean }[] = [
    { key: "standard", label: t("mode.standard") },
    { key: "omni_realtime", label: t("mode.omni") },
    {
      key: "synthetic_realtime",
      label: t("mode.synthetic"),
      isDisabled: !syntheticModeAvailable,
    },
  ];

  return (
    <div className="chat-mode-switcher">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`chat-mode-chip${chatMode === option.key ? " is-active" : ""}`}
          onClick={() => {
            if (!option.isDisabled && !disabled) {
              onModeChange(option.key);
            }
          }}
          disabled={option.isDisabled || disabled}
        >
          {option.label}
          {projectDefaultMode === option.key ? (
            <span className="chat-mode-default">{t("mode.default")}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

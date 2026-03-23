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
  const options = [
    { key: "standard", label: t("mode.standard") },
    { key: "omni_realtime", label: t("mode.omni") },
    { key: "synthetic_realtime", label: t("mode.synthetic") },
  ];
  return (
    <select
      className="chat-mode-dropdown"
      value={chatMode}
      disabled={disabled}
      onChange={(e) => onModeChange(e.target.value as ChatMode)}
    >
      {options.map((o) => (
        <option key={o.key} value={o.key} disabled={o.key === "synthetic_realtime" && !syntheticModeAvailable}>
          {o.label}{o.key === projectDefaultMode ? ` (${t("mode.default")})` : ""}
        </option>
      ))}
    </select>
  );
}

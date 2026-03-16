"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";

import { useDeveloperMode } from "@/lib/developer-mode";

import type { ParsedDescription } from "./CanvasWorkbench";

interface PersonalityCardProps {
  parsed: ParsedDescription;
  rawDescription: string;
  onDescriptionChange?: (desc: string) => void;
}

export function PersonalityCard({
  parsed,
  rawDescription,
  onDescriptionChange,
}: PersonalityCardProps) {
  const t = useTranslations("console-assistants");
  const { isDeveloperMode } = useDeveloperMode();

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(parsed.personality || "");
  const [expanded, setExpanded] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(parsed.personality || "");

  const handleToggleEdit = () => {
    if (editing) {
      // Save: update parent if callback provided
      onDescriptionChange?.(editValue);
    } else {
      setEditValue(parsed.personality || "");
    }
    setEditing((prev) => !prev);
  };

  return (
    <div className="canvas-card">
      <div className="canvas-card-header">
        <span className="canvas-card-label">{t("canvas.personality")}</span>
        <button
          type="button"
          className="canvas-card-action"
          onClick={handleToggleEdit}
        >
          {editing ? t("canvas.save") : t("canvas.edit")}
        </button>
      </div>

      <div className="canvas-card-body">
        {editing ? (
          <textarea
            className="canvas-personality-textarea"
            rows={4}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
          />
        ) : (
          <div className="canvas-personality-box">
            {parsed.personality || (
              <span className="canvas-placeholder">---</span>
            )}
          </div>
        )}

        {parsed.tags.length > 0 && (
          <div className="canvas-tag-list">
            {parsed.tags.map((tag) => (
              <span key={tag} className="canvas-tag">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        className="canvas-card-expand"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? t("canvas.collapseAdvanced") : t("canvas.expandAdvanced")}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div className="canvas-advanced-content">
              <label className="canvas-advanced-label">System Prompt</label>
              <textarea
                className="canvas-system-prompt"
                rows={6}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isDeveloperMode && (
        <div className="canvas-card-dev-info">
          <span>raw params_json:</span>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {rawDescription || "N/A"}
          </pre>
        </div>
      )}
    </div>
  );
}

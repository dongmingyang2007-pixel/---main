"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";

import { useDeveloperMode } from "@/lib/developer-mode";

import type { ParsedDescription } from "./CanvasWorkbench";

const DEFAULT_SKILLS: { name: string; icon: string }[] = [
  { name: "\u77E5\u8BC6\u68C0\u7D22", icon: "\uD83D\uDD0D" },
  { name: "\u667A\u80FD\u95EE\u7B54", icon: "\uD83D\uDCAC" },
];

interface SkillsCardProps {
  parsed: ParsedDescription;
}

export function SkillsCard({ parsed }: SkillsCardProps) {
  const t = useTranslations("console-assistants");
  const { isDeveloperMode } = useDeveloperMode();

  const [expanded, setExpanded] = useState(false);

  // Derive skills: if personality suggests a template, provide placeholder skills
  const skills =
    parsed.personality && parsed.personality.length > 0
      ? DEFAULT_SKILLS
      : [];

  return (
    <div className="canvas-card">
      <div className="canvas-card-header">
        <span className="canvas-card-label">{t("canvas.skills")}</span>
        <button type="button" className="canvas-card-action">
          {t("canvas.add")}
        </button>
      </div>

      <div className="canvas-card-body">
        {skills.length === 0 ? (
          <p className="canvas-empty-hint">{t("canvas.noSkills")}</p>
        ) : (
          <ul className="canvas-skills-list">
            {skills.map((skill) => (
              <li key={skill.name} className="canvas-skill-item">
                <span className="canvas-skill-icon">{skill.icon}</span>
                <span className="canvas-skill-name">{skill.name}</span>
              </li>
            ))}
          </ul>
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
              <label className="canvas-advanced-label">
                {t("canvas.skillParameters")}
              </label>
              <textarea
                className="canvas-system-prompt"
                rows={4}
                readOnly
                value={JSON.stringify(
                  skills.map((s) => ({ name: s.name })),
                  null,
                  2,
                )}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isDeveloperMode && (
        <div className="canvas-card-dev-info">
          <span>tools/functions:</span>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {JSON.stringify(skills, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

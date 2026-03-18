"use client";

import { useEffect, useReducer, useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";

import { apiGet } from "@/lib/api";
import { useDeveloperMode } from "@/lib/developer-mode";

interface DatasetInfo {
  id: string;
  name: string;
  item_count?: number;
  version?: string;
}

interface KnowledgeCardProps {
  assistantId: string;
}

type KnowledgeState = {
  loading: boolean;
  datasets: DatasetInfo[];
};

type KnowledgeAction =
  | { type: "request" }
  | { type: "success"; datasets: DatasetInfo[] }
  | { type: "failure" };

function knowledgeReducer(
  state: KnowledgeState,
  action: KnowledgeAction,
): KnowledgeState {
  switch (action.type) {
    case "request":
      return { ...state, loading: true };
    case "success":
      return { loading: false, datasets: action.datasets };
    case "failure":
      return { loading: false, datasets: [] };
    default:
      return state;
  }
}

export function KnowledgeCard({ assistantId }: KnowledgeCardProps) {
  const t = useTranslations("console-assistants");
  const { isDeveloperMode } = useDeveloperMode();

  const [{ datasets, loading }, dispatch] = useReducer(knowledgeReducer, {
    loading: true,
    datasets: [],
  });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!assistantId) return;
    dispatch({ type: "request" });
    void apiGet<DatasetInfo[]>(`/api/v1/datasets?project_id=${assistantId}`)
      .then((data) => {
        dispatch({
          type: "success",
          datasets: Array.isArray(data) ? data : [],
        });
      })
      .catch(() => {
        dispatch({ type: "failure" });
      });
  }, [assistantId]);

  const firstDatasetId = datasets.length > 0 ? datasets[0].id : null;

  return (
    <div className="canvas-card">
      <div className="canvas-card-header">
        <span className="canvas-card-label">{t("canvas.knowledge")}</span>
        {firstDatasetId && (
          <a
            href={`/app/knowledge/${firstDatasetId}`}
            className="canvas-card-action"
          >
            {t("canvas.manage")}
          </a>
        )}
      </div>

      <div className="canvas-card-body">
        {loading ? (
          <span className="canvas-placeholder">{"\u2026"}</span>
        ) : datasets.length === 0 ? (
          <p className="canvas-empty-hint">{t("canvas.noDatasets")}</p>
        ) : (
          <ul className="canvas-knowledge-list">
            {datasets.map((ds) => (
              <li key={ds.id} className="canvas-knowledge-item">
                <span className="canvas-knowledge-name">{ds.name}</span>
                {ds.item_count != null && (
                  <span className="canvas-knowledge-count">
                    {t("canvas.knowledgeItems", { count: ds.item_count })}
                  </span>
                )}
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
              {datasets.length > 0 ? (
                datasets.map((ds) => (
                  <div key={ds.id} className="canvas-advanced-row">
                    <span>{ds.name}</span>
                    <span>{t("canvas.knowledgeItems", { count: ds.item_count ?? 0 })}</span>
                    {ds.version && <span>v{ds.version}</span>}
                  </div>
                ))
              ) : (
                <span className="canvas-placeholder">--</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isDeveloperMode && datasets.length > 0 && (
        <div className="canvas-card-dev-info">
          {datasets.map((ds) => (
            <span key={ds.id}>
              dataset_id: {ds.id}, item_count: {ds.item_count ?? "N/A"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";

interface GraphControlsProps {
  nodeCount: number;
  fileCount: number;
  onAdd: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
}

export default function GraphControls({
  nodeCount,
  fileCount,
  onAdd,
  searchQuery,
  onSearchChange,
  onZoomIn,
  onZoomOut,
  onFitView,
}: GraphControlsProps) {
  const t = useTranslations("console-assistants");

  return (
    <div className="graph-controls">
      <div className="graph-controls-left">
        <button className="graph-controls-btn is-add" onClick={onAdd}>
          + {t("graph.addMemory")}
        </button>
        <input
          type="text"
          className="graph-controls-search"
          placeholder={t("graph.search")}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="graph-controls-right">
        <span className="graph-controls-stats">
          {t("graph.stats", { count: nodeCount })} {fileCount > 0 ? t("graph.statsFiles", { count: fileCount }) : ""}
        </span>
        <button className="graph-controls-btn is-zoom" onClick={onZoomIn} title={t("graph.zoomIn")} aria-label={t("graph.zoomIn")}>
          +
        </button>
        <button className="graph-controls-btn is-zoom" onClick={onZoomOut} title={t("graph.zoomOut")} aria-label={t("graph.zoomOut")}>
          &minus;
        </button>
        <button className="graph-controls-btn is-zoom" onClick={onFitView} title={t("graph.fitView")} aria-label={t("graph.fitView")}>
          ⊞
        </button>
      </div>
    </div>
  );
}

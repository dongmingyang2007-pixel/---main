"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { MemoryNode } from "@/hooks/useGraphData";

export interface GraphFilterState {
  types: string[];
  categories: string[];
  sources: string[];
  timeRange: "24h" | "7d" | "30d" | "all";
}

interface GraphFiltersProps {
  nodes: MemoryNode[];
  activeFilters: GraphFilterState;
  onFilterChange: (filters: GraphFilterState) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const TYPE_OPTIONS = ["permanent", "temporary", "file"] as const;
const SOURCE_OPTIONS = ["conversation", "manual", "promoted", "file_upload"] as const;

function isFileNode(node: MemoryNode): boolean {
  return node.category === "file" || node.category === "文件" || node.metadata_json?.node_kind === "file";
}

function getNodeSources(node: MemoryNode): string[] {
  if (isFileNode(node)) {
    return ["file_upload"];
  }
  const metadata = (node.metadata_json || {}) as Record<string, unknown>;
  if (metadata.promoted_by) {
    return ["promoted"];
  }
  if (node.source_conversation_id) {
    return ["conversation"];
  }
  return ["manual"];
}

export default function GraphFilters({
  nodes,
  activeFilters,
  onFilterChange,
  collapsed,
  onToggleCollapsed,
}: GraphFiltersProps) {
  const t = useTranslations("console-assistants");
  const categories = useMemo(() => {
    const cats = new Set<string>();
    nodes.forEach((n) => {
      if (n.category && !isFileNode(n)) cats.add(n.category);
    });
    return Array.from(cats).sort();
  }, [nodes]);
  const sourceOptions = useMemo(
    () =>
      SOURCE_OPTIONS.filter((source) =>
        nodes.some((node) => getNodeSources(node).includes(source)),
      ),
    [nodes],
  );
  const timeOptions: { value: GraphFilterState["timeRange"]; label: string }[] = [
    { value: "24h", label: t("graph.last24h") },
    { value: "7d", label: t("graph.last7d") },
    { value: "30d", label: t("graph.last30d") },
    { value: "all", label: t("graph.filterAll") },
  ];
  const activeFilterCount =
    activeFilters.types.length +
    activeFilters.categories.length +
    activeFilters.sources.length +
    (activeFilters.timeRange === "all" ? 0 : 1);

  const toggleType = (type: string) => {
    const next = activeFilters.types.includes(type)
      ? activeFilters.types.filter((t) => t !== type)
      : [...activeFilters.types, type];
    onFilterChange({ ...activeFilters, types: next });
  };

  const toggleCategory = (cat: string) => {
    const next = activeFilters.categories.includes(cat)
      ? activeFilters.categories.filter((c) => c !== cat)
      : [...activeFilters.categories, cat];
    onFilterChange({ ...activeFilters, categories: next });
  };

  const toggleSource = (source: string) => {
    const next = activeFilters.sources.includes(source)
      ? activeFilters.sources.filter((value) => value !== source)
      : [...activeFilters.sources, source];
    onFilterChange({ ...activeFilters, sources: next });
  };

  const setTimeRange = (range: GraphFilterState["timeRange"]) => {
    onFilterChange({ ...activeFilters, timeRange: range });
  };

  if (collapsed) {
    return (
      <div className="graph-filters is-collapsed">
        <button
          type="button"
          className="graph-filters-toggle"
          onClick={onToggleCollapsed}
          title={t("graph.expandFilters")}
          aria-label={t("graph.expandFilters")}
        >
          <span className="graph-filters-toggle-icon">&rsaquo;</span>
          <span className="graph-filters-toggle-count">{activeFilterCount}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="graph-filters">
      <div className="graph-filters-header">
        <div className="graph-filters-title">{t("graph.filter")}</div>
        <button
          type="button"
          className="graph-filters-toggle"
          onClick={onToggleCollapsed}
          title={t("graph.collapseFilters")}
          aria-label={t("graph.collapseFilters")}
        >
          &lsaquo;
        </button>
      </div>

      <div className="graph-filters-section">
        <div className="graph-filters-section-title">{t("graph.filterByType")}</div>
        {TYPE_OPTIONS.map((value) => (
          <label key={value} className="graph-filters-item">
            <input
              type="checkbox"
              checked={activeFilters.types.includes(value)}
              onChange={() => toggleType(value)}
            />
            <span>
              {value === "permanent"
                ? t("graph.filterPermanent")
                : value === "temporary"
                ? t("graph.filterTemporary")
                : t("graph.filterFiles")}
            </span>
          </label>
        ))}
      </div>

      {categories.length > 0 && (
        <div className="graph-filters-section">
          <div className="graph-filters-section-title">{t("graph.filterByCategory")}</div>
          {categories.map((cat) => (
            <label key={cat} className="graph-filters-item">
              <input
                type="checkbox"
                checked={activeFilters.categories.includes(cat)}
                onChange={() => toggleCategory(cat)}
              />
              <span>{cat}</span>
            </label>
          ))}
        </div>
      )}

      {sourceOptions.length > 0 && (
        <div className="graph-filters-section">
          <div className="graph-filters-section-title">{t("graph.filterBySource")}</div>
          {sourceOptions.map((source) => (
            <label key={source} className="graph-filters-item">
              <input
                type="checkbox"
                checked={activeFilters.sources.includes(source)}
                onChange={() => toggleSource(source)}
              />
              <span>
                {source === "conversation"
                  ? t("graph.sourceCurrentConversation")
                  : source === "promoted"
                  ? t("graph.sourcePromoted")
                  : source === "file_upload"
                  ? t("graph.sourceFiles")
                  : t("graph.sourceManual")}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="graph-filters-section">
        <div className="graph-filters-section-title">{t("graph.filterByTime")}</div>
        <div className="graph-filters-time-buttons">
          {timeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`graph-filters-time-btn${
                activeFilters.timeRange === opt.value ? " is-active" : ""
              }`}
              onClick={() => setTimeRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import type { MemoryNode } from "@/hooks/useGraphData";

export interface GraphFilterState {
  types: string[];
  categories: string[];
  timeRange: "24h" | "7d" | "30d" | "all";
}

interface GraphFiltersProps {
  nodes: MemoryNode[];
  activeFilters: GraphFilterState;
  onFilterChange: (filters: GraphFilterState) => void;
}

const TYPE_OPTIONS = [
  { value: "permanent", label: "永久记忆" },
  { value: "temporary", label: "临时记忆" },
  { value: "file", label: "文件" },
];

const TIME_OPTIONS: { value: GraphFilterState["timeRange"]; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "全部" },
];

export default function GraphFilters({
  nodes,
  activeFilters,
  onFilterChange,
}: GraphFiltersProps) {
  const categories = useMemo(() => {
    const cats = new Set<string>();
    nodes.forEach((n) => {
      if (n.category) cats.add(n.category);
    });
    return Array.from(cats).sort();
  }, [nodes]);

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

  const setTimeRange = (range: GraphFilterState["timeRange"]) => {
    onFilterChange({ ...activeFilters, timeRange: range });
  };

  return (
    <div className="graph-filters">
      <div className="graph-filters-title">筛选</div>

      <div className="graph-filters-section">
        <div className="graph-filters-section-title">类型</div>
        {TYPE_OPTIONS.map((opt) => (
          <label key={opt.value} className="graph-filters-item">
            <input
              type="checkbox"
              checked={activeFilters.types.includes(opt.value)}
              onChange={() => toggleType(opt.value)}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>

      {categories.length > 0 && (
        <div className="graph-filters-section">
          <div className="graph-filters-section-title">分类</div>
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

      <div className="graph-filters-section">
        <div className="graph-filters-section-title">时间</div>
        <div className="graph-filters-time-buttons">
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
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

"use client";

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
  return (
    <div className="graph-controls">
      <div className="graph-controls-left">
        <button className="graph-controls-btn is-add" onClick={onAdd}>
          + 添加记忆
        </button>
        <input
          type="text"
          className="graph-controls-search"
          placeholder="搜索记忆..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      <div className="graph-controls-right">
        <span className="graph-controls-stats">
          共 {nodeCount} 个记忆 &middot; {fileCount} 个文件
        </span>
        <button className="graph-controls-btn is-zoom" onClick={onZoomIn}>
          +
        </button>
        <button className="graph-controls-btn is-zoom" onClick={onZoomOut}>
          &minus;
        </button>
        <button className="graph-controls-btn is-zoom" onClick={onFitView}>
          ⊞
        </button>
      </div>
    </div>
  );
}

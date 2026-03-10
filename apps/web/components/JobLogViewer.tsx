"use client";

import { useMemo } from "react";

export function JobLogViewer({ logs }: { logs: string[] }) {
  const text = useMemo(() => logs.join("\n"), [logs]);

  return (
    <div className="console-panel console-panel-dark overflow-hidden text-xs text-[#d5e3ff]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <strong>作业日志</strong>
        <button
          type="button"
          className="console-button"
          onClick={() => navigator.clipboard.writeText(text)}
        >
          复制
        </button>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-4 py-4">{text || "暂无日志"}</pre>
    </div>
  );
}

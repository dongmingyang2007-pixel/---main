import { ReactNode } from "react";

export function DataTable({
  headers,
  rows,
  caption,
  emptyTitle = "暂无数据",
  emptyBody = "当前还没有可展示的内容。",
  compact = false,
}: {
  headers: string[];
  rows: Array<Array<ReactNode>>;
  caption?: string;
  emptyTitle?: string;
  emptyBody?: string;
  compact?: boolean;
}) {
  return (
    <div className="console-panel console-table-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="bg-[rgba(9,17,31,0.04)] text-left text-[var(--muted)]">
            {headers.map((header) => (
                <th
                  key={header}
                  className={compact ? "border-b border-[var(--line)] px-4 py-3 font-semibold" : "border-b border-[var(--line)] px-5 py-4 font-semibold"}
                >
                {header}
              </th>
            ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-[rgba(9,17,31,0.06)] last:border-b-0">
                {row.map((col, j) => (
                  <td key={`${i}-${j}`} className={compact ? "px-4 py-3 align-top" : "px-5 py-4 align-top"}>
                    {col}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td className="px-5 py-12" colSpan={headers.length}>
                  <div className="console-empty">
                    <div className="text-sm font-semibold text-[var(--fg)]">{emptyTitle}</div>
                    <div className="mt-2 text-sm text-[var(--muted)]">{emptyBody}</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

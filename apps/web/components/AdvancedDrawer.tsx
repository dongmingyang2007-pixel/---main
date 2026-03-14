import type { ReactNode } from "react";

export function AdvancedDrawer({
  title,
  summary,
  kicker = "Advanced Controls",
  toggleLabel = "展开",
  children,
  defaultOpen = false,
}: {
  title: string;
  summary: string;
  kicker?: string;
  toggleLabel?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="advanced-drawer" open={defaultOpen}>
      <summary className="advanced-drawer-summary">
        <div>
          <div className="console-kicker">{kicker}</div>
          <h2 className="console-panel-title mt-2">{title}</h2>
          <p className="console-panel-description mt-2">{summary}</p>
        </div>
        <span className="advanced-drawer-toggle">{toggleLabel}</span>
      </summary>
      <div className="advanced-drawer-body">{children}</div>
    </details>
  );
}

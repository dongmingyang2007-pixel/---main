import type { ReactNode } from "react";

export function AdvancedDrawer({
  title,
  summary,
  children,
  defaultOpen = false,
}: {
  title: string;
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="advanced-drawer" open={defaultOpen}>
      <summary className="advanced-drawer-summary">
        <div>
          <div className="console-kicker">Advanced Controls</div>
          <h2 className="console-panel-title mt-2">{title}</h2>
          <p className="console-panel-description mt-2">{summary}</p>
        </div>
        <span className="advanced-drawer-toggle">展开</span>
      </summary>
      <div className="advanced-drawer-body">{children}</div>
    </details>
  );
}

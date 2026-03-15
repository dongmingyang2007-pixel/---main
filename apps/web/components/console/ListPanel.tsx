"use client";

import { type ReactNode, useState, useEffect, useCallback } from "react";
import clsx from "clsx";

const STORAGE_KEY = "console-list-panel-collapsed";

function readPersistedState(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistState(collapsed: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Ignore storage errors
  }
}

export function ListPanel({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(readPersistedState());
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      persistState(next);
      return next;
    });
  }, []);

  return (
    <aside className={clsx("list-panel", collapsed && "is-collapsed")}>
      <div className="list-panel-content">{children}</div>
      <button
        className="list-panel-toggle"
        onClick={toggle}
        aria-label={collapsed ? "Expand panel" : "Collapse panel"}
        type="button"
      >
        <svg
          width={12}
          height={12}
          viewBox="0 0 12 12"
          fill="currentColor"
          style={{
            transform: collapsed ? "rotate(180deg)" : undefined,
            transition: "transform 200ms",
          }}
        >
          <path d="M8 2L4 6l4 4" />
        </svg>
      </button>
    </aside>
  );
}

"use client";

import { type ReactNode, useCallback, useSyncExternalStore } from "react";
import clsx from "clsx";

const STORAGE_KEY = "console-list-panel-collapsed";
const STORAGE_EVENT = "console-list-panel-collapsed-change";

function readPersistedState(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistState(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    window.dispatchEvent(new Event(STORAGE_EVENT));
  } catch {
    // Ignore storage errors
  }
}

function subscribeCollapsedState(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const handleStorage = (event: Event) => {
    if (!(event instanceof StorageEvent) || event.key === STORAGE_KEY) {
      onStoreChange();
    }
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(STORAGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(STORAGE_EVENT, onStoreChange);
  };
}

export function ListPanel({ children }: { children: ReactNode }) {
  const collapsed = useSyncExternalStore(
    subscribeCollapsedState,
    readPersistedState,
    () => false,
  );

  const toggle = useCallback(() => {
    persistState(!collapsed);
  }, [collapsed]);

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

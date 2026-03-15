"use client";

import { type ReactNode } from "react";
import { ActivityBar } from "./ActivityBar";
import { InlineTopBar } from "./InlineTopBar";
import { StatusBar } from "./StatusBar";

export function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <div className="console-shell">
      <div className="console-shell-body">
        <ActivityBar />
        <div className="console-shell-workspace">
          <InlineTopBar />
          {children}
        </div>
      </div>
      <StatusBar />
    </div>
  );
}

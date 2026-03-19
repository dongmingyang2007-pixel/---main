"use client";

import { type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { InlineTopBar } from "./InlineTopBar";
import { StatusBar } from "./StatusBar";

interface ConsoleShellProps {
  children: ReactNode;
}

export function ConsoleShell({ children }: ConsoleShellProps) {
  return (
    <div className="console-shell-v2">
      <div className="console-shell-body-v2">
        <Sidebar />
        <main className="console-shell-main">
          <InlineTopBar />
          <div className="console-shell-content">{children}</div>
        </main>
      </div>
      <StatusBar />
    </div>
  );
}

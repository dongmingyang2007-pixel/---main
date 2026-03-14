"use client";

import { useState, useCallback, type ReactNode } from "react";
import { ActivityBar } from "./ActivityBar";
import { TopBar } from "./TopBar";
import { StatusBar } from "./StatusBar";
import { MobileConsoleNav } from "./MobileConsoleNav";

export function ConsoleShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  return (
    <div className="console-shell">
      <TopBar onMenuClick={() => setMobileOpen(true)} />
      <div className="console-shell-body">
        <ActivityBar />
        <div className="console-shell-workspace">{children}</div>
      </div>
      <StatusBar />
      <MobileConsoleNav open={mobileOpen} onClose={closeMobile} />
    </div>
  );
}

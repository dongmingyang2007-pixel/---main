"use client";

import { useEffect } from "react";
import { ProjectProvider } from "@/lib/ProjectContext";
import { MobileMenuProvider } from "@/components/MobileMenuProvider";
import { UnifiedHeader } from "@/components/UnifiedHeader";
import { UnifiedMobileNav } from "@/components/UnifiedMobileNav";
import { ConsoleShell } from "@/components/console/ConsoleShell";
import { CommandPalette } from "@/components/console/CommandPalette";
import { Toaster } from "@/components/ui/toaster";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", "console");
    return () => {
      root.removeAttribute("data-theme");
    };
  }, []);

  return (
    <ProjectProvider>
      <MobileMenuProvider>
        <UnifiedHeader />
        <div className="console-layout-shell">
          <ConsoleShell>{children}</ConsoleShell>
        </div>
        <CommandPalette />
        <Toaster />
        <UnifiedMobileNav mode="console" />
      </MobileMenuProvider>
    </ProjectProvider>
  );
}

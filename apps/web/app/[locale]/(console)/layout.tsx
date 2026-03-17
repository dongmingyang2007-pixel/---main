"use client";

import { ProjectProvider } from "@/lib/ProjectContext";
import { DevModeProvider } from "@/lib/developer-mode";
import { MobileMenuProvider } from "@/components/MobileMenuProvider";
import { UnifiedHeader } from "@/components/UnifiedHeader";
import { UnifiedMobileNav } from "@/components/UnifiedMobileNav";
import { ConsoleShell } from "@/components/console/ConsoleShell";
import { MobileTabBar } from "@/components/console/MobileTabBar";
import { CommandPalette } from "@/components/console/CommandPalette";
import { Toaster } from "@/components/ui/toaster";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProjectProvider>
      <DevModeProvider>
        <MobileMenuProvider>
          <div data-theme="console">
            <UnifiedHeader />
            <div className="console-layout-shell">
              <ConsoleShell>
                {children}
              </ConsoleShell>
            </div>
            <UnifiedMobileNav mode="console" />
            <MobileTabBar />
            <CommandPalette />
            <Toaster />
          </div>
        </MobileMenuProvider>
      </DevModeProvider>
    </ProjectProvider>
  );
}

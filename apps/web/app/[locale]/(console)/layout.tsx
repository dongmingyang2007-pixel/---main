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
import { ModalProvider } from "@/components/ui/modal-dialog";
import { AuthSessionGuard } from "@/components/AuthSessionGuard";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProjectProvider>
      <DevModeProvider>
        <MobileMenuProvider>
          <ModalProvider>
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
              <AuthSessionGuard />
              <Toaster />
            </div>
          </ModalProvider>
        </MobileMenuProvider>
      </DevModeProvider>
    </ProjectProvider>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { ProjectProvider } from "@/lib/ProjectContext";
import { UnifiedHeader } from "@/components/UnifiedHeader";
import { UnifiedMobileNav } from "@/components/UnifiedMobileNav";
import { ConsoleShell } from "@/components/console/ConsoleShell";
import { CommandPalette } from "@/components/console/CommandPalette";
import { Toaster } from "@/components/ui/toaster";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", "console");
    root.classList.add("dark");
    return () => {
      root.removeAttribute("data-theme");
      root.classList.remove("dark");
    };
  }, []);

  return (
    <ProjectProvider>
      <UnifiedHeader onMobileMenuOpen={() => setMobileOpen(true)} />
      <ConsoleShell>{children}</ConsoleShell>
      <CommandPalette />
      <Toaster />
      <UnifiedMobileNav open={mobileOpen} onClose={closeMobile} mode="console" />
    </ProjectProvider>
  );
}

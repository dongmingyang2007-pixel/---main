"use client";

import { useEffect } from "react";
import { ProjectProvider } from "@/lib/ProjectContext";
import { ConsoleShell } from "@/components/console/ConsoleShell";
import { CommandPalette } from "@/components/console/CommandPalette";
import { Toaster } from "@/components/ui/toaster";

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      <ConsoleShell>{children}</ConsoleShell>
      <CommandPalette />
      <Toaster />
    </ProjectProvider>
  );
}

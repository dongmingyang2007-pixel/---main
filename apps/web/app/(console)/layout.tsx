"use client";

import { useEffect } from "react";
import { ProjectProvider } from "@/lib/ProjectContext";
import { AppShell } from "@/components/AppShell";

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
      <AppShell title="Control Console">{children}</AppShell>
    </ProjectProvider>
  );
}

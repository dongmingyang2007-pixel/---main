import { AppShell } from "@/components/AppShell";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return <AppShell title="Control Console">{children}</AppShell>;
}

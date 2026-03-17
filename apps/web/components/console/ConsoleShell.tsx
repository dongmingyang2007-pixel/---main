"use client";

import { type ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";
import { IconBar } from "./IconBar";
import { ConsoleSectionList } from "./ConsoleSectionList";
import { InlineTopBar } from "./InlineTopBar";
import { ListPanel } from "./ListPanel";
import { StatusBar } from "./StatusBar";

interface ConsoleShellProps {
  listContent?: ReactNode;
  children: ReactNode;
}

export function ConsoleShell({ listContent, children }: ConsoleShellProps) {
  const pathname = usePathname();
  const resolvedListContent =
    listContent !== undefined
      ? listContent
      : /^\/app\/(assistants|knowledge|training|chat)(?:\/|$)/.test(pathname)
        ? <ConsoleSectionList />
        : undefined;

  return (
    <div className="console-shell-v2">
      <div className="console-shell-body-v2">
        <IconBar />
        {resolvedListContent !== undefined && (
          <ListPanel>{resolvedListContent}</ListPanel>
        )}
        <main className="console-shell-main">
          <InlineTopBar />
          <div className="console-shell-content">{children}</div>
        </main>
      </div>
      <StatusBar />
    </div>
  );
}

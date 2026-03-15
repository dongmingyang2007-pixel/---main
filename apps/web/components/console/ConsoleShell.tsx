"use client";

import { type ReactNode } from "react";
import { ConsoleTopBar } from "./ConsoleTopBar";
import { IconBar } from "./IconBar";
import { ListPanel } from "./ListPanel";
import { StatusBar } from "./StatusBar";

interface ConsoleShellProps {
  listContent?: ReactNode;
  children: ReactNode;
}

export function ConsoleShell({ listContent, children }: ConsoleShellProps) {
  return (
    <div className="console-shell-v2">
      <ConsoleTopBar />
      <div className="console-shell-body-v2">
        <IconBar />
        {listContent !== undefined && (
          <ListPanel>{listContent}</ListPanel>
        )}
        <main className="console-shell-main">{children}</main>
      </div>
      <StatusBar />
    </div>
  );
}

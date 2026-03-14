"use client";

import type { ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

interface PanelLayoutProps {
  listPanel?: ReactNode;
  inspectorPanel?: ReactNode;
  children: ReactNode;
  storageKey?: string;
}

export function PanelLayout({
  listPanel,
  inspectorPanel,
  children,
  storageKey = "console-panels",
}: PanelLayoutProps) {
  // Build default layout based on which panels are shown
  const defaultLayout: Record<string, number> = {};
  if (listPanel) defaultLayout["list"] = 20;
  defaultLayout["content"] = listPanel && inspectorPanel ? 58 : listPanel ? 80 : inspectorPanel ? 78 : 100;
  if (inspectorPanel) defaultLayout["inspector"] = 22;

  return (
    <Group
      orientation="horizontal"
      id={storageKey}
      defaultLayout={defaultLayout}
      className="panel-group"
    >
      {listPanel && (
        <>
          <Panel
            id="list"
            minSize="200px"
            maxSize="400px"
            className="panel-list"
          >
            <div className="panel-content" role="complementary" aria-label="Resource list">
              {listPanel}
            </div>
          </Panel>
          <Separator className="panel-resize-handle">
            <div className="panel-resize-handle-bar" />
          </Separator>
        </>
      )}

      <Panel
        id="content"
        minSize="30%"
        className="panel-content-main"
      >
        <div className="panel-content" role="main">
          {children}
        </div>
      </Panel>

      {inspectorPanel && (
        <>
          <Separator className="panel-resize-handle">
            <div className="panel-resize-handle-bar" />
          </Separator>
          <Panel
            id="inspector"
            minSize="200px"
            maxSize="480px"
            className="panel-inspector"
          >
            <div className="panel-content" role="complementary" aria-label="Inspector">
              {inspectorPanel}
            </div>
          </Panel>
        </>
      )}
    </Group>
  );
}

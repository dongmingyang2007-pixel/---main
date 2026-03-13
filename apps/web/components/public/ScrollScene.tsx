"use client";

import { type ReactNode } from "react";
import { useScrollScene, type ScrollSceneOptions } from "@/lib/useScrollScene";
import { cn } from "@/lib/utils";

interface ScrollSceneProps extends ScrollSceneOptions {
  children: ReactNode;
  className?: string;
  /** Unique ID for the scene (used as section id) */
  id?: string;
}

export function ScrollScene({
  children,
  className,
  id,
  ...scrollOptions
}: ScrollSceneProps) {
  const { sceneRef } = useScrollScene(scrollOptions);

  return (
    <section
      ref={sceneRef as React.RefObject<HTMLElement>}
      id={id}
      className={cn("relative min-h-screen w-full", className)}
    >
      {children}
    </section>
  );
}

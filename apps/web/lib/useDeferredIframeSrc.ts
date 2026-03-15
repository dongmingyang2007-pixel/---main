"use client";

import { useEffect, useState } from "react";

type IdleWindow = Window &
  typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

export function useDeferredIframeSrc(src: string, enabled = true, delayMs = 180) {
  const [deferredSrc, setDeferredSrc] = useState("");

  useEffect(() => {
    if (!enabled || !src) {
      return;
    }

    const idleWindow = window as IdleWindow;
    let timeoutId: number | null = null;
    let idleId: number | null = null;

    const activate = () => {
      setDeferredSrc((current) => (current === src ? current : src));
    };

    const scheduleActivation = () => {
      timeoutId = window.setTimeout(activate, delayMs);
    };

    if (typeof idleWindow.requestIdleCallback === "function") {
      idleId = idleWindow.requestIdleCallback(
        () => {
          scheduleActivation();
        },
        { timeout: 900 },
      );
    } else {
      scheduleActivation();
    }

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (idleId !== null && typeof idleWindow.cancelIdleCallback === "function") {
        idleWindow.cancelIdleCallback(idleId);
      }
    };
  }, [delayMs, enabled, src]);

  return enabled && src && deferredSrc === src ? deferredSrc : "";
}

"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Wraps children with View Transitions API support.
 *
 * On route change, triggers a cross-fade + subtle slide transition
 * between the old and new page content. Falls back gracefully on
 * browsers that don't support `document.startViewTransition`.
 */
export function ViewTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    if (pathname === prevPathRef.current) return;
    prevPathRef.current = pathname;

    // If View Transitions API is not available, skip
    if (typeof document.startViewTransition !== "function") return;

    // The transition is already happening via Next.js navigation,
    // but we can enhance it by adding a class to signal CSS
    document.documentElement.classList.add("view-transitioning");

    const cleanup = () => {
      document.documentElement.classList.remove("view-transitioning");
    };

    // Remove the class after transition completes
    const timer = setTimeout(cleanup, 600);
    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, [pathname]);

  return <>{children}</>;
}

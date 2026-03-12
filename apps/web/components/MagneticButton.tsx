"use client";

import { useRef, useCallback, type ReactNode, type MouseEvent } from "react";

/**
 * Apple-style magnetic button that subtly attracts toward the cursor.
 *
 * On hover, the button translates slightly toward the mouse position,
 * creating a "magnetic" feel. On leave, it springs back to center.
 */
export function MagneticButton({
  children,
  href,
  className = "",
  strength = 0.3,
  onClick,
}: {
  children: ReactNode;
  href?: string;
  className?: string;
  strength?: number;
  onClick?: () => void;
}) {
  const ref = useRef<HTMLElement>(null);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) * strength;
      const dy = (e.clientY - cy) * strength;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    },
    [strength],
  );

  const handleMouseLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "";
  }, []);

  const Tag = href ? "a" : "button";

  return (
    <Tag
      ref={ref as never}
      href={href}
      className={`magnetic-button ${className}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
    >
      {children}
    </Tag>
  );
}

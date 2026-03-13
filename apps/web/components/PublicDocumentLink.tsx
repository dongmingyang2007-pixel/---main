"use client";

import Link from "next/link";
import clsx from "clsx";
import type { AnchorHTMLAttributes, ReactNode } from "react";

function dispatchViewerSuspend() {
  window.dispatchEvent(new CustomEvent("qihang:viewer-suspend"));
}

export function PublicDocumentLink({
  href,
  children,
  className,
  onKeyDown,
  onPointerDown,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
}) {
  const sharedClassName = clsx(className);
  const isInternalHref = href.startsWith("/");

  if (isInternalHref) {
    return (
      <Link
        href={href}
        className={sharedClassName}
        onPointerDown={(event) => {
          if (
            event.button === 0
            && !event.metaKey
            && !event.ctrlKey
            && !event.altKey
            && !event.shiftKey
          ) {
            dispatchViewerSuspend();
          }
          onPointerDown?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            dispatchViewerSuspend();
          }
          onKeyDown?.(event);
        }}
        {...props}
      >
        {children}
      </Link>
    );
  }

  return (
    <a href={href} className={sharedClassName} {...props}>
      {children}
    </a>
  );
}

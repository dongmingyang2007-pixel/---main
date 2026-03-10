import clsx from "clsx";
import type { AnchorHTMLAttributes, ReactNode } from "react";

export function PublicDocumentLink({
  href,
  children,
  className,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
}) {
  return (
    <a href={href} className={clsx(className)} {...props}>
      {children}
    </a>
  );
}

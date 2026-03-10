import clsx from "clsx";
import type { ReactNode } from "react";

export function StudioSection({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("studio-section", className)}>
      {eyebrow || title || description || actions ? (
        <div className="studio-section-header">
          <div>
            {eyebrow ? <div className="console-kicker">{eyebrow}</div> : null}
            {title ? <h2 className="studio-section-title">{title}</h2> : null}
            {description ? <p className="studio-section-description">{description}</p> : null}
          </div>
          {actions ? <div className="studio-section-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="studio-section-body">{children}</div>
    </section>
  );
}

import type { ReactNode } from "react";

/**
 * PageHeader (Design System v2) — editorial heading system: optional
 * brand eyebrow (or breadcrumb above), display-type title at the v2
 * h1 scale, muted description, actions right. New optional `eyebrow`
 * prop; v1 props unchanged.
 */
export function PageHeader({ title, description, breadcrumb, eyebrow, actions }: {
  title: string;
  description?: string;
  breadcrumb?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {breadcrumb ? (
        <p className="mb-1.5 flex items-center gap-1.5 text-xs text-text-muted">{breadcrumb}</p>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {eyebrow ? <p className="section-eyebrow mb-1">{eyebrow}</p> : null}
          <h1 className="font-display text-h1 text-text-main">{title}</h1>
          {description ? <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div> : null}
      </div>
    </header>
  );
}

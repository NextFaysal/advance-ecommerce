import type { ReactNode } from "react";

export function PageHeader({ title, description, breadcrumb, actions }: {
  title: string; description?: string; breadcrumb?: string; actions?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {breadcrumb ? <p className="text-xs text-text-muted">{breadcrumb}</p> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold leading-8">{title}</h1>
          {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

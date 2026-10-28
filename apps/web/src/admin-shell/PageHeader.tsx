import { Fragment, type ReactNode } from "react";
import { ShellIcon } from "./icons";

export interface PageHeaderCrumb {
  label: string;
  /** Omit on the last crumb — it renders as the current page. */
  href?: string;
}

/**
 * PageHeader — the admin page-heading system (doc 31, D2).
 *
 * Presentational (server-safe, no hooks) so pages render it directly:
 * an optional breadcrumb trail, the page title at the v4
 * `text-page-title` step with an optional muted subtitle, actions on
 * the right, and an optional tabs slot under a hairline. Page waves
 * D4–D6 adopt this in place of per-page header improvisation; the
 * dashboard home's "All modules" section is the D2 reference usage.
 *
 * Strings stay with the caller (it already holds the locale-resolved
 * dictionary): pass `breadcrumbLabel` for the trail's aria-label.
 */
export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  breadcrumbLabel,
  actions,
  tabs,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  breadcrumbs?: readonly PageHeaderCrumb[];
  breadcrumbLabel?: string;
  actions?: ReactNode;
  tabs?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-6 ${className}`}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label={breadcrumbLabel} className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5 text-small">
          {breadcrumbs.map((crumb, i) => {
            const last = i === breadcrumbs.length - 1;
            return (
              <Fragment key={`${crumb.label}-${i}`}>
                {i > 0 ? (
                  <span aria-hidden="true" className="text-text-subtle">
                    <ShellIcon name="ChevronRight" className="h-3.5 w-3.5" />
                  </span>
                ) : null}
                {last || !crumb.href ? (
                  <span aria-current={last ? "page" : undefined} className={last ? "font-semibold text-text-main" : "font-medium text-text-muted"}>
                    {crumb.label}
                  </span>
                ) : (
                  <a href={crumb.href} className="font-medium text-text-muted transition duration-fast hover:text-brand-700">
                    {crumb.label}
                  </a>
                )}
              </Fragment>
            );
          })}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-page-title text-text-main">{title}</h1>
          {subtitle ? (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-muted">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 pt-0.5">{actions}</div> : null}
      </div>
      {tabs ? <div className="mt-4 border-b border-border">{tabs}</div> : null}
    </header>
  );
}

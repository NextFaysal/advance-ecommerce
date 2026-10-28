"use client";

import { Fragment } from "react";
import { Icon } from "./icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";

export type BreadcrumbItem = {
  label: string;
  /** Omit (or leave off the last item) for plain text — the current page. */
  href?: string;
};

/**
 * Breadcrumbs (Design System v4, doc 31 D3) — chevron-separated trail;
 * the last item is the current page (aria-current="page", no link even
 * if an href is passed). The nav landmark label is locale-resolved
 * from the admin dictionary (doc 30).
 */
export function Breadcrumbs({
  items,
  className = "",
}: {
  items: BreadcrumbItem[];
  className?: string;
}) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  return (
    <nav aria-label={s.breadcrumb} className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <Fragment key={`${i}-${item.label}`}>
              <li className="flex items-center">
                {item.href && !isLast ? (
                  <a
                    href={item.href}
                    className="rounded-md px-1 py-0.5 text-text-muted transition duration-fast ease-smooth hover:bg-surface-2 hover:text-brand-ink"
                  >
                    {item.label}
                  </a>
                ) : (
                  <span
                    aria-current={isLast ? "page" : undefined}
                    className={`px-1 py-0.5 ${isLast ? "font-semibold text-text-main" : "text-text-muted"}`}
                  >
                    {item.label}
                  </span>
                )}
              </li>
              {!isLast ? (
                <li aria-hidden="true" className="flex items-center text-text-subtle">
                  <Icon name="chevron-right" size={14} />
                </li>
              ) : null}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

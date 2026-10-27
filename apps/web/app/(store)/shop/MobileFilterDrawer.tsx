"use client";

// MobileFilterDrawer — Design v3 (§3): on small screens the PLP filter
// sidebar becomes a slide-in drawer. The filter CONTENT is server-rendered
// by shop/page.tsx (shareable GET-param links, unchanged) and passed in
// as children; this wrapper only owns open/close state. Filter links
// navigate immediately (same as the desktop sidebar), and the sticky
// bottom bar shows the current result count and closes the drawer.
import { useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { Drawer } from "@/components/ui/drawer";
import { interpolate, pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { STORE_STRINGS } from "../store-strings";

function FilterIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5h16l-6.5 7.5V19l-3 2v-8.5L4 5z" />
    </svg>
  );
}

export function MobileFilterDrawer({
  resultCount,
  clearHref,
  children,
}: {
  /** Current server-rendered total for the applied filters. */
  resultCount: number;
  /** Present when any filter/search is active — renders a clear link. */
  clearHref?: string;
  children: ReactNode;
}) {
  const { locale } = useLocale();
  const s = pick(locale, STORE_STRINGS);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-text-main shadow-card transition duration-200 hover:border-brand-300 hover:bg-surface-2 active:scale-[0.98]"
      >
        <span className="text-brand-600 dark:text-brand-300">
          <FilterIcon />
        </span>
        {s.filter}
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={s.filter}
        footer={
          <div className="flex items-center gap-2">
            {clearHref ? (
              <Link
                href={clearHref}
                onClick={() => setOpen(false)}
                className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-text-main transition duration-200 hover:bg-surface-2 active:scale-[0.98]"
              >
                {s.clearAll}
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="brand-gradient inline-flex min-h-[48px] flex-1 items-center justify-center rounded-xl px-4 text-sm font-bold text-white shadow-md transition duration-200 hover:opacity-90 hover:shadow-lift active:scale-[0.99]"
            >
              {interpolate(s.viewResults, { count: resultCount })}
            </button>
          </div>
        }
      >
        {children}
      </Drawer>
    </>
  );
}

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
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-text-main shadow-sm transition hover:bg-surface-2"
      >
        <FilterIcon />
        ফিল্টার
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="ফিল্টার"
        footer={
          <div className="flex items-center gap-2">
            {clearHref ? (
              <Link
                href={clearHref}
                onClick={() => setOpen(false)}
                className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-card px-4 text-sm font-semibold text-text-main transition hover:bg-surface-2"
              >
                সব মুছুন
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="brand-gradient inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl px-4 text-sm font-bold text-white shadow-md transition hover:opacity-90"
            >
              ফলাফল দেখুন ({resultCount}টি পণ্য)
            </button>
          </div>
        }
      >
        {children}
      </Drawer>
    </>
  );
}

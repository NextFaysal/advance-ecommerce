"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";

export type TabItem = { id: string; label: string; count?: number; content: ReactNode };

/**
 * Tabs (Design System v4, doc 31 D3) — animated underline indicator,
 * counts as pill chips instead of "(n)" text. New in v4 (additive):
 * `variant="pill"` renders the tablist as a segmented control on the
 * surface-2 step with a raised active pill. Default stays "underline",
 * so existing call sites render as before (restyled to v4 tokens).
 */
export function Tabs({
  tabs,
  defaultId,
  variant = "underline",
}: {
  tabs: TabItem[];
  defaultId?: string;
  variant?: "underline" | "pill";
}) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const [active, setActive] = useState(defaultId ?? tabs[0]?.id ?? "");
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  if (variant === "pill") {
    return (
      <div>
        <div
          role="tablist"
          aria-label={s.tabsLabel}
          className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-border/60 bg-surface-2 p-1"
        >
          {tabs.map((t) => {
            const isActive = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActive(t.id)}
                className={`flex min-h-[38px] shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition duration-base ease-smooth focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 ${
                  isActive
                    ? "bg-surface-raised text-text-main shadow-xs"
                    : "text-text-muted hover:text-text-main"
                }`}
              >
                {t.label}
                {t.count !== undefined ? (
                  <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${isActive ? "bg-brand-soft text-brand-ink" : "bg-card text-text-muted"}`}>
                    {t.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div role="tabpanel" className="pt-4">
          {current?.content}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div role="tablist" aria-label={s.tabsLabel} className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(t.id)}
              className={`relative flex min-h-[44px] shrink-0 items-center gap-2 px-3.5 text-sm font-medium transition duration-fast ease-smooth focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 ${
                isActive ? "text-brand-ink" : "text-text-muted hover:text-text-main"
              }`}
            >
              {t.label}
              {t.count !== undefined ? (
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${isActive ? "bg-brand-soft text-brand-ink" : "bg-surface-2 text-text-muted"}`}>
                  {t.count}
                </span>
              ) : null}
              <span
                aria-hidden="true"
                className={`absolute inset-x-3 -bottom-px h-[2.5px] rounded-full transition duration-base ease-smooth ${isActive ? "brand-gradient opacity-100" : "opacity-0"}`}
              />
            </button>
          );
        })}
      </div>
      <div role="tabpanel" className="pt-4">
        {current?.content}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";

export type TabItem = { id: string; label: string; count?: number; content: ReactNode };

/**
 * Tabs (Design System v2) — animated underline indicator, counts as
 * pill chips instead of "(n)" text. API unchanged from v1.
 */
export function Tabs({ tabs, defaultId }: { tabs: TabItem[]; defaultId?: string }) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const [active, setActive] = useState(defaultId ?? tabs[0]?.id ?? "");
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
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
              className={`relative flex min-h-[44px] shrink-0 items-center gap-2 px-3.5 text-sm font-medium transition motion-fast ${
                isActive ? "text-brand-700" : "text-text-muted hover:text-text-main"
              }`}
            >
              {t.label}
              {t.count !== undefined ? (
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${isActive ? "bg-brand-100 text-brand-700" : "bg-surface-2 text-text-muted"}`}>
                  {t.count}
                </span>
              ) : null}
              <span
                aria-hidden="true"
                className={`absolute inset-x-3 -bottom-px h-[2.5px] rounded-full transition motion-base ${isActive ? "brand-gradient opacity-100" : "opacity-0"}`}
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

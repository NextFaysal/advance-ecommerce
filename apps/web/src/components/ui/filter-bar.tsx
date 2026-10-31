"use client";

import { useState } from "react";
import { Icon } from "./icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { UI_STRINGS } from "./strings";

/**
 * FilterBar (Design System v4, doc 31 D3) — search field with icon +
 * removable filter chips with close icons; v4 input shell (rounded-xl,
 * token focus halo, brand-soft chips). Optional `placeholder` prop;
 * when omitted, the locale-resolved default is used (doc 30).
 */
export function FilterBar({
  onSearch,
  chips,
  placeholder,
}: {
  onSearch?: (q: string) => void;
  chips?: string[];
  placeholder?: string;
}) {
  const { locale } = useLocale();
  const s = pick(locale, UI_STRINGS);
  const effectivePlaceholder = placeholder ?? s.filterSearchPlaceholder;
  const [query, setQuery] = useState("");
  const [activeChips, setActiveChips] = useState<string[]>(chips ?? []);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex h-11 min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 shadow-xs transition duration-base ease-smooth focus-within:border-brand-ink focus-within:ring-[3px] focus-within:ring-brand-ink/15">
        <span aria-hidden="true" className="shrink-0 text-text-subtle">
          <Icon name="search" size={17} />
        </span>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); onSearch?.(e.target.value); }}
          placeholder={effectivePlaceholder}
          aria-label={s.filterSearchLabel}
          className="w-full bg-transparent text-sm text-text-main outline-none placeholder:text-text-subtle"
        />
        {query ? (
          <button
            type="button"
            aria-label={s.clearSearch}
            onClick={() => { setQuery(""); onSearch?.(""); }}
            className="-mr-2 flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-text-subtle transition duration-fast ease-smooth hover:bg-surface-2 hover:text-text-main"
          >
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </span>
      {activeChips.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={interpolate(s.removeFilter, { name: c })}
          onClick={() => setActiveChips(activeChips.filter((x) => x !== c))}
          className="flex h-7 items-center gap-1.5 rounded-full bg-brand-soft py-1 pl-3 pr-2 text-xs font-medium text-brand-ink ring-1 ring-inset ring-brand-ink/15 transition duration-fast ease-smooth hover:bg-brand-ink/15"
        >
          {c}
          <Icon name="x" size={12} />
        </button>
      ))}
    </div>
  );
}

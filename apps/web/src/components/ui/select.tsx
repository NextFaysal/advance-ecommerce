"use client";

import { useMemo, useState } from "react";
import { Icon } from "./icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { UI_STRINGS } from "./strings";

export type SelectOption = { value: string; label: string };

/**
 * Combobox (Design System v4, doc 31 D3) — search field with icon,
 * pop-shadow list, selected row with check mark; v4 input shell
 * (rounded-xl, token focus halo). API unchanged from v1.
 */
export function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder,
}: {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { locale } = useLocale();
  const s = pick(locale, UI_STRINGS);
  const effectivePlaceholder = placeholder ?? s.comboboxPlaceholder;
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()) || o.value.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );
  return (
    <div>
      {label ? <span className="mb-1.5 block text-sm font-medium text-text-main">{label}</span> : null}
      <span className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3 shadow-xs transition duration-base ease-smooth focus-within:border-brand-ink focus-within:ring-[3px] focus-within:ring-brand-ink/15">
        <span aria-hidden="true" className="shrink-0 text-text-subtle">
          <Icon name="search" size={17} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={effectivePlaceholder}
          aria-label={label ?? effectivePlaceholder}
          className="w-full bg-transparent text-sm text-text-main outline-none placeholder:text-text-subtle"
        />
      </span>
      <div role="listbox" className="mt-2 max-h-44 overflow-auto rounded-2xl border border-border/60 bg-surface-raised p-1 shadow-pop">
        {filtered.length === 0 ? <p className="px-3 py-2.5 text-sm text-text-muted">{s.noResultsFound}</p> : null}
        {filtered.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onChange(o.value)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition duration-fast ease-smooth hover:bg-surface-2 ${selected ? "bg-brand-soft font-medium text-brand-ink" : "text-text-main"}`}
            >
              {o.label}
              {selected ? <Icon name="check" size={15} /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Icon } from "./icon";

export type SelectOption = { value: string; label: string };

/**
 * Combobox (Design System v2) — search field with icon, pop-shadow
 * list, selected row with check mark. API unchanged from v1.
 */
export function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder = "খুঁজুন…",
}: {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()) || o.value.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );
  return (
    <div>
      {label ? <span className="mb-1.5 block text-sm font-medium text-text-main">{label}</span> : null}
      <span className="flex h-11 items-center gap-2 rounded-md border border-border bg-card px-3 transition motion-fast focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-100">
        <span aria-hidden="true" className="shrink-0 text-text-subtle">
          <Icon name="search" size={17} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          aria-label={label ?? placeholder}
          className="w-full bg-transparent text-sm text-text-main outline-none placeholder:text-text-subtle"
        />
      </span>
      <div role="listbox" className="mt-2 max-h-44 overflow-auto rounded-lg border border-border/70 bg-card p-1 shadow-pop">
        {filtered.length === 0 ? <p className="px-3 py-2.5 text-sm text-text-muted">কোনো ফলাফল পাওয়া যায়নি।</p> : null}
        {filtered.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onChange(o.value)}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition motion-fast hover:bg-surface-2 ${selected ? "bg-brand-50 font-medium text-brand-700" : "text-text-main"}`}
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

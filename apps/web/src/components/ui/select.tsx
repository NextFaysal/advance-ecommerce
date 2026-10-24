"use client";

import { useMemo, useState } from "react";

export type SelectOption = { value: string; label: string };

export function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder = "Search…",
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
      {label ? <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span> : null}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
      />
      <div role="listbox" className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-card p-1">
        {filtered.length === 0 ? <p className="p-2 text-sm text-text-muted">No match found.</p> : null}
        {filtered.map((o) => (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={value === o.value}
            onClick={() => onChange(o.value)}
            className={`block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2 ${value === o.value ? "bg-brand-50 text-brand-700" : ""}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

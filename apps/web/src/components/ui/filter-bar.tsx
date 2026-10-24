"use client";

import { useState } from "react";
import { Icon } from "./icon";

/**
 * FilterBar (Design System v2) — search field with icon + removable
 * filter chips with close icons. New optional `placeholder` prop.
 */
export function FilterBar({
  onSearch,
  chips,
  placeholder = "অর্ডার, কাস্টমার, পণ্য খুঁজুন…",
}: {
  onSearch?: (q: string) => void;
  chips?: string[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [activeChips, setActiveChips] = useState<string[]>(chips ?? []);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex h-11 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-card px-3 shadow-sm transition motion-fast focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-100">
        <span aria-hidden="true" className="shrink-0 text-text-subtle">
          <Icon name="search" size={17} />
        </span>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); onSearch?.(e.target.value); }}
          placeholder={placeholder}
          aria-label="Filter search"
          className="w-full bg-transparent text-sm text-text-main outline-none placeholder:text-text-subtle"
        />
        {query ? (
          <button
            type="button"
            aria-label="খোঁজ মুছুন"
            onClick={() => { setQuery(""); onSearch?.(""); }}
            className="shrink-0 rounded-full p-1 text-text-subtle transition motion-fast hover:bg-surface-2 hover:text-text-main"
          >
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </span>
      {activeChips.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Remove filter ${c}`}
          onClick={() => setActiveChips(activeChips.filter((x) => x !== c))}
          className="flex h-7 items-center gap-1.5 rounded-full bg-brand-100 py-1 pl-3 pr-2 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200/60 transition motion-fast hover:bg-brand-200/70"
        >
          {c}
          <Icon name="x" size={12} />
        </button>
      ))}
    </div>
  );
}

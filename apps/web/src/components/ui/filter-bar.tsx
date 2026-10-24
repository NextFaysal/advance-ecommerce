"use client";

import { useState } from "react";

export function FilterBar({ onSearch, chips }: { onSearch?: (q: string) => void; chips?: string[] }) {
  const [query, setQuery] = useState("");
  const [activeChips, setActiveChips] = useState<string[]>(chips ?? []);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); onSearch?.(e.target.value); }}
        placeholder="Search order, customer, product… (Ctrl+K)"
        aria-label="Filter search"
        className="h-10 min-w-[220px] flex-1 rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
      />
      {activeChips.map((c) => (
        <button key={c} type="button" aria-label={`Remove filter ${c}`} onClick={() => setActiveChips(activeChips.filter((x) => x !== c))} className="flex h-6 items-center gap-1 rounded-full bg-brand-100 px-2.5 text-xs font-medium text-brand-700">
          {c} ✕
        </button>
      ))}
    </div>
  );
}

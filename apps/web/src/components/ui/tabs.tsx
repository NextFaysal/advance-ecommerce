"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export type TabItem = { id: string; label: string; count?: number; content: ReactNode };

export function Tabs({ tabs, defaultId }: { tabs: TabItem[]; defaultId?: string }) {
  const [active, setActive] = useState(defaultId ?? tabs[0]?.id ?? "");
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div>
      <div role="tablist" aria-label="Tabs" className="flex gap-2 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={`min-h-[44px] border-b-2 px-3 text-sm font-medium ${active === t.id ? "border-brand-600 text-brand-700" : "border-transparent text-text-muted hover:text-text-main"}`}
          >
            {t.label}{t.count !== undefined ? ` (${t.count})` : ""}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="pt-4">{current?.content}</div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";

/**
 * Feature-flag toggle list — Agent 27. PAGE-LOCAL DEMO STATE ONLY.
 * Every flag starts OFF (the seed default). Toggling a switch here only
 * flips React state on this page: it writes NOTHING, enables NOTHING,
 * and is lost on reload. Real enabling happens in the DB `feature_flags`
 * table by a holder of `feature_flags.manage`, with an audit reason —
 * see the warning on the page.
 */
export interface FlagListItem {
  key: string;
  descriptionEn: string; // exact string from seed.ts FEATURE_FLAGS
  descriptionBn: string;
  linkPath: string | null;
  linkLabel: string | null;
}

export function FlagList({ items }: { items: FlagListItem[] }) {
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((i) => [i.key, false])),
  );

  return (
    <ul className="divide-y divide-border">
      {items.map((item) => {
        const on = state[item.key] ?? false;
        return (
          <li key={item.key} className="flex flex-wrap items-center gap-3 py-4">
            <div className="min-w-[240px] flex-1">
              <p className="font-mono text-sm font-medium">{item.key}</p>
              <p className="mt-0.5 text-sm text-text-muted">
                {item.descriptionBn} <span className="text-text-subtle">({item.descriptionEn})</span>
              </p>
              {item.linkPath ? (
                <a href={item.linkPath} className="mt-1 inline-block text-sm font-medium text-brand-700 hover:underline">
                  মডিউল পেজ: {item.linkLabel} →
                </a>
              ) : (
                <p className="mt-1 text-xs text-text-subtle">আলাদা অ্যাডমিন পেজ নেই — API / সেটিংস দিয়ে চলে</p>
              )}
            </div>
            <Badge tone={on ? "success" : "neutral"}>{on ? "ON (শুধু এই পেজে)" : "OFF"}</Badge>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={`${item.key} ডেমো টগল`}
              onClick={() => setState((s) => ({ ...s, [item.key]: !on }))}
              className={`relative h-7 w-12 shrink-0 rounded-full transition ${on ? "bg-brand-600" : "bg-surface-2 border border-border"}`}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

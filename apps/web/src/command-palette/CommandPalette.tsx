/**
 * CommandPalette — Agent 28 (Admin Ctrl+K + global search).
 *
 * MOUNT CONTRACT (for the main agent / admin shell):
 *
 *   import { CommandPalette } from "@/command-palette";
 *   // Render ONCE inside the admin layout (e.g. app/admin/layout.tsx),
 *   // as a sibling of the shell — no props required:
 *   <CommandPalette />
 *
 *   Optional: onNavigate?: (result: PaletteResult) => void — called
 *   instead of the default router.push(result.href), e.g. for tests or
 *   a shell that manages navigation itself. The palette always closes
 *   after a selection either way.
 *
 * Behaviour:
 * - Opens/closes on Ctrl+K or Cmd+K from anywhere (its own global key
 *   listener; also toggles). ↑/↓ move through results (wrap-around),
 *   Home/End jump, Enter opens, Esc closes — the pure reducer lives in
 *   keyboard.ts, this component only renders where it points.
 * - Results come from the pure pipeline in this folder: nav pages +
 *   quick actions + TEMPORARY MOCK orders/products/customers (each demo
 *   result carries a "ডেমো ডেটা" badge — never disguised as live), plus
 *   natural-language links from src/ai/search's parseCommandQuery.
 * - Customer/order subtitles show MASKED phones only (maskPhone at
 *   index-build time); full digits exist only in never-rendered
 *   keywords so staff can still search by number.
 * - With an empty query it shows recent searches (localStorage) and
 *   the full page list. Recent rows are mouse/tap targets; keyboard
 *   navigation covers the page results below them.
 * - Performance: the index is ~35 static entries and scoring is linear,
 *   so a keystroke resolves in well under the master plan's 3-second
 *   Ctrl+K budget (effectively instant; no debounce or API call).
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "../components/ui/badge";
import { EmptyState } from "../components/ui/empty-state";
import { Input } from "../components/ui/input";
import { Modal } from "../components/ui/modal";
import { buildPaletteIndex } from "./index-builder";
import {
  INITIAL_NAV_STATE,
  isPaletteShortcut,
  paletteKeyAction,
  paletteNavReducer,
  type PaletteNavState,
} from "./keyboard";
import { buildNaturalLanguageResults } from "./natural-language";
import { loadRecentSearches, saveRecentSearch } from "./recent";
import { groupScoredResults, searchPalette } from "./scoring";
import {
  PALETTE_GROUP_LABELS,
  PALETTE_GROUP_ORDER,
  type PaletteResult,
} from "./types";

export interface CommandPaletteProps {
  onNavigate?: (result: PaletteResult) => void;
}

interface DisplayGroup {
  group: PaletteResult["group"];
  entries: PaletteResult[];
}

/** Merge natural-language results into the scored groups (NL first
 *  inside its group), preserving the fixed group order for display —
 *  keyboard navigation follows this exact display order. */
function buildDisplayGroups(
  scored: ReturnType<typeof searchPalette>,
  natural: PaletteResult[],
): DisplayGroup[] {
  const groups = new Map<PaletteResult["group"], PaletteResult[]>();
  for (const entry of natural) {
    groups.set(entry.group, [...(groups.get(entry.group) ?? []), entry]);
  }
  for (const { group, entries } of groupScoredResults(scored)) {
    const existing = groups.get(group) ?? [];
    const seen = new Set(existing.map((r) => r.id));
    groups.set(group, [...existing, ...entries.map((e) => e.result).filter((r) => !seen.has(r.id))]);
  }
  return PALETTE_GROUP_ORDER.filter((group) => (groups.get(group)?.length ?? 0) > 0).map(
    (group) => ({ group, entries: groups.get(group) ?? [] }),
  );
}

function isDemoSource(result: PaletteResult): boolean {
  return result.source.startsWith("TEMPORARY_MOCK");
}

export function CommandPalette({ onNavigate }: CommandPaletteProps = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [nav, setNav] = useState<PaletteNavState>(INITIAL_NAV_STATE);
  const rootRef = useRef<HTMLDivElement>(null);

  const index = useMemo(() => buildPaletteIndex(), []);

  const displayGroups = useMemo<DisplayGroup[]>(() => {
    if (query.trim().length === 0) {
      // Empty query: the full page list is the navigable default.
      return [{ group: "pages", entries: index.filter((r) => r.group === "pages") }];
    }
    return buildDisplayGroups(searchPalette(index, query), buildNaturalLanguageResults(query));
  }, [index, query]);

  const flat = useMemo(() => displayGroups.flatMap((g) => g.entries), [displayGroups]);

  // Global Ctrl+K / Cmd+K toggle.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isPaletteShortcut(event)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Fresh state per open: empty query, recents re-read, first page active.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setRecents(loadRecentSearches());
    setNav({ count: index.filter((r) => r.group === "pages").length, activeIndex: 0 });
    const timer = window.setTimeout(() => {
      rootRef.current?.querySelector("input")?.focus();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [open, index]);

  // Keep the reducer's count in sync with the visible results.
  useEffect(() => {
    if (open) setNav((state) => (state.count === flat.length ? state : { ...state, count: flat.length, activeIndex: flat.length > 0 ? Math.min(state.activeIndex, flat.length - 1) : -1 }));
  }, [open, flat.length]);

  // Scroll the active row into view.
  useEffect(() => {
    if (!open || nav.activeIndex < 0) return;
    rootRef.current
      ?.querySelector(`[data-palette-index="${nav.activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, nav.activeIndex]);

  const activate = (result: PaletteResult) => {
    if (query.trim().length > 0) setRecents(saveRecentSearch(query));
    setOpen(false);
    if (onNavigate) onNavigate(result);
    else router.push(result.href);
  };

  const onPaletteKeyDown = (event: React.KeyboardEvent) => {
    const action = paletteKeyAction(event.key);
    if (action === null) return;
    event.preventDefault();
    if (action === "close") {
      setOpen(false);
      return;
    }
    if (action === "confirm") {
      const target = flat[nav.activeIndex];
      if (target) activate(target);
      return;
    }
    setNav((state) => paletteNavReducer(state, { type: action }));
  };

  let flatIndex = -1;

  return (
    <div ref={rootRef} onKeyDown={onPaletteKeyDown}>
      <Modal open={open} onClose={() => setOpen(false)} title="দ্রুত খুঁজুন — Ctrl+K">
        <Input
          aria-label="Search pages, orders, products, customers"
          placeholder="পেজ, অর্ডার, পণ্য, গ্রাহক খুঁজুন… যেমন: pending order Dhaka"
          prefix="🔍"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setNav((state) => ({ ...state, activeIndex: 0 }));
          }}
        />

        {query.trim().length === 0 && recents.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-medium text-text-muted">সাম্প্রতিক খোঁজ</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {recents.map((recent) => (
                <button
                  key={recent}
                  type="button"
                  className="rounded-full bg-surface-2 px-3 py-1.5 text-xs hover:bg-brand-100"
                  onClick={() => setQuery(recent)}
                >
                  {recent}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-4 max-h-[46vh] space-y-4 overflow-y-auto pr-1" role="listbox" aria-label="Search results">
          {displayGroups.map((group) => (
            <div key={group.group}>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {PALETTE_GROUP_LABELS[group.group].bn} · {PALETTE_GROUP_LABELS[group.group].en}
              </p>
              <ul className="mt-1 space-y-1">
                {group.entries.map((result) => {
                  flatIndex += 1;
                  const indexAtRender = flatIndex;
                  const active = indexAtRender === nav.activeIndex;
                  return (
                    <li key={result.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        data-palette-index={indexAtRender}
                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${
                          active ? "bg-brand-100 text-brand-700" : "hover:bg-surface-2"
                        }`}
                        onMouseEnter={() => setNav((state) => paletteNavReducer(state, { type: "set", index: indexAtRender }))}
                        onClick={() => activate(result)}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{result.titleBn}</span>
                          {result.subtitle ? (
                            <span className="block truncate text-xs text-text-muted">{result.subtitle}</span>
                          ) : null}
                        </span>
                        {result.locked ? <Badge tone="warning">🔒 অ্যাড-অন</Badge> : null}
                        {isDemoSource(result) ? <Badge tone="neutral">ডেমো ডেটা</Badge> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {flat.length === 0 ? (
            <EmptyState
              title="কিছু পাওয়া যায়নি"
              description="অন্য শব্দ দিয়ে আবার খুঁজুন — যেমন অর্ডার নম্বর (#100245), পণ্যের নাম, বা 'pending order Dhaka'।"
            />
          ) : null}
        </div>

        <p className="mt-4 border-t border-border pt-3 text-xs text-text-muted">
          ↑↓ বেছে নিন · Enter খুলুন · Esc বন্ধ করুন · Ctrl+K খুলুন/বন্ধ করুন
        </p>
      </Modal>
    </div>
  );
}

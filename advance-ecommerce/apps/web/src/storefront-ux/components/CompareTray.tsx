"use client";

/**
 * Compare tray + toggle — Part B wiring (Agent 21).
 * Selection state is browser-local (localStorage) like the wishlist;
 * the add/remove RULES (max 3, no duplicates) stay in the pure
 * src/storefront-ux/compare.ts functions. A custom event keeps the
 * toggle button, the tray and the /compare page in sync in one tab.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchPublicProducts } from "@/catalog/public-client";
import { interpolate, pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { addToCompare, removeFromCompare, toggleCompare, MAX_COMPARE_PRODUCTS } from "../compare";
import { UX_STRINGS } from "../strings";

const STORAGE_KEY = "advance-ecommerce:compare";
const CHANGE_EVENT = "advance-ecommerce:compare-changed";

export function readCompareIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeCompareIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // storage blocked — compare is a nicety, never an error.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useCompareIds(): { ids: string[]; setIds: (ids: string[]) => void } {
  const [ids, setLocal] = useState<string[]>([]);

  useEffect(() => {
    const sync = () => setLocal(readCompareIds());
    sync();
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return {
    ids,
    setIds: (next: string[]) => {
      setLocal(next);
      writeCompareIds(next);
    },
  };
}

export function CompareToggleButton({ productId }: { productId: string }) {
  const { locale } = useLocale();
  const s = pick(locale, UX_STRINGS);
  const { ids, setIds } = useCompareIds();
  const [notice, setNotice] = useState<string | null>(null);
  const selected = ids.includes(productId);

  function onToggle() {
    const result = toggleCompare(ids, productId);
    if (!result.ok) {
      setNotice(
        result.error === "full"
          ? interpolate(s.compareFull, { max: MAX_COMPARE_PRODUCTS })
          : s.compareDuplicate,
      );
      return;
    }
    setNotice(null);
    setIds(result.ids);
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        className={`rounded-lg border px-4 py-3 text-sm ${selected ? "border-primary bg-primary/10 font-semibold text-primary" : ""}`}
      >
        {selected ? s.compareAdded : s.compareAdd}
      </button>
      {notice ? <span className="text-xs text-danger">{notice}</span> : null}
    </span>
  );
}

export function CompareTray() {
  const { locale } = useLocale();
  const s = pick(locale, UX_STRINGS);
  const { ids, setIds } = useCompareIds();
  // Chip labels resolve from the real public catalog (ACTIVE products via
  // the public API); an id that no longer resolves falls back to the id.
  // Product titles are merchant data with bn/en variants — pick the
  // active locale's variant.
  const [titles, setTitles] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    void fetchPublicProducts().then((products) => {
      if (!cancelled) setTitles(new Map(products.map((p) => [p.id, p.title[locale]])));
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (ids.length === 0) return null;

  const labelFor = (id: string) => titles.get(id) ?? id;

  return (
    <div className="fixed inset-x-0 bottom-16 z-40 px-4 md:bottom-4">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-lg">
        <span className="text-sm font-semibold">{interpolate(s.compareTrayLabel, { count: ids.length, max: MAX_COMPARE_PRODUCTS })}</span>
        {ids.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-xs">
            <span className="max-w-[120px] truncate">{labelFor(id)}</span>
            <button type="button" aria-label={s.compareRemove} onClick={() => setIds(removeFromCompare(ids, id))}>
              ✕
            </button>
          </span>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <button type="button" className="text-xs text-text-muted underline" onClick={() => setIds([])}>
            {s.compareClearAll}
          </button>
          <Link href="/compare" className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white">
            {s.compareView}
          </Link>
        </span>
      </div>
    </div>
  );
}

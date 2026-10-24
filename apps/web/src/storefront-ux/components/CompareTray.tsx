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
import { MOCK_PRODUCTS } from "@/catalog/mock";
import { addToCompare, removeFromCompare, toggleCompare, MAX_COMPARE_PRODUCTS } from "../compare";

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
  const { ids, setIds } = useCompareIds();
  const [notice, setNotice] = useState<string | null>(null);
  const selected = ids.includes(productId);

  function onToggle() {
    const result = toggleCompare(ids, productId);
    if (!result.ok) {
      setNotice(
        result.error === "full"
          ? `সর্বোচ্চ ${MAX_COMPARE_PRODUCTS}টি পণ্য তুলনা করা যাবে — আগে একটি সরান।`
          : "পণ্যটি ইতিমধ্যে তুলনায় আছে।",
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
        className={`rounded-lg border px-4 py-3 text-sm ${selected ? "border-[#4F46E5] bg-[#EEF2FF] font-semibold text-[#4F46E5]" : ""}`}
      >
        {selected ? "✓ তুলনায় আছে" : "তুলনা করুন"}
      </button>
      {notice ? <span className="text-xs text-red-600">{notice}</span> : null}
    </span>
  );
}

export function CompareTray() {
  const { ids, setIds } = useCompareIds();
  if (ids.length === 0) return null;

  const labelFor = (id: string) => MOCK_PRODUCTS.find((p) => p.id === id)?.title.bn ?? id;

  return (
    <div className="fixed inset-x-0 bottom-16 z-40 px-4 md:bottom-4">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-xl border bg-white px-3 py-2 shadow-lg">
        <span className="text-sm font-semibold">তুলনা ({ids.length}/{MAX_COMPARE_PRODUCTS})</span>
        {ids.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FF] px-2 py-1 text-xs">
            <span className="max-w-[120px] truncate">{labelFor(id)}</span>
            <button type="button" aria-label="তুলনা থেকে সরান" onClick={() => setIds(removeFromCompare(ids, id))}>
              ✕
            </button>
          </span>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <button type="button" className="text-xs text-slate-500 underline" onClick={() => setIds([])}>
            সব মুছুন
          </button>
          <Link href="/compare" className="rounded-lg bg-[#4F46E5] px-3 py-2 text-xs font-semibold text-white">
            তুলনা দেখুন
          </Link>
        </span>
      </div>
    </div>
  );
}

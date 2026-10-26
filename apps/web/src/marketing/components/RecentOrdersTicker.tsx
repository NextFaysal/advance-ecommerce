"use client";

// Recent-orders ticker (doc 23 wave 60 / P11 — HONEST social
// proof). Rotates through REAL recent orders fetched from
// GET /api/v1/public/social-proof/recent: first name + district +
// product + a relative time computed HERE from the order's real
// timestamp, so the words stay true even off an edge-cached
// response. Nothing is invented: when the API returns fewer than
// MIN_ENTRIES real orders (new shop, quiet period, flag off) the
// ticker renders NOTHING — no filler entries, no placeholder
// names, ever. There is no viewer counter and no "selling fast"
// copy in this component by design.
//
// The relative-time wording is deliberately coarse and truthful:
// under an hour it says "কিছুক্ষণ আগে" (a while ago) — the only
// recency claim made — then whole hours, then whole days, always
// derived from the order's actual createdAt.
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";

interface RecentOrderEntry {
  firstName: string;
  district: string;
  productName: string;
  orderedAt: string;
}

/** Mirrors RECENT_ORDERS_MIN_ENTRIES in src/marketing/social-proof.ts
 *  (duplicated as a literal: that module imports Prisma and must
 *  never enter the client bundle). */
const MIN_ENTRIES = 3;
const ROTATE_MS = 5500;
const FADE_MS = 300;

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

function bnNum(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

function relativeBn(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffMin = Math.max(0, Math.floor((nowMs - then) / 60_000));
  if (diffMin < 60) return "কিছুক্ষণ আগে";
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `${bnNum(hours)} ঘণ্টা আগে`;
  return `${bnNum(Math.floor(hours / 24))} দিন আগে`;
}

export function RecentOrdersTicker() {
  // null = not yet fetched (render nothing — the strip must never
  // flash a placeholder or a skeleton that implies orders exist).
  const [entries, setEntries] = useState<RecentOrderEntry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/public/social-proof/recent");
        const json: unknown = await res.json().catch(() => null);
        const list = (json as { data?: { entries?: RecentOrderEntry[] } } | null)?.data
          ?.entries;
        if (!cancelled) {
          setEntries(Array.isArray(list) ? list : []);
          setNowMs(Date.now());
        }
      } catch {
        if (!cancelled) setEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const count = entries?.length ?? 0;

  useEffect(() => {
    if (count < MIN_ENTRIES) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      setFading(true);
      window.setTimeout(() => {
        setIndex((i) => (i + 1) % count);
        setNowMs(Date.now());
        setFading(false);
      }, FADE_MS);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [count]);

  if (dismissed || entries === null || entries.length < MIN_ENTRIES) return null;

  const entry = entries[index % entries.length];
  const relative = nowMs === null ? "" : relativeBn(entry.orderedAt, nowMs);

  return (
    <section
      aria-label="সাম্প্রতিক অর্ডার"
      className="relative mt-5 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
        <Icon name="package" size={18} />
      </span>
      <p
        className={`min-w-0 flex-1 break-words text-sm leading-snug text-text-muted transition-opacity duration-300 [overflow-wrap:anywhere] ${
          fading ? "opacity-0" : "opacity-100"
        }`}
      >
        <span className="font-bold text-text-main">সাম্প্রতিক অর্ডার:</span>{" "}
        {entry.firstName} ({entry.district}) কিনেছেন —{" "}
        <span className="font-medium text-text-main">{entry.productName}</span>
        {relative !== "" ? <> · {relative}</> : null}
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="বন্ধ করুন"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-subtle transition hover:bg-surface-2 hover:text-text-main"
      >
        <Icon name="x" size={14} />
      </button>
    </section>
  );
}

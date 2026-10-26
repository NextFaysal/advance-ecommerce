"use client";

/**
 * "Subscription box" card for the PDP (ADV-23 vertical 4) — the box
 * sibling of the Subscribe & Save card, rendered only for a listed
 * box variant while module.subscriptions AND
 * module.subscription_boxes are ON.
 *
 * It creates through the SAME wave-51 endpoint
 * (POST /api/v1/public/account/subscriptions) — a box subscription
 * is a Subscription row; the box layer lives in the config list,
 * the cycle contents and the generator branch, not in a second
 * signup flow. The only choices offered are the cycle kinds the
 * merchant enabled in boxes.config (weekly / monthly).
 *
 * Honesty rules, mirroring the engine's:
 *  - The discount badge renders ONLY for a real configured
 *    discount (the effective bps the generator will apply).
 *  - The next cycle's contents are shown ONLY when the merchant
 *    has announced them; otherwise the card says the list is not
 *    out yet AND that no order is generated for a cycle without a
 *    list — an unannounced box is never silently filled with the
 *    previous cycle.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@/checkout/pricing";
import {
  INTERVAL_LABELS,
  formatBpsPercent,
  formatSubscriptionDate,
} from "@/subscriptions/labels";
import type { SubscribeVariantOption } from "@/subscriptions/subscribe-save-card";
import { CYCLE_INTERVALS } from "./cycles";
import type { BoxPdpData } from "./service";

interface AddressOption {
  id: string;
  label: string | null;
  division: string;
  district: string;
  upazila: string;
  addressLine: string;
  isDefault: boolean;
}

interface OptionsResponse {
  data?: { addresses: AddressOption[] };
  error?: { message?: string };
}

type LoadState =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "ready"; addresses: AddressOption[] }
  | { kind: "error" };

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

export function BoxSubscribeCard({
  variants,
  data,
}: {
  variants: SubscribeVariantOption[];
  data: BoxPdpData;
}) {
  const offeredIntervals = data.cycles.map((kind) => CYCLE_INTERVALS[kind]);
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [variantId, setVariantId] = useState<string>(variants[0]?.id ?? "");
  const [interval, setInterval] = useState<"WEEKLY" | "MONTHLY">(
    offeredIntervals[0] ?? "MONTHLY",
  );
  const [quantity, setQuantity] = useState(1);
  const [addressId, setAddressId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneNextRunAt, setDoneNextRunAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/public/account/subscriptions");
        if (cancelled) return;
        if (res.status === 401) {
          setLoad({ kind: "guest" });
          return;
        }
        if (!res.ok) {
          setLoad({ kind: "error" });
          return;
        }
        const json = (await res.json()) as OptionsResponse;
        const addresses = json.data?.addresses ?? [];
        setLoad({ kind: "ready", addresses });
        const preferred = addresses.find((a) => a.isDefault) ?? addresses[0];
        if (preferred) setAddressId(preferred.id);
      } catch {
        if (!cancelled) setLoad({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = variants.find((v) => v.id === variantId) ?? variants[0];
  const preview =
    selected !== undefined ? data.previews[selected.id]?.[interval] : undefined;

  async function subscribe() {
    if (selected === undefined || addressId === "") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/public/account/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          variantId: selected.id,
          quantity,
          interval,
          addressId,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        data?: { subscription?: { nextRunAt?: string } };
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "সাবস্ক্রাইব করা যায়নি — আবার চেষ্টা করুন।");
        return;
      }
      setDoneNextRunAt(json?.data?.subscription?.nextRunAt ?? null);
    } catch {
      setError("সাবস্ক্রাইব করা যায়নি — সংযোগ যাচাই করে আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  const selectClass =
    "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/40";

  return (
    <section className="mt-4 rounded-2xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-400/25 dark:bg-brand-500/10">
      <h3 className="text-sm font-bold text-brand-900 dark:text-brand-100">
        📦 সাবস্ক্রিপশন বক্স — প্রতি সাইকেলে নতুন তালিকা
        {data.discountBps > 0 ? (
          <span className="ml-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">
            প্রতি বাক্সে {formatBpsPercent(data.discountBps)}% ছাড়
          </span>
        ) : null}
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-brand-800 dark:text-brand-200">
        এই বাক্সের ভিতরের পণ্য প্রতি সাইকেলে বদলায় — আমরা আগেই তালিকা জানিয়ে দিই। দাম থাকে
        বাক্সের দামটাই; ক্যাশ অন ডেলিভারিতে পৌঁছে যাবে। যেকোনো সময় অ্যাকাউন্ট থেকে থামাতে বা
        বাতিল করতে পারবেন।
      </p>

      {preview !== undefined ? (
        <div className="mt-3 rounded-xl bg-surface p-3 text-sm text-text-main">
          <p className="font-semibold">
            পরের বাক্স · সাইকেল {preview.cycleKey}
            {preview.cycle?.noteBn ? ` — ${preview.cycle.noteBn}` : ""}
          </p>
          {preview.cycle !== null && preview.cycle !== undefined ? (
            <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-text-muted">
              {preview.cycle.items.map((item) => (
                <li key={item.variantId}>
                  {item.productName} — {item.variantLabel} × {fmtQty(item.quantity)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-text-muted">
              এই সাইকেলের বাক্সের তালিকা এখনো ঘোষণা হয়নি। তালিকা নির্ধারণ না হলে ওই চক্রে
              অর্ডার তৈরি হবে না — আগের সাইকেলের বাক্স পাঠিয়ে দেওয়া হবে না।
            </p>
          )}
        </div>
      ) : null}

      {load.kind === "loading" ? (
        <p className="mt-3 text-sm text-brand-800/70 dark:text-brand-200/70">লোড হচ্ছে…</p>
      ) : load.kind === "guest" ? (
        <p className="mt-3 text-sm text-brand-900 dark:text-brand-100">
          বক্স সাবস্ক্রাইব করতে{" "}
          <Link href="/account" className="font-semibold underline">
            লগইন করুন
          </Link>{" "}
          — তারপর এই পেজ থেকেই চালু করা যাবে।
        </p>
      ) : load.kind === "error" ? (
        <p className="mt-3 text-sm text-brand-900 dark:text-brand-100">
          এখন সাবস্ক্রিপশনের তথ্য লোড করা যাচ্ছে না — পরে আবার চেষ্টা করুন।
        </p>
      ) : doneNextRunAt !== null ? (
        <div className="mt-3 rounded-xl bg-surface p-3 text-sm text-text-main">
          <p className="font-semibold">✅ বক্স সাবস্ক্রিপশন চালু হয়েছে</p>
          <p className="mt-1 text-text-muted">
            প্রথম বাক্সের অর্ডার তৈরি হবে: {formatSubscriptionDate(doneNextRunAt)}। পরিচালনা
            করুন{" "}
            <Link href="/account/subscriptions" className="font-semibold text-brand-700 hover:underline">
              আমার সাবস্ক্রিপশন
            </Link>{" "}
            পেজ থেকে।
          </p>
        </div>
      ) : load.addresses.length === 0 ? (
        <p className="mt-3 text-sm text-brand-900 dark:text-brand-100">
          সাবস্ক্রিপশনের জন্য একটি সংরক্ষিত ঠিকানা দরকার —{" "}
          <Link href="/account" className="font-semibold underline">
            অ্যাকাউন্টে ঠিকানা যোগ করুন
          </Link>
          , তারপর এখানে ফিরে আসুন।
        </p>
      ) : (
        <div className="mt-3 grid gap-2.5">
          {variants.length > 1 ? (
            <select
              className={selectClass}
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              aria-label="বাক্সের ধরন"
            >
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} — {formatBdt(v.pricePoisha)}
                </option>
              ))}
            </select>
          ) : selected ? (
            <p className="text-sm font-medium text-brand-900 dark:text-brand-100">
              {selected.label} — {formatBdt(selected.pricePoisha)}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-2.5">
            <select
              className={selectClass}
              value={interval}
              onChange={(e) => setInterval(e.target.value as "WEEKLY" | "MONTHLY")}
              aria-label="সাইকেল"
            >
              {offeredIntervals.map((key) => (
                <option key={key} value={key}>
                  {INTERVAL_LABELS[key].bn}
                </option>
              ))}
            </select>
            <select
              className={selectClass}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              aria-label="বাক্সের সংখ্যা"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}টি বাক্স করে
                </option>
              ))}
            </select>
          </div>
          <select
            className={selectClass}
            value={addressId}
            onChange={(e) => setAddressId(e.target.value)}
            aria-label="ডেলিভারির ঠিকানা"
          >
            {load.addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {(a.label ? `${a.label}: ` : "") + `${a.addressLine}, ${a.upazila}, ${a.district}`}
              </option>
            ))}
          </select>
          {error ? (
            <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy || selected === undefined || selected.stock <= 0}
            onClick={subscribe}
            className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "চালু হচ্ছে…" : "বক্স সাবস্ক্রাইব করুন"}
          </button>
          {selected !== undefined && selected.stock <= 0 ? (
            <p className="text-xs text-brand-800/80 dark:text-brand-200/80">
              বাক্সটি এখন স্টকে নেই — স্টকে ফিরলে সাবস্ক্রাইব করা যাবে।
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

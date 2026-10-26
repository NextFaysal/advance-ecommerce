"use client";

/**
 * "Subscribe & save" card for the PDP (ADV-18 remainder) — rendered
 * by SubscribeSaveSection only when module.subscriptions is ON.
 *
 * Self-fetching: it asks the subscriptions API who is signed in.
 * Guests see a login prompt; signed-in customers pick variant /
 * interval / quantity / saved address and create in one tap. The
 * discount line renders ONLY when the merchant configured a real
 * discount (Settings subscriptions.discount_bps > 0) — with the
 * default 0 the card sells convenience, never an invented saving.
 *
 * The copy is honest about generation: orders are created by the
 * background worker on schedule; the first delivery date shown after
 * subscribing is the scheduled nextRunAt from the API response.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@/checkout/pricing";
import {
  INTERVAL_LABELS,
  SUBSCRIPTION_INTERVALS,
  formatBpsPercent,
  formatSubscriptionDate,
  type SubscriptionInterval,
} from "./labels";

export interface SubscribeVariantOption {
  id: string;
  label: string;
  pricePoisha: number;
  stock: number;
}

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
  data?: {
    addresses: AddressOption[];
    discountBps: number;
  };
  error?: { message?: string };
}

type LoadState =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "ready"; addresses: AddressOption[]; discountBps: number }
  | { kind: "error" };

export function SubscribeSaveCard({
  variants,
  discountBps: serverDiscountBps,
}: {
  variants: SubscribeVariantOption[];
  discountBps: number;
}) {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [variantId, setVariantId] = useState<string>(variants[0]?.id ?? "");
  const [interval, setInterval] = useState<SubscriptionInterval>("MONTHLY");
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
        setLoad({
          kind: "ready",
          addresses,
          discountBps: json.data?.discountBps ?? serverDiscountBps,
        });
        const preferred = addresses.find((a) => a.isDefault) ?? addresses[0];
        if (preferred) setAddressId(preferred.id);
      } catch {
        if (!cancelled) setLoad({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverDiscountBps]);

  const discountBps = load.kind === "ready" ? load.discountBps : serverDiscountBps;
  const selected = variants.find((v) => v.id === variantId) ?? variants[0];

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
        🔁 সাবস্ক্রাইব করে অটো-ডেলিভারি
        {discountBps > 0 ? (
          <span className="ml-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">
            প্রতি অর্ডারে {formatBpsPercent(discountBps)}% ছাড়
          </span>
        ) : null}
      </h3>
      <p className="mt-1 text-sm leading-relaxed text-brand-800 dark:text-brand-200">
        একবার সেট করলেই নির্ধারিত সময়ে অর্ডার তৈরি হয়ে ক্যাশ অন ডেলিভারিতে পৌঁছে যাবে।
        যেকোনো সময় অ্যাকাউন্ট থেকে থামাতে, বদলাতে বা বাতিল করতে পারবেন — কোনো চার্জ ছাড়াই।
      </p>

      {load.kind === "loading" ? (
        <p className="mt-3 text-sm text-brand-800/70 dark:text-brand-200/70">লোড হচ্ছে…</p>
      ) : load.kind === "guest" ? (
        <p className="mt-3 text-sm text-brand-900 dark:text-brand-100">
          সাবস্ক্রাইব করতে{" "}
          <Link href="/account" className="font-semibold underline">
            লগইন করুন
          </Link>{" "}
          — তারপর এই পণ্য থেকেই সাবস্ক্রিপশন চালু করা যাবে।
        </p>
      ) : load.kind === "error" ? (
        <p className="mt-3 text-sm text-brand-900 dark:text-brand-100">
          এখন সাবস্ক্রিপশনের তথ্য লোড করা যাচ্ছে না — পরে আবার চেষ্টা করুন।
        </p>
      ) : doneNextRunAt !== null ? (
        <div className="mt-3 rounded-xl bg-surface p-3 text-sm text-text-main">
          <p className="font-semibold">✅ সাবস্ক্রিপশন চালু হয়েছে</p>
          <p className="mt-1 text-text-muted">
            প্রথম ডেলিভারির অর্ডার তৈরি হবে: {formatSubscriptionDate(doneNextRunAt)}। পরিচালনা
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
              aria-label="ভ্যারিয়েন্ট"
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
              onChange={(e) => setInterval(e.target.value as SubscriptionInterval)}
              aria-label="বিরতি"
            >
              {SUBSCRIPTION_INTERVALS.map((key) => (
                <option key={key} value={key}>
                  {INTERVAL_LABELS[key].bn}
                </option>
              ))}
            </select>
            <select
              className={selectClass}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              aria-label="পরিমাণ"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}টি করে
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
            {busy ? "চালু হচ্ছে…" : "সাবস্ক্রাইব করুন"}
          </button>
          {selected !== undefined && selected.stock <= 0 ? (
            <p className="text-xs text-brand-800/80 dark:text-brand-200/80">
              পণ্যটি এখন স্টকে নেই — স্টকে ফিরলে সাবস্ক্রাইব করা যাবে।
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

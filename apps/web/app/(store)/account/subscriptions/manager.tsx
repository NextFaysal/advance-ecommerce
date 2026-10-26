"use client";

/**
 * Subscriptions manager — /account/subscriptions (ADV-18 remainder).
 *
 * Self-fetching client component: loads the customer's subscriptions
 * + saved addresses from GET /api/v1/public/account/subscriptions and
 * performs every change through the public API (the server
 * re-verifies ownership on each call — this component never sends a
 * customer id). Create sources: variants from the customer's past
 * orders (server-passed props) + one of their saved addresses.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@/checkout/pricing";
import {
  INTERVAL_LABELS,
  STATUS_LABELS,
  SUBSCRIPTION_INTERVALS,
  formatBpsPercent,
  formatSubscriptionDate,
  type SubscriptionInterval,
} from "@/subscriptions/labels";
import type { SubscriptionView } from "@/subscriptions/service";
import type { BoxSubscriptionExtra } from "@/boxes/service";

export interface PurchasableOption {
  variantId: string;
  label: string;
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

interface ListResponse {
  data?: {
    subscriptions: SubscriptionView[];
    addresses: AddressOption[];
    discountBps: number;
    /** ADV-23 vertical 4: box extras by subscription id (absent /
     *  empty while the boxes layer is OFF). */
    boxes?: Record<string, BoxSubscriptionExtra>;
  };
  error?: { message?: string };
}

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

const selectClass =
  "rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/40";
const smallButton =
  "inline-flex items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-main transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";

export function SubscriptionsManager({ purchasable }: { purchasable: PurchasableOption[] }) {
  const [subscriptions, setSubscriptions] = useState<SubscriptionView[] | null>(null);
  const [boxes, setBoxes] = useState<Record<string, BoxSubscriptionExtra>>({});
  const [addresses, setAddresses] = useState<AddressOption[]>([]);
  const [discountBps, setDiscountBps] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Create-form state
  const [variantId, setVariantId] = useState(purchasable[0]?.variantId ?? "");
  const [interval, setInterval] = useState<SubscriptionInterval>("MONTHLY");
  const [quantity, setQuantity] = useState(1);
  const [addressId, setAddressId] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/public/account/subscriptions");
      const json = (await res.json().catch(() => null)) as ListResponse | null;
      if (!res.ok || json?.data === undefined) {
        setLoadError(json?.error?.message ?? "সাবস্ক্রিপশন লোড করা যায়নি।");
        return;
      }
      setSubscriptions(json.data.subscriptions);
      setBoxes(json.data.boxes ?? {});
      setAddresses(json.data.addresses);
      setDiscountBps(json.data.discountBps);
      setAddressId((prev) => {
        if (prev !== "") return prev;
        const preferred = json.data?.addresses.find((a) => a.isDefault) ?? json.data?.addresses[0];
        return preferred?.id ?? "";
      });
    } catch {
      setLoadError("সাবস্ক্রিপশন লোড করা যায়নি — সংযোগ যাচাই করুন।");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>, okMessage: string) {
    setBusyId(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/public/account/subscriptions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setNotice(json?.error?.message ?? "পরিবর্তন করা যায়নি।");
        return;
      }
      setNotice(okMessage);
      await load();
    } catch {
      setNotice("পরিবর্তন করা যায়নি — সংযোগ যাচাই করুন।");
    } finally {
      setBusyId(null);
    }
  }

  async function create() {
    if (variantId === "" || addressId === "") return;
    setCreating(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/public/account/subscriptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ variantId, quantity, interval, addressId }),
      });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setNotice(json?.error?.message ?? "সাবস্ক্রিপশন তৈরি করা যায়নি।");
        return;
      }
      setNotice("সাবস্ক্রিপশন চালু হয়েছে।");
      await load();
    } catch {
      setNotice("সাবস্ক্রিপশন তৈরি করা যায়নি — সংযোগ যাচাই করুন।");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      {notice ? (
        <p role="status" className="rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm text-text-main">
          {notice}
        </p>
      ) : null}

      {/* Create */}
      <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <h2 className="font-display text-base font-bold text-text-main">নতুন সাবস্ক্রিপশন</h2>
        {discountBps > 0 ? (
          <p className="mt-1 text-sm text-text-muted">
            সাবস্ক্রিপশনের প্রতিটি অর্ডারে {formatBpsPercent(discountBps)}% ছাড় প্রযোজ্য।
          </p>
        ) : null}
        {purchasable.length === 0 ? (
          <p className="mt-2 text-sm leading-6 text-text-muted">
            এখনো কোনো অর্ডার করেননি — যেকোনো পণ্যের পেজ থেকে "সাবস্ক্রাইব" করলেই এখানে দেখা যাবে।
            কেনাকাটা করতে{" "}
            <Link href="/shop" className="font-semibold text-brand-700 hover:underline">
              শপে যান
            </Link>
            ।
          </p>
        ) : addresses.length === 0 ? (
          <p className="mt-2 text-sm leading-6 text-text-muted">
            সাবস্ক্রিপশনের জন্য একটি সংরক্ষিত ঠিকানা দরকার —{" "}
            <Link href="/account" className="font-semibold text-brand-700 hover:underline">
              অ্যাকাউন্টে ঠিকানা যোগ করুন
            </Link>
            ।
          </p>
        ) : (
          <div className="mt-3 grid gap-2.5">
            <select className={selectClass} value={variantId} onChange={(e) => setVariantId(e.target.value)} aria-label="পণ্য">
              {purchasable.map((p) => (
                <option key={p.variantId} value={p.variantId}>
                  {p.label}
                </option>
              ))}
            </select>
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
            <select className={selectClass} value={addressId} onChange={(e) => setAddressId(e.target.value)} aria-label="ডেলিভারির ঠিকানা">
              {addresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {(a.label ? `${a.label}: ` : "") + `${a.addressLine}, ${a.upazila}, ${a.district}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={creating}
              onClick={create}
              className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? "তৈরি হচ্ছে…" : "সাবস্ক্রিপশন চালু করুন"}
            </button>
          </div>
        )}
      </section>

      {/* List */}
      <section>
        <h2 className="font-display text-base font-bold text-text-main">আমার সাবস্ক্রিপশনসমূহ</h2>
        {loadError ? (
          <p role="alert" className="mt-3 text-sm font-medium text-red-700 dark:text-red-300">
            {loadError}
          </p>
        ) : subscriptions === null ? (
          <p className="mt-3 text-sm text-text-muted">লোড হচ্ছে…</p>
        ) : subscriptions.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">কোনো সাবস্ক্রিপশন নেই।</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {subscriptions.map((s) => (
              <li key={s.id} className="rounded-2xl border border-border bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug text-text-main">
                      {s.productName} — {s.variantLabel}
                      {boxes[s.id] ? (
                        <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800 dark:bg-brand-500/15 dark:text-brand-200">
                          📦 বক্স
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-sm text-text-muted">
                      {formatBdt(s.unitPricePoisha)} × {s.quantity} · {INTERVAL_LABELS[s.interval as SubscriptionInterval]?.bn ?? s.interval} ·
                      ক্যাশ অন ডেলিভারি
                    </p>
                  </div>
                  <span
                    className={
                      s.status === "ACTIVE"
                        ? "rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200"
                        : s.status === "PAUSED"
                          ? "rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200"
                          : "rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-muted"
                    }
                  >
                    {STATUS_LABELS[s.status]?.bn ?? s.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-text-muted">
                  ঠিকানা: {s.address.addressLine}, {s.address.upazila}, {s.address.district}
                </p>
                {boxes[s.id] ? (
                  <div className="mt-2 rounded-xl bg-surface-2/60 p-3 text-sm">
                    <p className="font-semibold text-text-main">
                      📦 পরের বাক্স · সাইকেল {boxes[s.id]?.nextCycleKey}
                      {boxes[s.id]?.nextContents?.noteBn
                        ? ` — ${boxes[s.id]?.nextContents?.noteBn}`
                        : ""}
                    </p>
                    {boxes[s.id]?.nextContents ? (
                      <ul className="mt-1 list-inside list-disc space-y-0.5 text-text-muted">
                        {boxes[s.id]?.nextContents?.items.map((item) => (
                          <li key={item.variantId}>
                            {item.productName} — {item.variantLabel} × {fmtQty(item.quantity)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-text-muted">
                        এই সাইকেলের বাক্সের তালিকা এখনো ঘোষণা হয়নি — তালিকা নির্ধারণ না হলে এই
                        চক্রে অর্ডার তৈরি হবে না।
                      </p>
                    )}
                    {boxes[s.id]?.lastContents ? (
                      <>
                        <p className="mt-2 font-semibold text-text-main">
                          আগের বাক্সে ছিল · সাইকেল {boxes[s.id]?.lastCycleKey}
                        </p>
                        <ul className="mt-1 list-inside list-disc space-y-0.5 text-text-muted">
                          {boxes[s.id]?.lastContents?.items.map((item) => (
                            <li key={item.variantId}>
                              {item.productName} — {item.variantLabel} × {fmtQty(item.quantity)}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </div>
                ) : null}
                {s.status === "ACTIVE" ? (
                  <p className="mt-1 text-sm text-text-muted">
                    পরবর্তী অর্ডার: {formatSubscriptionDate(s.nextRunAt)}
                    {s.lastRunAt ? ` · সর্বশেষ অর্ডার: ${formatSubscriptionDate(s.lastRunAt)}` : ""}
                  </p>
                ) : null}
                {s.lastError ? (
                  <p className="mt-1 text-sm font-medium text-red-700 dark:text-red-300">
                    সর্বশেষ চক্রে সমস্যা: {s.lastError}
                  </p>
                ) : null}
                {s.status !== "CANCELLED" ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <select
                      className={selectClass + " py-1.5 text-xs"}
                      value={s.interval}
                      disabled={busyId === s.id}
                      onChange={(e) =>
                        patch(s.id, { interval: e.target.value }, "বিরতি বদলানো হয়েছে।")
                      }
                      aria-label="বিরতি বদলান"
                    >
                      {SUBSCRIPTION_INTERVALS.map((key) => (
                        <option key={key} value={key}>
                          {INTERVAL_LABELS[key].bn}
                        </option>
                      ))}
                    </select>
                    <select
                      className={selectClass + " py-1.5 text-xs"}
                      value={s.quantity}
                      disabled={busyId === s.id}
                      onChange={(e) =>
                        patch(s.id, { quantity: Number(e.target.value) }, "পরিমাণ বদলানো হয়েছে।")
                      }
                      aria-label="পরিমাণ বদলান"
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                        <option key={n} value={n}>
                          {n}টি
                        </option>
                      ))}
                    </select>
                    {s.status === "ACTIVE" ? (
                      <button type="button" className={smallButton} disabled={busyId === s.id} onClick={() => patch(s.id, { action: "pause" }, "সাবস্ক্রিপশন থামানো হয়েছে।")}>
                        সাময়িক থামান
                      </button>
                    ) : (
                      <button type="button" className={smallButton} disabled={busyId === s.id} onClick={() => patch(s.id, { action: "resume" }, "সাবস্ক্রিপশন আবার চালু হয়েছে।")}>
                        আবার চালু করুন
                      </button>
                    )}
                    <button
                      type="button"
                      className={smallButton + " border-red-300 text-red-700 hover:bg-red-50 dark:border-red-400/30 dark:text-red-300 dark:hover:bg-red-500/10"}
                      disabled={busyId === s.id}
                      onClick={() => patch(s.id, { action: "cancel" }, "সাবস্ক্রিপশন বাতিল হয়েছে।")}
                    >
                      বাতিল করুন
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

"use client";

/**
 * Admin box-subscription list — /admin/boxes (ADV-23 vertical 4).
 *
 * Self-fetching: GET /api/v1/admin/boxes/subscriptions
 * (orders.view). Read only — customers manage their own
 * subscriptions; this list exists so staff can see which box
 * cycles WILL generate, which already generated, which were
 * skipped for missing contents, and what failed (lastError shown
 * verbatim).
 *
 * HONEST GENERATION STATE: orders are created only by the worker
 * sweep. Until a worker host runs, ACTIVE rows pass their
 * nextRunAt WITHOUT an order appearing — stated in the banner,
 * mirroring the wave-51 admin list.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatBdt } from "@/checkout/pricing";
import {
  INTERVAL_LABELS,
  STATUS_LABELS,
  formatSubscriptionDate,
  type SubscriptionInterval,
} from "@/subscriptions/labels";
import type { SubscriptionView } from "@/subscriptions/service";
import type { BoxSubscriptionExtra } from "@/boxes/service";

interface Row {
  view: SubscriptionView;
  extra: BoxSubscriptionExtra;
}

interface ListResponse {
  data?: { subscriptions: Row[] };
  meta?: { moduleEnabled?: boolean; engineEnabled?: boolean; generation?: string };
  error?: { message?: string };
}

export function BoxesList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [engineEnabled, setEngineEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/boxes/subscriptions");
        const json = (await res.json().catch(() => null)) as ListResponse | null;
        if (cancelled) return;
        if (!res.ok || json?.data === undefined) {
          setError(json?.error?.message ?? "বক্স সাবস্ক্রিপশনের তালিকা লোড করা যায়নি।");
          return;
        }
        setRows(json.data.subscriptions);
        setEngineEnabled(json.meta?.engineEnabled ?? null);
      } catch {
        if (!cancelled) setError("বক্স সাবস্ক্রিপশনের তালিকা লোড করা যায়নি — সংযোগ যাচাই করুন।");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="font-display text-base font-bold text-text-main">বক্স সাবস্ক্রিপশনসমূহ</h2>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        অর্ডার তৈরি হয় শুধু ওয়ার্কার সুইপ চললে — ওয়ার্কার হোস্ট না থাকলে সক্রিয়
        সাবস্ক্রিপশনের তারিখ পেরিয়ে গেলেও অর্ডার আসবে না।
        {engineEnabled === false
          ? " সাবস্ক্রিপশন ইঞ্জিন (module.subscriptions) এখন বন্ধ — জেনারেশন সম্পূর্ণ বন্ধ আছে।"
          : ""}
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : rows === null ? (
        <p className="mt-3 text-sm text-text-muted">লোড হচ্ছে…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">
          কোনো বক্স সাবস্ক্রিপশন নেই — কনফিগে বক্স ভ্যারিয়েন্ট যোগ করলে ওই পণ্যের পেজ থেকে
          কাস্টমার সাবস্ক্রাইব করতে পারবেন।
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                <th className="py-2 pr-3 font-semibold">কাস্টমার</th>
                <th className="py-2 pr-3 font-semibold">বক্স</th>
                <th className="py-2 pr-3 font-semibold">সাইকেল</th>
                <th className="py-2 pr-3 font-semibold">অবস্থা</th>
                <th className="py-2 pr-3 font-semibold">পরের সাইকেল</th>
                <th className="py-2 pr-3 font-semibold">সর্বশেষ জেনারেশন</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ view: s, extra }) => (
                <tr key={s.id} className="border-b border-border/60 align-top">
                  <td className="py-2.5 pr-3">
                    <p className="font-medium text-text-main">{s.customerName}</p>
                    <p className="text-xs text-text-muted">{s.customerPhone}</p>
                  </td>
                  <td className="py-2.5 pr-3">
                    <p className="font-medium text-text-main">
                      {s.productName} — {s.variantLabel}
                    </p>
                    <p className="text-xs text-text-muted">
                      {formatBdt(s.unitPricePoisha)} × {s.quantity} · {s.sku}
                    </p>
                  </td>
                  <td className="py-2.5 pr-3 text-text-muted">
                    {INTERVAL_LABELS[s.interval as SubscriptionInterval]?.bn ?? s.interval}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge>{STATUS_LABELS[s.status]?.bn ?? s.status}</Badge>
                    {s.lastError ? (
                      <p className="mt-1 max-w-[260px] text-xs font-medium text-red-700 dark:text-red-300">
                        {s.lastError}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3">
                    <p className="text-text-main">{formatSubscriptionDate(s.nextRunAt)}</p>
                    <p className="text-xs text-text-muted">সাইকেল {extra.nextCycleKey}</p>
                    {extra.nextContents ? (
                      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        তালিকা নির্ধারিত ✓ ({extra.nextContents.items.length}টি পণ্য)
                      </p>
                    ) : (
                      <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                        তালিকা নেই — এই সাইকেল বাদ যাবে
                      </p>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    {s.lastRunAt ? (
                      <>
                        <p className="text-text-main">{formatSubscriptionDate(s.lastRunAt)}</p>
                        <p className="text-xs text-text-muted">
                          {extra.lastCycleKey ? `সাইকেল ${extra.lastCycleKey} · ` : ""}
                          মোট {s.runCount} বার
                        </p>
                        {s.lastOrderId ? (
                          <Link
                            href={`/admin/orders/${s.lastOrderId}`}
                            className="text-xs font-semibold text-brand-700 hover:underline"
                          >
                            সর্বশেষ অর্ডার দেখুন
                          </Link>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-text-muted">এখনো হয়নি</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

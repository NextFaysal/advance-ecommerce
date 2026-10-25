"use client";

/**
 * Abandoned checkouts — REAL data from GET /api/v1/admin/abandoned
 * (wave 22, doc 17 batch O4). Lists the captures the storefront
 * recorded when a shopper typed a valid phone + had cart items but
 * left without ordering. Phones arrive MASKED from the API (the full
 * number never reaches the browser); the call-task action hands the
 * number to the call centre server-side instead.
 *
 * Actions: "কল টাস্ক" (create an ABANDONED_CHECKOUT call task),
 * "অর্ডারে রূপান্তর" (convert — re-priced at CURRENT catalog prices
 * into a real COD order via the server funnel; confirmed first), and
 * "বাতিল" (dismiss). Captures expire 7 days after capture and drop
 * off this list — stated in the header copy, never hidden.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { formatBdt } from "../../../src/checkout/pricing";

interface AbandonedItem {
  variantId: string;
  quantity: number;
  pricePoishaAtCapture: number;
  productName: string | null;
  sku: string | null;
}

interface AbandonedRow {
  id: string;
  customerPhoneMasked: string;
  customerName: string | null;
  items: AbandonedItem[];
  itemCount: number;
  subtotalPoisha: number;
  address: {
    division?: string;
    district?: string;
    upazila?: string;
    addressLine?: string;
  } | null;
  hasCallTask: boolean;
  createdAt: string;
  lastSeenAt: string;
  ageMinutes: number;
}

interface ListResponse {
  data: AbandonedRow[];
  meta: { total: number; expiresAfterDays: number };
}

function ageLabel(ageMinutes: number): string {
  if (ageMinutes < 1) return "এইমাত্র";
  if (ageMinutes < 60) return `${ageMinutes} মিনিট আগে`;
  const hours = Math.floor(ageMinutes / 60);
  if (hours < 24) return `${hours} ঘণ্টা আগে`;
  return `${Math.floor(hours / 24)} দিন আগে`;
}

/* OD6 (doc 19 §3-S6) — age ramp in the aging panel's language
 * (app/admin/orders/aging-panel.tsx): the longer a capture has sat,
 * the hotter the chip. Thresholds mirror ageChipClass there. */
function ageChipClass(ageMinutes: number): string {
  const ageHours = ageMinutes / 60;
  if (ageHours >= 7 * 24) return "bg-rose-100 text-rose-800";
  if (ageHours >= 5 * 24) return "bg-orange-100 text-orange-800";
  if (ageHours >= 48) return "bg-amber-100 text-amber-800";
  return "bg-yellow-50 text-yellow-800";
}

export default function AdminAbandonedPage() {
  const [rows, setRows] = useState<AbandonedRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/abandoned");
      if (!res.ok) {
        setLoadError("তালিকা লোড করা যায়নি। আবার চেষ্টা করুন।");
        return;
      }
      const json = (await res.json()) as ListResponse;
      setRows(json.data);
      setTotal(json.meta.total);
      setLoadError(null);
    } catch {
      setLoadError("তালিকা লোড করা যায়নি। আবার চেষ্টা করুন।");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: "call-task" | "convert" | "dismiss") {
    if (action === "convert") {
      const ok = window.confirm(
        "এই ক্যাপচার থেকে বর্তমান ক্যাটালগ দামে একটি আসল COD অর্ডার তৈরি হবে এবং স্টক সংরক্ষিত হবে। এগিয়ে যাবেন?",
      );
      if (!ok) return;
    }
    if (action === "dismiss") {
      const ok = window.confirm("এই ক্যাপচারটি বাতিল করা হবে — এটি আর এই তালিকায় আসবে না। নিশ্চিত?");
      if (!ok) return;
    }
    setBusyId(id);
    setNotice(null);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/admin/abandoned/${id}/${action}`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as {
        data?: { orderNo?: string };
        meta?: { alreadyConverted?: boolean };
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setActionError(json?.error?.message ?? "অ্যাকশনটি সম্পন্ন করা যায়নি।");
        return;
      }
      if (action === "convert") {
        setNotice(
          json?.meta?.alreadyConverted
            ? `এই ক্যাপচার থেকে আগেই অর্ডার হয়েছে: ${json?.data?.orderNo ?? ""}`
            : `অর্ডার তৈরি হয়েছে: ${json?.data?.orderNo ?? ""}`,
        );
      } else if (action === "call-task") {
        setNotice("কল টাস্ক তৈরি হয়েছে — কল সেন্টার কিউতে পাওয়া যাবে।");
      } else {
        setNotice("ক্যাপচারটি বাতিল করা হয়েছে।");
      }
      await load();
    } catch {
      setActionError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main>
      <PageHeader
        title="পরিত্যক্ত চেকআউট"
        description="যেসব ক্রেতা ফোন নম্বর দিয়ে কার্টে পণ্য রেখে অর্ডার না করেই চলে গেছেন। ক্যাপচার ৭ দিন পর্যন্ত থাকে — মেয়াদ শেষ হলে তালিকা থেকে সরে যায়। ফোন নম্বর এখানে সবসময় আড়াল করা থাকে; ফলো-আপের জন্য কল টাস্ক তৈরি করুন।"
      />

      {notice && (
        <p role="status" className="mb-4 rounded-md bg-success-50 px-3.5 py-2.5 text-small text-success-700">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mb-4 rounded-md bg-danger-50 px-3.5 py-2.5 text-small text-danger-700">
          {actionError}
        </p>
      )}

      {loadError && (
        <Card>
          <p className="text-sm text-rose-600">{loadError}</p>
        </Card>
      )}

      {rows === null && !loadError && (
        <div className="grid gap-3" aria-hidden="true">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {rows !== null && rows.length === 0 && !loadError && (
        <EmptyState
          title="এখন কোনো খোলা পরিত্যক্ত চেকআউট নেই"
          description="ক্রেতা চেকআউটে সঠিক ফোন নম্বর লিখে কার্টে পণ্য রেখে অর্ডার শেষ না করে চলে গেলেই এখানে একটি সারি আসবে। অর্ডার হয়ে যাওয়া বা বাতিল করা ক্যাপচার এই তালিকায় থাকে না।"
        />
      )}

      {rows !== null && rows.length > 0 && (
        <>
          {/* Recovery strip (OD6): everything below is computed ONLY
              from the rows this page loaded. The API returns no grand
              total value, so when the list is truncated the money is
              labelled as this page's sum — never presented as the
              all-captures total. */}
          <Card className="mb-3">
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <div>
                <p className="text-caption font-medium text-text-subtle">খোলা ক্যাপচার</p>
                <p className="mt-0.5 text-lg font-bold text-text-main">{total}টি</p>
              </div>
              <div>
                <p className="text-caption font-medium text-text-subtle">
                  সম্ভাব্য বিক্রি{total > rows.length ? ` (এই পেজে — সর্বশেষ ${rows.length}টি)` : ""}
                </p>
                <p className="mt-0.5 text-lg font-bold text-text-main">
                  {formatBdt(rows.reduce((s, r) => s + r.subtotalPoisha, 0))}
                </p>
              </div>
              <div>
                <p className="text-caption font-medium text-text-subtle">সবচেয়ে পুরনো</p>
                <p className="mt-0.5">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold ${ageChipClass(Math.max(...rows.map((r) => r.ageMinutes)))}`}
                  >
                    {ageLabel(Math.max(...rows.map((r) => r.ageMinutes)))}
                  </span>
                </p>
              </div>
            </div>
          </Card>
          <ul className="grid gap-3">
            {rows.map((row) => (
              <li key={row.id}>
                <Card>
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-text-main">
                        {row.customerName ?? "নাম দেয়নি"}{" "}
                        <span className="ml-1 font-normal text-text-muted">{row.customerPhoneMasked}</span>
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-small text-text-muted">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold ${ageChipClass(row.ageMinutes)}`}
                        >
                          শেষ কার্যকলাপ {ageLabel(row.ageMinutes)}
                        </span>
                        <span>
                          {row.address?.district ? row.address.district : "জেলা পাওয়া যায়নি"}
                          {row.address?.upazila ? `, ${row.address.upazila}` : ""}
                        </span>
                      </p>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="font-semibold">{formatBdt(row.subtotalPoisha)}</p>
                      <p className="text-small text-text-muted">{row.itemCount}টি পণ্য</p>
                    </div>
                  </div>

                  <ul className="mt-3 divide-y divide-border rounded-md border border-border">
                    {row.items.map((item) => (
                      <li key={item.variantId} className="flex flex-wrap items-center gap-x-3 px-3 py-1.5 text-small">
                        <span className="font-medium">{item.productName ?? "পণ্য পাওয়া যাচ্ছে না"}</span>
                        {item.sku && <span className="text-text-muted">{item.sku}</span>}
                        <span className="ml-auto text-text-muted">
                          × {item.quantity} · {formatBdt(item.pricePoishaAtCapture)} (ধরার সময়ের দাম)
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <button
                      type="button"
                      disabled={busyId === row.id || row.hasCallTask}
                      onClick={() => void act(row.id, "call-task")}
                      className="w-full rounded-md border border-border bg-surface px-3 py-1.5 text-small font-medium text-text-main transition disabled:opacity-50 sm:w-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      {row.hasCallTask ? "কল টাস্ক তৈরি আছে" : "কল টাস্ক তৈরি করুন"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void act(row.id, "convert")}
                      className="w-full rounded-md bg-brand-600 px-3 py-1.5 text-small font-medium text-white transition disabled:opacity-50 sm:w-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      অর্ডারে রূপান্তর করুন
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void act(row.id, "dismiss")}
                      className="w-full rounded-md border border-rose-200 bg-surface px-3 py-1.5 text-small font-medium text-rose-600 transition disabled:opacity-50 sm:w-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      বাতিল করুন
                    </button>
                    <Link
                      href="/admin/call-center"
                      className="self-center text-small font-medium text-brand-700 hover:underline sm:ml-auto"
                    >
                      কল সেন্টারে যান
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

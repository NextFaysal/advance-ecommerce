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
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          {actionError}
        </p>
      )}

      {loadError && (
        <Card>
          <p className="text-sm text-rose-600">{loadError}</p>
        </Card>
      )}

      {rows === null && !loadError && <p className="text-sm text-text-muted">লোড হচ্ছে…</p>}

      {rows !== null && rows.length === 0 && !loadError && (
        <Card>
          <h3 className="font-semibold">এখন কোনো খোলা পরিত্যক্ত চেকআউট নেই</h3>
          <p className="mt-1 text-sm leading-relaxed text-text-muted">
            ক্রেতা চেকআউটে সঠিক ফোন নম্বর লিখে কার্টে পণ্য রেখে অর্ডার শেষ না করে চলে গেলেই
            এখানে একটি সারি আসবে। অর্ডার হয়ে যাওয়া বা বাতিল করা ক্যাপচার এই তালিকায় থাকে না।
          </p>
        </Card>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <p className="mb-3 text-sm text-text-muted">
            মোট {total}টি খোলা ক্যাপচার{total > rows.length ? ` (সর্বশেষ ${rows.length}টি দেখানো হচ্ছে)` : ""}
          </p>
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
                      <p className="mt-0.5 text-small text-text-muted">
                        শেষ কার্যকলাপ {ageLabel(row.ageMinutes)}
                        {row.address?.district ? ` · ${row.address.district}` : " · জেলা পাওয়া যায়নি"}
                        {row.address?.upazila ? `, ${row.address.upazila}` : ""}
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

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyId === row.id || row.hasCallTask}
                      onClick={() => void act(row.id, "call-task")}
                      className="rounded-md border border-border bg-white px-3 py-1.5 text-small font-medium text-text-main transition disabled:opacity-50"
                    >
                      {row.hasCallTask ? "কল টাস্ক তৈরি আছে" : "কল টাস্ক তৈরি করুন"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void act(row.id, "convert")}
                      className="rounded-md bg-brand-600 px-3 py-1.5 text-small font-medium text-white transition disabled:opacity-50"
                    >
                      অর্ডারে রূপান্তর করুন
                    </button>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void act(row.id, "dismiss")}
                      className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-small font-medium text-rose-600 transition disabled:opacity-50"
                    >
                      বাতিল করুন
                    </button>
                    <Link
                      href="/admin/call-center"
                      className="ml-auto self-center text-small font-medium text-brand-700 hover:underline"
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

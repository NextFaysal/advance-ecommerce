"use client";

// Admin order list + kanban — REAL data from GET /api/v1/admin/orders
// (Prisma-backed; phone masked server-side for viewers without
// customers.view_full_phone). The list loads the first 100 orders and
// filters/searches them on this page; status counts and the kanban are
// computed from those real rows — an empty DB shows an honest empty
// state, never sample rows. Bulk actions go through the BulkActionBar
// (real job pipeline, per-order results from the Jobs API). The manual
// order form below is validation-only: there is NO admin manual-create
// endpoint yet, and the form says so instead of pretending to create.
//
// Presentation (Design Refresh R3): Tailwind table system — sticky
// header, status pills, payment/risk badges, filter chips with real
// counts, designed empty/loading states. Data flow unchanged.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Order, OrderStatus } from "../../../src/orders/types";
import { MANUAL_ORDER_STEPS, manualOrderSchema } from "../../../src/orders/manual-order";
import { displayPhone, riskLevel } from "../../../src/orders/customer";
import { formatBdt } from "../../../src/checkout/pricing";
import { BulkActionBar } from "../../../src/orders/components/BulkActionBar";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaymentBadge, type PaymentStatus as UiPaymentStatus } from "@/components/ui/status-badge";

const STATUSES: ("ALL" | OrderStatus)[] = [
  "ALL", "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED",
  "DELIVERED", "FAILED", "RETURN_REQUESTED", "RETURNING", "RETURNED",
  "CANCELLED", "REFUNDED", "EXCHANGED",
];

const STATUS_META: Record<string, { label: string; tone: "brand" | "success" | "warning" | "danger" | "info" | "neutral"; dot: string }> = {
  ALL: { label: "সব", tone: "brand", dot: "#6366F1" },
  PENDING: { label: "অপেক্ষমাণ", tone: "warning", dot: "#F59E0B" },
  CONFIRMED: { label: "নিশ্চিত", tone: "info", dot: "#0EA5E9" },
  PROCESSING: { label: "প্রসেসিং", tone: "brand", dot: "#8B5CF6" },
  PACKED: { label: "প্যাক করা", tone: "brand", dot: "#7C3AED" },
  SHIPPED: { label: "পাঠানো হয়েছে", tone: "info", dot: "#6366F1" },
  DELIVERED: { label: "ডেলিভার্ড", tone: "success", dot: "#10B981" },
  FAILED: { label: "ব্যর্থ", tone: "danger", dot: "#F43F5E" },
  RETURN_REQUESTED: { label: "রিটার্ন অনুরোধ", tone: "warning", dot: "#F97316" },
  RETURNING: { label: "রিটার্ন আসছে", tone: "warning", dot: "#F97316" },
  RETURNED: { label: "রিটার্ন হয়েছে", tone: "neutral", dot: "#94A3B8" },
  CANCELLED: { label: "বাতিল", tone: "neutral", dot: "#94A3B8" },
  REFUNDED: { label: "রিফান্ড", tone: "info", dot: "#14B8A6" },
  EXCHANGED: { label: "এক্সচেঞ্জ", tone: "info", dot: "#14B8A6" },
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cod: "ক্যাশ অন ডেলিভারি",
  bkash: "বিকাশ",
  nagad: "নগদ",
  rocket: "রকেট",
  card: "কার্ড",
  sslcommerz: "SSLCommerz",
};

const UI_PAYMENT_STATUSES: readonly string[] = ["UNPAID", "PARTIAL", "PAID", "FAILED", "REFUNDED"];

type LoadState = "loading" | "error" | "ready";

const inputCls =
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const labelCls = "mb-1.5 block text-small font-medium text-text-main";

export default function AdminOrdersPage() {
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<"ALL" | OrderStatus>("ALL");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "kanban">("table");
  const [manualResult, setManualResult] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await fetch("/api/v1/admin/orders?pageSize=100");
      const body = (await res.json().catch(() => null)) as
        | { data?: Order[]; meta?: { total?: number }; error?: { code: string; message: string } }
        | null;
      if (res.ok && body && "data" in body && body.data) {
        setAllOrders(body.data);
        setTotal(body.meta?.total ?? body.data.length);
        setLoadState("ready");
      } else {
        setLoadError(
          body && "error" in body && body.error
            ? `${body.error.code}: ${body.error.message}`
            : `HTTP ${res.status}`,
        );
        setLoadState("error");
      }
    } catch {
      setLoadError("নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি।");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    // Initial filter from the URL (command-palette natural-language links
    // land here with ?status= / ?q= / ?district=; district/date are not
    // API filters, the text search covers the order number case).
    const params = new URLSearchParams(window.location.search);
    const statusParam = params.get("status");
    if (statusParam && (STATUSES as string[]).includes(statusParam)) {
      setFilter(statusParam as OrderStatus);
    }
    const q = params.get("q") ?? params.get("search");
    if (q) setSearch(q);
    void load();
  }, [load]);

  const orders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allOrders.filter((o) => {
      if (filter !== "ALL" && o.status !== filter) return false;
      if (!needle) return true;
      return (
        o.orderNo.toLowerCase().includes(needle) ||
        o.customerName.toLowerCase().includes(needle) ||
        o.address.district.toLowerCase().includes(needle) ||
        o.address.division.toLowerCase().includes(needle)
      );
    });
  }, [allOrders, filter, search]);

  const countFor = useCallback(
    (s: "ALL" | OrderStatus) => (s === "ALL" ? allOrders.length : allOrders.filter((o) => o.status === s).length),
    [allOrders],
  );

  const selectedIds = useMemo(() => [...selected], [selected]);
  const allVisibleSelected = orders.length > 0 && orders.every((o) => selected.has(o.id));

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) orders.forEach((o) => next.delete(o.id));
      else orders.forEach((o) => next.add(o.id));
      return next;
    });
  }

  function onManualSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const parsed = manualOrderSchema.safeParse({
      phone: data.get("phone"),
      customerName: data.get("customerName"),
      address: {
        division: data.get("division"),
        district: data.get("district"),
        upazila: data.get("upazila"),
        addressLine: data.get("addressLine"),
      },
      items: [{ variantId: data.get("variantId"), quantity: Number(data.get("quantity")), unitPricePoisha: Number(data.get("unitPricePoisha")) }],
      paymentMethod: data.get("paymentMethod"),
      note: data.get("note") || undefined,
    });
    setManualResult(
      parsed.success
        ? "ফর্মটি সঠিক আছে। কিন্তু অ্যাডমিন ম্যানুয়াল-ক্রিয়েট API এখনো তৈরি হয়নি — তাই কোনো অর্ডার তৈরি হয়নি। (API গ্যাপ: POST /api/v1/admin/orders শুধু বাল্ক জব নেয়।)"
        : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | "),
    );
  }

  return (
    <main>
      <PageHeader
        title="অর্ডার"
        description="ডাটাবেস থেকে আসল অর্ডার — ফোন নম্বর ডিফল্টভাবে মাস্ক করা থাকে।"
        actions={
          <Button variant="outline" onClick={() => void load()}>
            রিফ্রেশ
          </Button>
        }
      />

      {loadState === "loading" && (
        <div role="status" aria-label="অর্ডার লোড হচ্ছে" className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
          <div className="border-b border-border bg-surface-2 px-4 py-3">
            <div className="h-4 w-40 animate-pulse rounded bg-border" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
              <div className="h-4 w-4 animate-pulse rounded bg-border" />
              <div className="h-4 w-24 animate-pulse rounded bg-border" />
              <div className="h-4 w-36 animate-pulse rounded bg-border" />
              <div className="ml-auto h-4 w-16 animate-pulse rounded bg-border" />
            </div>
          ))}
          <p className="px-4 py-3 text-small text-text-muted">অর্ডার লোড হচ্ছে…</p>
        </div>
      )}

      {loadState === "error" && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 shadow-card">
          <p className="font-semibold text-rose-700">অর্ডার লোড হয়নি</p>
          <p className="mt-1 text-small text-rose-600">{loadError}</p>
          <Button variant="outline" className="mt-4 bg-card" onClick={() => void load()}>
            আবার চেষ্টা করুন
          </Button>
        </div>
      )}

      {loadState === "ready" && (
        <>
          {/* Filter bar */}
          <Card className="mb-4 shadow-card">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[220px] flex-1">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle">
                  <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
                </svg>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="অর্ডার নম্বর, নাম বা জেলা খুঁজুন…"
                  aria-label="অর্ডার খুঁজুন"
                  className="h-11 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </div>
              <div className="flex rounded-md bg-surface-2 p-1" role="group" aria-label="ভিউ বেছে নিন">
                {(["table", "kanban"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    aria-pressed={view === v}
                    className={`min-h-[36px] rounded-[9px] px-3.5 text-small font-semibold transition motion-fast ${
                      view === v ? "bg-card text-brand-700 shadow-sm" : "text-text-muted hover:text-text-main"
                    }`}
                  >
                    {v === "table" ? "টেবিল" : "কানবান"}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {STATUSES.map((s) => {
                const meta = STATUS_META[s] ?? { label: s, tone: "neutral" as const, dot: "#94A3B8" };
                const active = filter === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFilter(s)}
                    aria-pressed={active}
                    className={`flex min-h-[32px] items-center gap-1.5 rounded-full px-3 text-caption font-semibold transition motion-fast ${
                      active ? "bg-brand-600 text-white shadow-sm" : "border border-border bg-card text-text-muted hover:border-brand-300 hover:text-brand-700"
                    }`}
                  >
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: active ? "#fff" : meta.dot }} />
                    {meta.label}
                    <span className={`font-mono tabular-nums ${active ? "text-white/85" : "text-text-subtle"}`}>{countFor(s)}</span>
                  </button>
                );
              })}
              <span className="ml-auto text-caption text-text-muted">
                {orders.length}টি অর্ডার দেখানো হচ্ছে (মোট {total}টি; প্রথম ১০০টি লোড হয়)
              </span>
            </div>
          </Card>

          {/* Bulk bar — renders itself only when orders are selected */}
          <div className="mb-4 empty:mb-0">
            <BulkActionBar selectedIds={selectedIds} onClear={() => setSelected(new Set())} onDone={() => void load()} />
          </div>

          {orders.length === 0 ? (
            <div className="rounded-lg border border-border bg-card px-6 py-14 text-center shadow-card">
              <span aria-hidden="true" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
                  <circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" />
                  <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
                </svg>
              </span>
              <h2 className="mt-4 text-h3">কোনো অর্ডার পাওয়া যায়নি</h2>
              <p className="mx-auto mt-1 max-w-md text-small leading-relaxed text-text-muted">
                {filter !== "ALL" || search.trim() !== ""
                  ? "এই ফিল্টার/খোঁজে ডাটাবেসে কোনো অর্ডার নেই। ফিল্টার বদলে আবার দেখুন।"
                  : "ডাটাবেসে এখনো কোনো অর্ডার নেই। নতুন অর্ডার চেকআউট থেকে এলেই এখানে দেখা যাবে।"}
              </p>
              {filter !== "ALL" || search.trim() !== "" ? (
                <Button
                  variant="outline"
                  className="mt-5"
                  onClick={() => { setFilter("ALL"); setSearch(""); }}
                >
                  ফিল্টার মুছে ফেলুন
                </Button>
              ) : null}
            </div>
          ) : view === "table" ? (
            <div className="overflow-auto rounded-lg border border-border bg-card shadow-card" style={{ maxHeight: "72vh" }}>
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-surface-2 text-left [&>th]:border-b [&>th]:border-border">
                    <th scope="col" className="w-11 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        aria-label="দৃশ্যমান সব অর্ডার সিলেক্ট করুন"
                        className="h-4 w-4 rounded accent-[#4F46E5]"
                      />
                    </th>
                    {["অর্ডার", "গ্রাহক", "মোট", "পেমেন্ট", "স্ট্যাটাস", "ঝুঁকি", "কুরিয়ার"].map((h) => (
                      <th key={h} scope="col" className="px-4 py-3 text-caption font-semibold text-text-muted">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const meta = STATUS_META[o.status] ?? { label: o.status, tone: "neutral" as const, dot: "#94A3B8" };
                    const level = riskLevel(o.riskScore);
                    return (
                      <tr key={o.id} className={`border-t border-border transition motion-fast hover:bg-surface-2/70 ${selected.has(o.id) ? "bg-brand-50/60" : ""}`}>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(o.id)}
                            onChange={() => toggleSelected(o.id)}
                            aria-label={`${o.orderNo} সিলেক্ট করুন`}
                            className="h-4 w-4 rounded accent-[#4F46E5]"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <a href={`/admin/orders/${o.id}`} className="font-mono text-small font-semibold text-brand-700 hover:underline">
                            {o.orderNo}
                          </a>
                          <span className="block text-caption text-text-subtle">{o.address.district}, {o.address.division}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="block font-medium leading-snug">{o.customerName}</span>
                          <span className="block text-caption text-text-muted">{displayPhone(o.customerPhone, false)}</span>
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold tabular-nums">{formatBdt(o.totalPoisha)}</td>
                        <td className="px-4 py-3">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge tone="neutral">{PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod}</Badge>
                            {UI_PAYMENT_STATUSES.includes(o.paymentStatus)
                              ? <PaymentBadge status={o.paymentStatus as UiPaymentStatus} />
                              : <Badge tone="neutral">{o.paymentStatus}</Badge>}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={meta.tone}>
                            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} />
                            {meta.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-1.5">
                            <Badge tone={level === "High" ? "danger" : level === "Medium" ? "warning" : "success"}>
                              {level === "High" ? "বেশি ঝুঁকি" : level === "Medium" ? "মাঝারি ঝুঁকি" : "কম ঝুঁকি"}
                            </Badge>
                            <span className="font-mono text-caption tabular-nums text-text-muted">{o.riskScore}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-text-muted">{o.courier ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {STATUSES.filter((s) => s !== "ALL").map((status) => {
                const meta = STATUS_META[status] ?? { label: status, tone: "neutral" as const, dot: "#94A3B8" };
                const column = allOrders.filter((o) => o.status === status);
                return (
                  <section key={status} className="flex w-[264px] shrink-0 flex-col rounded-lg border border-border bg-surface-2/60 shadow-card">
                    <header className="flex items-center gap-2 px-3.5 pb-1 pt-3.5">
                      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: meta.dot }} />
                      <h3 className="text-small font-semibold">{meta.label}</h3>
                      <span className="ml-auto rounded-full bg-card px-2 py-0.5 font-mono text-caption font-semibold tabular-nums text-text-muted">
                        {column.length}
                      </span>
                    </header>
                    <div className="space-y-2 overflow-y-auto px-2.5 pb-3 pt-1.5" style={{ maxHeight: "60vh" }}>
                      {column.length === 0 ? (
                        <p className="px-1.5 py-2 text-caption text-text-subtle">এখানে কোনো অর্ডার নেই</p>
                      ) : column.map((o) => (
                        <article key={o.id} className="rounded-md border border-border bg-card p-3 shadow-sm transition motion-fast hover:shadow-md">
                          <a href={`/admin/orders/${o.id}`} className="font-mono text-small font-semibold text-brand-700 hover:underline">
                            {o.orderNo}
                          </a>
                          <p className="mt-1 truncate text-small font-medium leading-snug">{o.customerName}</p>
                          <p className="text-caption text-text-muted">{displayPhone(o.customerPhone, false)}</p>
                          <p className="mt-2 flex items-center justify-between text-caption">
                            <span className="font-mono font-semibold tabular-nums text-text-main">{formatBdt(o.totalPoisha)}</span>
                            <span className="text-text-muted">{PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod}</span>
                          </p>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-caption leading-relaxed text-text-subtle">
            বাল্ক কাজ: টেবিল ভিউতে অর্ডার সিলেক্ট করে উপরের বাল্ক বার থেকে কনফার্ম / লেবেল প্রিন্ট / কুরিয়ার বুকিং পাঠানো যায় — আসল জব তৈরি হয়, প্রতি-অর্ডারের ফলাফল Jobs API থেকে দেখানো হয়। কানবান ভিউতে বাল্ক সিলেকশন নেই।
          </p>
        </>
      )}

      {/* Manual order — validation-only until the admin create API exists */}
      <Card className="mt-8 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-h3">ম্যানুয়াল অর্ডার</h2>
            <p className="mt-0.5 text-small text-text-muted">লক্ষ্য: ৩০ সেকেন্ডে অর্ডার নেওয়া। ধাপ: {MANUAL_ORDER_STEPS.join(" → ")}</p>
          </div>
          <Badge tone="warning">শুধু যাচাই — API গ্যাপ</Badge>
        </div>
        <p className="mt-3 rounded-md bg-amber-50 px-3.5 py-2.5 text-small leading-relaxed text-amber-800">
          এই ফর্মটি শুধু তথ্য যাচাই করে — অ্যাডমিন ম্যানুয়াল-ক্রিয়েট API এখনো তৈরি হয়নি, তাই সাবমিটে কোনো অর্ডার তৈরি হবে না।
        </p>
        <form onSubmit={onManualSubmit} className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div><label className={labelCls} htmlFor="mo-phone">ফোন</label><input id="mo-phone" name="phone" placeholder="01XXXXXXXXX" required className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="mo-name">গ্রাহকের নাম</label><input id="mo-name" name="customerName" placeholder="নাম" required className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="mo-division">বিভাগ</label><input id="mo-division" name="division" placeholder="বিভাগ" required className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="mo-district">জেলা</label><input id="mo-district" name="district" placeholder="জেলা" required className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="mo-upazila">উপজেলা</label><input id="mo-upazila" name="upazila" placeholder="উপজেলা" required className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="mo-address">পুরো ঠিকানা</label><input id="mo-address" name="addressLine" placeholder="ঠিকানা" required className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="mo-variant">ভ্যারিয়েন্ট ID</label><input id="mo-variant" name="variantId" placeholder="Variant ID" required className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="mo-qty">পরিমাণ</label><input id="mo-qty" name="quantity" type="number" defaultValue={1} min={1} className={inputCls} /></div>
          <div><label className={labelCls} htmlFor="mo-price">একক দাম (পয়সা, পূর্ণসংখ্যা)</label><input id="mo-price" name="unitPricePoisha" type="number" placeholder="Poisha" required className={inputCls} /></div>
          <div>
            <label className={labelCls} htmlFor="mo-pay">পেমেন্ট</label>
            <select id="mo-pay" name="paymentMethod" defaultValue="cod" className={inputCls}>
              <option value="cod">ক্যাশ অন ডেলিভারি</option><option value="bkash">বিকাশ</option><option value="nagad">নগদ</option>
            </select>
          </div>
          <div><label className={labelCls} htmlFor="mo-note">নোট (ঐচ্ছিক)</label><input id="mo-note" name="note" placeholder="নোট" className={inputCls} /></div>
          <div className="flex items-end">
            <Button type="submit" variant="primary" className="w-full">ম্যানুয়াল অর্ডার যাচাই করুন</Button>
          </div>
        </form>
        {manualResult && (
          <p role="status" className="mt-4 rounded-md bg-surface-2 px-3.5 py-2.5 text-small leading-relaxed">
            {manualResult}
          </p>
        )}
      </Card>
    </main>
  );
}

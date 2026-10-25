"use client";

// Admin order list + kanban — REAL data from GET /api/v1/admin/orders
// (Prisma-backed; phone masked server-side for viewers without
// customers.view_full_phone).
//
// LIST V2 (doc 17, batch O6-2): TRUE server pagination. The old page
// loaded the first 100 orders and filtered / searched / counted them
// in the browser, so every count was wrong beyond 100 rows. Now the
// page sends page / pageSize (default 25) / status / q / sort to the
// API; the chips read meta.counts (SQL aggregates over the set
// filtered by everything EXCEPT status, so they stay meaningful
// while a status is selected) and the pager reads meta.total (the
// full filtered count). Nothing is filtered client-side any more.
// The kanban shows the CURRENT PAGE's rows only and says so. Bulk
// selection (a Set of ids) PERSISTS across page changes on purpose —
// staff collect orders page by page, then bulk-act or print them
// together. An empty result shows an honest empty state, never
// sample rows. Bulk actions go through the BulkActionBar
// (real job pipeline, per-order results from the Jobs API). The manual
// order builder below (ManualOrderBuilder, doc 17 batch O2) validates
// with manualOrderSchema v2 and POSTs to the admin create endpoint
// (POST /api/v1/admin/orders without an `action` field), which
// persists through the same repository path as public checkout (DB
// snapshots, fraud scoring, coupon evaluation, shipping charge, one
// transaction, source "manual"); on success the list reloads so the
// order appears, on failure the server's message is shown in the form.
//
// Presentation (Design Refresh R3): Tailwind table system — sticky
// header, status pills, payment/risk badges, filter chips with real
// counts, designed empty/loading states. Data flow unchanged.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Order, OrderStatus } from "../../../src/orders/types";
import { MANUAL_ORDER_STEPS } from "../../../src/orders/manual-order";
import { displayPhone, riskLevel } from "../../../src/orders/customer";
import { formatBdt } from "../../../src/checkout/pricing";
import { BulkActionBar } from "../../../src/orders/components/BulkActionBar";
import { ManualOrderBuilder } from "./manual-order-builder";
import { OrderImportCard } from "./order-import-card";
import { StaleUnpaidPanel } from "./stale-unpaid-panel";
import { AgingPanel } from "./aging-panel";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaymentBadge, type PaymentStatus as UiPaymentStatus } from "@/components/ui/status-badge";
import {
  ColumnPicker,
  SavedViewsBar,
  TABLE_PREFS_NOTE,
  useHiddenColumns,
  useSavedViews,
  type SavedView,
} from "../../../src/admin/table-prefs";

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

/* Table v2 remainder: saved views capture the status filter + search +
 * sort below; column visibility covers every desktop-table column
 * except the order number itself (the row's identity). Both persist
 * per staff user in localStorage (see src/admin/table-prefs.tsx). */
type OrderSort = { key: "date" | "total" | "status"; dir: "asc" | "desc" };
interface OrderViewState {
  filter: string;
  search: string;
  sort: OrderSort | null;
}
const ORDER_PICKER_COLUMNS = [
  { key: "customer", label: "গ্রাহক" },
  { key: "total", label: "মোট" },
  { key: "payment", label: "পেমেন্ট" },
  { key: "status", label: "স্ট্যাটাস" },
  { key: "risk", label: "ঝুঁকি" },
  { key: "courier", label: "কুরিয়ার" },
] as const;
const ORDER_HIDEABLE_KEYS = ORDER_PICKER_COLUMNS.map((c) => c.key);

/** Sortable column header (table v2): click toggles direction; the
 *  chevron points up for ascending, down for descending, and stays
 *  faint while the column is not the active sort. */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: "date" | "total" | "status";
  sort: { key: "date" | "total" | "status"; dir: "asc" | "desc" } | null;
  onSort: (key: "date" | "total" | "status") => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
      className="px-4 py-3 text-caption font-semibold text-text-muted"
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={`${label} অনুযায়ী সাজান`}
        className={`flex items-center gap-1 transition motion-fast hover:text-brand-700 ${active ? "text-brand-700" : ""}`}
      >
        {label}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-3.5 w-3.5 ${active ? "" : "opacity-40"} ${active && sort.dir === "asc" ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </th>
  );
}

/** Map the table's sort state to the list API's `sort` param
 *  (src/orders/list-v2 ORDER_LIST_SORTS). null = the API default,
 *  newest first. */
function apiSortParam(sort: OrderSort | null): string {
  if (!sort) return "createdAt_desc";
  if (sort.key === "date") return sort.dir === "asc" ? "createdAt_asc" : "createdAt_desc";
  if (sort.key === "total") return sort.dir === "asc" ? "totalPoisha_asc" : "totalPoisha_desc";
  return sort.dir === "asc" ? "status_asc" : "status_desc";
}

export default function AdminOrdersPage() {
  /* List v2: pageOrders is ONLY the current page's rows — the server
   * owns filtering, searching, counting and sorting now. */
  const [pageOrders, setPageOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [fetching, setFetching] = useState(false);
  const [filter, setFilter] = useState<"ALL" | OrderStatus>("ALL");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [view, setView] = useState<"table" | "kanban">("table");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  /* Sort state (date / total / status) is kept in the table's own
   * shape for the saved views, and mapped to the API sort param by
   * apiSortParam — sorting happens on the server. null = API default
   * (newest first). Density stays a pure display toggle. */
  const [sort, setSort] = useState<{ key: "date" | "total" | "status"; dir: "asc" | "desc" } | null>(null);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const orderViews = useSavedViews<OrderViewState>("orders");
  const orderCols = useHiddenColumns("orders", ORDER_HIDEABLE_KEYS);
  /* Bulk selection: ids PERSIST across page changes by design —
   * staff collect orders from several pages, then bulk-act / print. */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /* The server query, mirrored into a ref so `load` stays a stable
   * () => Promise<void> for the refresh button / bulk bar / builders
   * while the effect below refetches whenever any part changes. */
  const queryRef = useRef({ filter, search: "", sort, page: 1, pageSize: 25 });
  queryRef.current = { filter, search: debouncedSearch, sort, page, pageSize };
  const requestSeq = useRef(0);
  const readyRef = useRef(false);

  const load = useCallback(async () => {
    const q = queryRef.current;
    const seq = ++requestSeq.current;
    // First load (or retry after an error) takes the full loading /
    // error states; a refetch while ready keeps the rows on screen
    // and only flags `fetching` (the pager shows a hint).
    if (readyRef.current) setFetching(true);
    else setLoadState("loading");
    try {
      const params = new URLSearchParams({
        page: String(q.page),
        pageSize: String(q.pageSize),
        sort: apiSortParam(q.sort),
      });
      if (q.filter !== "ALL") params.set("status", q.filter);
      if (q.search.trim()) params.set("q", q.search.trim());
      const res = await fetch(`/api/v1/admin/orders?${params.toString()}`);
      const body = (await res.json().catch(() => null)) as
        | { data?: Order[]; meta?: { total?: number; counts?: Record<string, number> }; error?: { code: string; message: string } }
        | null;
      if (seq !== requestSeq.current) return; // a newer fetch owns the screen
      if (res.ok && body && "data" in body && body.data) {
        setPageOrders(body.data);
        setTotal(body.meta?.total ?? body.data.length);
        if (body.meta?.counts) setCounts(body.meta.counts);
        readyRef.current = true;
        setLoadState("ready");
        setLoadError("");
      } else {
        const message =
          body && "error" in body && body.error
            ? `${body.error.code}: ${body.error.message}`
            : `HTTP ${res.status}`;
        setLoadError(message);
        if (!readyRef.current) setLoadState("error");
      }
    } catch {
      if (seq !== requestSeq.current) return;
      setLoadError("নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি।");
      if (!readyRef.current) setLoadState("error");
    } finally {
      if (seq === requestSeq.current) setFetching(false);
    }
  }, []);

  /* Debounce the search box into the value the server sees. */
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  /* Refetch whenever the server query changes. */
  useEffect(() => {
    void load();
  }, [load, filter, debouncedSearch, sort, page, pageSize]);

  /* If the result set shrank under the current page (e.g. after bulk
   * actions), step back to the last page that exists. */
  useEffect(() => {
    if (loadState === "ready" && page > totalPages) setPage(totalPages);
  }, [loadState, page, totalPages]);

  useEffect(() => {
    // Initial filter from the URL (command-palette natural-language links
    // land here with ?status= / ?q= / ?district=). Setting state is all
    // it takes — the query effect above refetches; the server search
    // covers order number / name / district / phone.
    const params = new URLSearchParams(window.location.search);
    const statusParam = params.get("status");
    if (statusParam && (STATUSES as string[]).includes(statusParam)) {
      setFilter(statusParam as OrderStatus);
    }
    const q = params.get("q") ?? params.get("search");
    if (q) setSearch(q);
  }, []);

  /* List v2: `orders` IS the current page. Filtering, searching,
   * counting and sorting all happened on the server — no client-side
   * filtering remains to drift out of sync with the chips/pager. */
  const orders = pageOrders;

  function toggleSort(key: "date" | "total" | "status") {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: key === "status" ? "asc" : "desc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
    setPage(1);
  }

  function applyOrderView(view: SavedView<OrderViewState>) {
    const s = view.state;
    if (s && (STATUSES as string[]).includes(s.filter)) {
      setFilter(s.filter as "ALL" | OrderStatus);
    }
    setSearch(typeof s?.search === "string" ? s.search : "");
    const savedSort = s?.sort;
    setSort(
      savedSort && (["date", "total", "status"] as string[]).includes(savedSort.key)
        ? { key: savedSort.key, dir: savedSort.dir === "asc" ? "asc" : "desc" }
        : null,
    );
    setPage(1);
  }

  /* Chip counts come from meta.counts — SQL aggregates over the set
   * filtered by everything EXCEPT the status param (see the API), so
   * a chip shows what switching to that status would yield under the
   * current search. Undefined until the first response lands. */
  const countFor = useCallback(
    (s: "ALL" | OrderStatus): number | undefined => counts?.[s],
    [counts],
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

      <StaleUnpaidPanel />
      <AgingPanel />

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
              {view === "table" ? (
                <div className="flex rounded-md bg-surface-2 p-1" role="group" aria-label="টেবিলের ঘনত্ব">
                  {(["comfortable", "compact"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDensity(d)}
                      aria-pressed={density === d}
                      className={`min-h-[36px] rounded-[9px] px-3 text-small font-semibold transition motion-fast ${
                        density === d ? "bg-card text-brand-700 shadow-sm" : "text-text-muted hover:text-text-main"
                      }`}
                    >
                      {d === "comfortable" ? "স্বাভাবিক" : "ঘন"}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {STATUSES.map((s) => {
                const meta = STATUS_META[s] ?? { label: s, tone: "neutral" as const, dot: "#94A3B8" };
                const active = filter === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => { setFilter(s); setPage(1); }}
                    aria-pressed={active}
                    className={`flex min-h-[32px] items-center gap-1.5 rounded-full px-3 text-caption font-semibold transition motion-fast ${
                      active ? "bg-brand-600 text-white shadow-sm" : "border border-border bg-card text-text-muted hover:border-brand-300 hover:text-brand-700"
                    }`}
                  >
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: active ? "#fff" : meta.dot }} />
                    {meta.label}
                    <span className={`font-mono tabular-nums ${active ? "text-white/85" : "text-text-subtle"}`}>{countFor(s) ?? "—"}</span>
                  </button>
                );
              })}
              <span className="ml-auto text-caption text-text-muted">
                এই পেজে {orders.length}টি · ফিল্টার অনুযায়ী মোট {total}টি · পেজ {page}/{totalPages}
              </span>
            </div>
            {/* Table v2: saved views + column visibility (table view only
             *  for columns; views also make sense from kanban, so the bar
             *  itself is always shown). */}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3">
              <SavedViewsBar<OrderViewState>
                views={orderViews.views}
                ready={orderViews.ready}
                currentState={{ filter, search, sort }}
                onApply={applyOrderView}
                onSave={orderViews.saveView}
                onDelete={orderViews.deleteView}
              />
              {view === "table" ? (
                <span className="ml-auto">
                  <ColumnPicker
                    columns={ORDER_PICKER_COLUMNS}
                    hidden={orderCols.hidden}
                    onToggle={orderCols.toggleColumn}
                    ready={orderCols.ready}
                  />
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-caption leading-relaxed text-text-subtle">{TABLE_PREFS_NOTE}</p>
          </Card>

          {/* A failed REFETCH (rows already on screen) surfaces here
           *  instead of replacing the list with the error state. */}
          {loadError ? (
            <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-small text-rose-700">
              তালিকা রিফ্রেশ হয়নি: {loadError}
              <button type="button" onClick={() => void load()} className="ml-3 font-semibold underline">
                আবার চেষ্টা করুন
              </button>
            </div>
          ) : null}

          {/* Print centre entry (doc 17 O6-2): the selected orders as
           *  printable invoices in a new tab. Selection persists
           *  across pages, so the ids may span several pages. */}
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <a
              href={selected.size > 0 ? `/admin/orders/print?ids=${selectedIds.join(",")}` : undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={selected.size === 0}
              onClick={(e) => {
                if (selected.size === 0) e.preventDefault();
              }}
              className={`rounded-md px-3.5 py-2 text-small font-semibold transition motion-fast ${
                selected.size > 0
                  ? "bg-brand-600 text-white shadow-sm hover:bg-brand-700"
                  : "cursor-not-allowed border border-border bg-card text-text-subtle"
              }`}
            >
              ইনভয়েস প্রিন্ট / Print invoices
            </a>
            <span className="text-caption text-text-muted">
              {selected.size > 0
                ? `${selected.size}টি সিলেক্ট করা অর্ডারের ইনভয়েস নতুন ট্যাবে খুলবে`
                : "ইনভয়েস ছাপতে আগে তালিকা থেকে অর্ডার সিলেক্ট করুন"}
            </span>
          </div>

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
                  onClick={() => { setFilter("ALL"); setSearch(""); setPage(1); }}
                >
                  ফিল্টার মুছে ফেলুন
                </Button>
              ) : null}
            </div>
          ) : view === "table" ? (
            <>
            {/* Desktop table — hidden under md, where the card list below
             *  takes over so a 360px screen never scrolls sideways. */}
            <div className="hidden overflow-auto rounded-lg border border-border bg-card shadow-card md:block" style={{ maxHeight: "72vh" }}>
              <table className={`w-full min-w-[860px] border-collapse text-sm ${density === "compact" ? "[&_td]:py-1.5 [&_th]:py-2" : ""}`}>
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
                    <SortHeader label="অর্ডার" sortKey="date" sort={sort} onSort={toggleSort} />
                    {orderCols.isVisible("customer") ? (
                      <th scope="col" className="px-4 py-3 text-caption font-semibold text-text-muted">গ্রাহক</th>
                    ) : null}
                    {orderCols.isVisible("total") ? (
                      <SortHeader label="মোট" sortKey="total" sort={sort} onSort={toggleSort} />
                    ) : null}
                    {orderCols.isVisible("payment") ? (
                      <th scope="col" className="px-4 py-3 text-caption font-semibold text-text-muted">পেমেন্ট</th>
                    ) : null}
                    {orderCols.isVisible("status") ? (
                      <SortHeader label="স্ট্যাটাস" sortKey="status" sort={sort} onSort={toggleSort} />
                    ) : null}
                    {orderCols.isVisible("risk") ? (
                      <th scope="col" className="px-4 py-3 text-caption font-semibold text-text-muted">ঝুঁকি</th>
                    ) : null}
                    {orderCols.isVisible("courier") ? (
                      <th scope="col" className="px-4 py-3 text-caption font-semibold text-text-muted">কুরিয়ার</th>
                    ) : null}
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
                        {orderCols.isVisible("customer") ? (
                          <td className="px-4 py-3">
                            <span className="block font-medium leading-snug">{o.customerName}</span>
                            <span className="block text-caption text-text-muted">{displayPhone(o.customerPhone, false)}</span>
                          </td>
                        ) : null}
                        {orderCols.isVisible("total") ? (
                          <td className="px-4 py-3 font-mono font-semibold tabular-nums">{formatBdt(o.totalPoisha)}</td>
                        ) : null}
                        {orderCols.isVisible("payment") ? (
                          <td className="px-4 py-3">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <Badge tone="neutral">{PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod}</Badge>
                              {UI_PAYMENT_STATUSES.includes(o.paymentStatus)
                                ? <PaymentBadge status={o.paymentStatus as UiPaymentStatus} />
                                : <Badge tone="neutral">{o.paymentStatus}</Badge>}
                            </span>
                          </td>
                        ) : null}
                        {orderCols.isVisible("status") ? (
                          <td className="px-4 py-3">
                            <Badge tone={meta.tone}>
                              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} />
                              {meta.label}
                            </Badge>
                          </td>
                        ) : null}
                        {orderCols.isVisible("risk") ? (
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-1.5">
                              <Badge tone={level === "High" ? "danger" : level === "Medium" ? "warning" : "success"}>
                                {level === "High" ? "বেশি ঝুঁকি" : level === "Medium" ? "মাঝারি ঝুঁকি" : "কম ঝুঁকি"}
                              </Badge>
                              <span className="font-mono text-caption tabular-nums text-text-muted">{o.riskScore}</span>
                            </span>
                          </td>
                        ) : null}
                        {orderCols.isVisible("courier") ? (
                          <td className="px-4 py-3 text-text-muted">{o.courier ?? "—"}</td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile card list (under md) — same rows, same selection;
             *  no horizontal scrolling on narrow screens. */}
            <div className="space-y-3 md:hidden">
              {orders.map((o) => {
                const meta = STATUS_META[o.status] ?? { label: o.status, tone: "neutral" as const, dot: "#94A3B8" };
                const level = riskLevel(o.riskScore);
                return (
                  <article key={o.id} className={`rounded-lg border border-border bg-card p-4 shadow-card ${selected.has(o.id) ? "ring-1 ring-brand-300" : ""}`}>
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => toggleSelected(o.id)}
                        aria-label={`${o.orderNo} সিলেক্ট করুন`}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[#4F46E5]"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <a href={`/admin/orders/${o.id}`} className="font-mono text-small font-semibold text-brand-700 hover:underline">
                            {o.orderNo}
                          </a>
                          <Badge tone={meta.tone}>
                            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} />
                            {meta.label}
                          </Badge>
                        </div>
                        <p className="mt-1.5 truncate text-small font-medium leading-snug">{o.customerName}</p>
                        <p className="text-caption text-text-muted">
                          {displayPhone(o.customerPhone, false)} · {o.address.district}, {o.address.division}
                        </p>
                        <div className="mt-2.5 flex items-center gap-2 border-t border-border pt-2.5">
                          <span className="font-mono text-small font-bold tabular-nums">{formatBdt(o.totalPoisha)}</span>
                          <Badge tone="neutral">{PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod}</Badge>
                          <Badge tone={level === "High" ? "danger" : level === "Medium" ? "warning" : "success"}>
                            {level === "High" ? "বেশি ঝুঁকি" : level === "Medium" ? "মাঝারি ঝুঁকি" : "কম ঝুঁকি"}
                          </Badge>
                          <a
                            href={`/admin/orders/${o.id}`}
                            aria-label={`${o.orderNo} বিস্তারিত দেখুন`}
                            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-text-muted transition motion-fast hover:bg-brand-50 hover:text-brand-700"
                          >
                            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                              <path d="m9 18 6-6-6-6" />
                            </svg>
                          </a>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            </>
          ) : (
            <>
            {/* List v2 honesty: the board renders the CURRENT PAGE's
             *  rows (server-filtered), not the whole dataset — the
             *  column counts are this page's counts. */}
            <p className="mb-3 text-caption leading-relaxed text-text-muted">
              কানবান বোর্ডটি শুধু এই পেজের {orders.length}টি অর্ডার দেখায় (ফিল্টার অনুযায়ী মোট {total}টি) — কলামের সংখ্যা পুরো ডেটাসেটের হিসাব নয়।
            </p>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {STATUSES.filter((s) => s !== "ALL").map((status) => {
                const meta = STATUS_META[status] ?? { label: status, tone: "neutral" as const, dot: "#94A3B8" };
                const column = pageOrders.filter((o) => o.status === status);
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
            </>
          )}

          {/* Pager (list v2) — meta.total is the FULL filtered count,
           *  so page N of M is true at any dataset size. */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <p className="text-small text-text-muted">
              মোট <span className="font-semibold text-text-main">{total}</span>টি অর্ডার · পেজ {page} / {totalPages}
              {fetching ? <span className="ml-2 text-text-subtle">লোড হচ্ছে…</span> : null}
            </p>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className="text-caption text-text-muted" htmlFor="orders-page-size">প্রতি পেজে</label>
              <select
                id="orders-page-size"
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-small outline-none focus:border-brand-500"
              >
                {[25, 50, 100].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || fetching}>
                ← আগের পেজ
              </Button>
              <Button variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || fetching}>
                পরের পেজ →
              </Button>
            </div>
          </div>

          <p className="mt-3 text-caption leading-relaxed text-text-subtle">
            বাল্ক কাজ: টেবিল ভিউতে অর্ডার সিলেক্ট করে উপরের বাল্ক বার থেকে কনফার্ম / লেবেল প্রিন্ট / কুরিয়ার বুকিং পাঠানো যায় — আসল জব তৈরি হয়, প্রতি-অর্ডারের ফলাফল Jobs API থেকে দেখানো হয়। কানবান ভিউতে বাল্ক সিলেকশন নেই।
          </p>
        </>
      )}

      {/* Manual order — posts to the admin create endpoint */}
      <Card className="mt-8 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-h3">ম্যানুয়াল অর্ডার</h2>
            <p className="mt-0.5 text-small text-text-muted">লক্ষ্য: ৩০ সেকেন্ডে অর্ডার নেওয়া। ধাপ: {MANUAL_ORDER_STEPS.join(" → ")}</p>
          </div>
        </div>
        <p className="mt-3 rounded-md bg-surface-2 px-3.5 py-2.5 text-small leading-relaxed text-text-muted">
          সাবমিটে আসল অর্ডার তৈরি হয় — পণ্যের নাম, SKU ও স্টক ডাটাবেস থেকে যাচাই হয়, ফ্রড স্কোরিং চলে এবং অর্ডারটি ওয়েবসাইট অর্ডারের মতোই সংরক্ষিত হয় (সোর্স: ম্যানুয়াল)। একক দাম কর্মী দিতে পারেন; ক্যাটালগ দাম থেকে ভিন্ন হলে তা অর্ডার নোটে লেখা থাকে। ডেলিভারি চার্জ ওয়েবসাইটের হারেই ধরা হয় (নিজে বসানোর সুযোগ আছে) এবং কুপন কোড ওয়েবসাইটের নিয়মেই যাচাই হয়।
        </p>
        <ManualOrderBuilder onCreated={load} />
      </Card>

      {/* CSV bulk order import (doc 17 O4) — per-group results render
       *  inside the card; a successful import reloads the list. */}
      <OrderImportCard onImported={load} />
    </main>
  );
}

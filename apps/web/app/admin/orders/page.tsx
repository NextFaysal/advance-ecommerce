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
import { OrderStatusBadge } from "../../../src/orders/components/OrderStatusBadge";
import { WorkflowStageChip } from "../../../src/orders/components/WorkflowStageChip";
import type { WorkflowStageTone } from "../../../src/orders/stages";
import { ORDER_STATUS_VISUAL } from "../../../src/orders/components/labels";
import { ORDER_DENSITY } from "../../../src/orders/components/density";
import { OrderPreviewDrawer } from "./order-preview";
import { MergeAction } from "./merge-action";
import {
  funnelChips,
  itemsSummaryLabel,
  orderAgeLabel,
} from "./list-helpers";
import { ManualOrderBuilder } from "./manual-order-builder";
import { OrderImportCard } from "./order-import-card";
import { StaleUnpaidPanel } from "./stale-unpaid-panel";
import { AgingPanel } from "./aging-panel";
import { KpiPanel } from "./kpi-panel";
import { PosSalesPanel } from "./pos-sales-panel";
import { DraftsPanel } from "./drafts-panel";
import { PageHeader } from "@/admin-shell/PageHeader";
import { DataTableSkeleton } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaymentBadge, type PaymentStatus as UiPaymentStatus } from "@/components/ui/status-badge";
import {
  ColumnPicker,
  SavedViewsBar,
  useHiddenColumns,
  useSavedViews,
  type SavedView,
} from "../../../src/admin/table-prefs";
import { interpolate, pick, type Locale } from "../../../src/i18n/locale";
import { useLocale } from "../../../src/i18n/LocaleProvider";
import { ADMIN_STRINGS } from "@/admin/strings";
import { ORDER_STRINGS } from "./strings";

const STATUSES: ("ALL" | OrderStatus)[] = [
  "ALL", "INCOMPLETE", "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED",
  "DELIVERED", "FAILED", "RETURN_REQUESTED", "RETURNING", "RETURNED",
  "CANCELLED", "REFUNDED", "EXCHANGED",
];

/* OD1 (doc 19): the page's private STATUS_META map is gone — status
 *  language now comes from the OD0 design-system contract
 *  (ORDER_STATUS_VISUAL + OrderStatusBadge in src/orders/components),
 *  so the list, kanban, preview and detail all render one language. */

const PAYMENT_METHOD_LABEL: Record<string, Record<Locale, string>> = {
  cod: { bn: "ক্যাশ অন ডেলিভারি", en: "Cash on Delivery" },
  bkash: { bn: "বিকাশ", en: "bKash" },
  nagad: { bn: "নগদ", en: "Nagad" },
  rocket: { bn: "রকেট", en: "Rocket" },
  card: { bn: "কার্ড", en: "Card" },
  sslcommerz: { bn: "SSLCommerz", en: "SSLCommerz" },
};

function paymentMethodLabel(method: string, locale: Locale): string {
  const entry = PAYMENT_METHOD_LABEL[method];
  return entry ? pick(locale, entry) : method;
}

/** Bangla for the manual-order step names — MANUAL_ORDER_STEPS itself
 *  lives in src/orders/manual-order (English consts); only the display
 *  is localized here. Unknown future steps fall back to the raw text. */
const MANUAL_STEP_BN: Record<string, string> = {
  "Customer lookup (phone)": "গ্রাহক খোঁজা (ফোন)",
  "Add items": "পণ্য যোগ",
  Address: "ঠিকানা",
  "Payment method": "পেমেন্ট পদ্ধতি",
  Confirm: "নিশ্চিত করা",
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
const ORDER_PICKER_COLUMN_KEYS = ["customer", "total", "payment", "status", "risk", "courier"] as const;
const ORDER_HIDEABLE_KEYS: readonly string[] = ORDER_PICKER_COLUMN_KEYS;

/** Sortable column header (table v2): click toggles direction; the
 *  chevron points up for ascending, down for descending, and stays
 *  faint while the column is not the active sort. */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  cellClassName,
}: {
  label: string;
  sortKey: "date" | "total" | "status";
  sort: { key: "date" | "total" | "status"; dir: "asc" | "desc" } | null;
  onSort: (key: "date" | "total" | "status") => void;
  /** OD0 density token (ORDER_DENSITY[density].headerCell). */
  cellClassName: string;
}) {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const active = sort?.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
      className={`${cellClassName} text-caption font-semibold text-text-muted`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={interpolate(s.lpSortBy, { label })}
        className={`flex items-center gap-1 transition duration-fast ease-smooth hover:text-brand-700 ${active ? "text-brand-700" : ""} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300`}
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

/** OD1 preview guard: a row click opens the slide-over ONLY when it
 *  did not land on an interactive descendant (the order-no link, the
 *  selection checkbox, a button) — those keep their own behaviour. */
function isPlainRowClick(e: { target: EventTarget | null }): boolean {
  const t = e.target as HTMLElement | null;
  return !t?.closest("a, input, button, select, textarea, label");
}

/* ADV-26 (BUILD-LITE): workflow stages. Definitions arrive in the
 * list response meta (only while module.workflow_stages is ON); a
 * row's stage rides its tags as `stage:<id>` — the prefix mirrors
 * STAGE_TAG_PREFIX in src/orders/stages.ts (that module is
 * server-only, so the constant is restated here, not imported). */
interface WorkflowStageDef {
  id: string;
  labelBn: string;
  labelEn: string;
  anchorStatus: OrderStatus;
  color?: WorkflowStageTone;
  sortOrder: number;
}

function stageChipOf(
  order: Order,
  defs: readonly WorkflowStageDef[],
  locale: Locale,
): { label: string; tone: WorkflowStageTone } | null {
  if (defs.length === 0) return null;
  const tag = order.tags.find((t) => t.startsWith("stage:"));
  if (!tag) return null;
  const id = tag.slice("stage:".length);
  const def = defs.find((d) => d.id === id);
  return {
    label: def ? (locale === "bn" ? def.labelBn : def.labelEn) : id,
    tone: def?.color ?? "neutral",
  };
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
  const { locale, t } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const pickerColumns = [
    { key: "customer", label: s.colCustomer },
    { key: "total", label: t.total },
    { key: "payment", label: s.colPayment },
    { key: "status", label: s.colStatus },
    { key: "risk", label: s.colRisk },
    { key: "courier", label: s.colCourier },
  ];
  /* List v2: pageOrders is ONLY the current page's rows — the server
   * owns filtering, searching, counting and sorting now. */
  const [pageOrders, setPageOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [fetching, setFetching] = useState(false);
  const [filter, setFilter] = useState<"ALL" | OrderStatus>("ALL");
  /* ADV-26 (BUILD-LITE): workflow-stage filter + definitions. The
   * defs arrive in the list response meta (present only while
   * module.workflow_stages is ON); "" = no stage filter. */
  const [stageFilter, setStageFilter] = useState("");
  const [stageDefs, setStageDefs] = useState<WorkflowStageDef[]>([]);
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
  /* OD1 slide-over preview: the id of the order shown in the drawer,
   * null = closed. The drawer fetches the detail payload itself. */
  const [previewId, setPreviewId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  /* The server query, mirrored into a ref so `load` stays a stable
   * () => Promise<void> for the refresh button / bulk bar / builders
   * while the effect below refetches whenever any part changes. */
  const queryRef = useRef({ filter, search: "", sort, page: 1, pageSize: 25, stage: "" });
  queryRef.current = { filter, search: debouncedSearch, sort, page, pageSize, stage: stageFilter };
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
      if (q.stage) params.set("stage", q.stage);
      if (q.search.trim()) params.set("q", q.search.trim());
      const res = await fetch(`/api/v1/admin/orders?${params.toString()}`);
      const body = (await res.json().catch(() => null)) as
        | { data?: Order[]; meta?: { total?: number; counts?: Record<string, number>; workflowStages?: WorkflowStageDef[] }; error?: { code: string; message: string } }
        | null;
      if (seq !== requestSeq.current) return; // a newer fetch owns the screen
      if (res.ok && body && "data" in body && body.data) {
        setPageOrders(body.data);
        setTotal(body.meta?.total ?? body.data.length);
        if (body.meta?.counts) setCounts(body.meta.counts);
        setStageDefs(body.meta?.workflowStages ?? []);
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
      setLoadError(pick(localeRef.current, ORDER_STRINGS).networkApi);
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
  }, [load, filter, debouncedSearch, sort, page, pageSize, stageFilter]);

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
   * current search. funnelChips (list-helpers) only orders/dims them;
   * undefined until the first response lands. */

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
        title={s.lpTitle}
        subtitle={s.lpDesc}
        actions={
          <Button variant="outline" onClick={() => void load()}>
            {s.lpRefresh}
          </Button>
        }
      />

      <StaleUnpaidPanel />
      <AgingPanel />
      <KpiPanel />
      {/* POS counter sales, read-only (doc 17 O9-2): reported here for
       *  the orders team; never converted into orders — POS stock
       *  already moved in the POS flow. */}
      <PosSalesPanel />

      {loadState === "loading" && (
        <div role="status" aria-label={s.ordLoadingAria}>
          <DataTableSkeleton columns={6} rows={5} />
          <p className="px-1 py-3 text-small text-text-muted">{s.ordLoading}</p>
        </div>
      )}

      {loadState === "error" && (
        <div role="alert" className="rounded-2xl border border-danger/25 bg-danger-soft p-5 shadow-xs">
          <p className="font-semibold text-danger">{s.ordLoadFailTitle}</p>
          <p className="mt-1 text-small text-danger">{loadError}</p>
          <Button variant="outline" className="mt-4 bg-card" onClick={() => void load()}>
            {s.tryAgain}
          </Button>
        </div>
      )}

      {loadState === "ready" && (
        <>
          {/* Filter bar — OD1 (doc 19): search is the HERO control
           *  (full-width, taller); view/density toggles move to their
           *  own control row with the page summary; the status chips
           *  below become the funnel strip. */}
          <Card className="mb-4">
            <div className="relative">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-text-subtle">
                <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={s.lpSearchPlaceholder}
                aria-label={s.lpSearchAria}
                className="h-12 w-full rounded-xl border border-border bg-card pl-11 pr-3 text-base shadow-xs outline-none transition duration-base ease-smooth focus:border-brand-ink focus:ring-[3px] focus:ring-brand-ink/15"
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="flex rounded-xl bg-surface-2 p-1" role="group" aria-label={s.lpViewAria}>
                {(["table", "kanban"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    aria-pressed={view === v}
                    className={`min-h-[36px] rounded-lg px-3.5 text-small font-semibold transition duration-fast ease-smooth ${
                      view === v ? "bg-card text-brand-700 shadow-sm" : "text-text-muted hover:text-text-main"
                    } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300`}
                  >
                    {v === "table" ? s.lpViewTable : s.lpViewKanban}
                  </button>
                ))}
              </div>
              {view === "table" ? (
                <div className="flex rounded-xl bg-surface-2 p-1" role="group" aria-label={s.lpDensityAria}>
                  {(["comfortable", "compact"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDensity(d)}
                      aria-pressed={density === d}
                      className={`min-h-[36px] rounded-lg px-3 text-small font-semibold transition duration-fast ease-smooth ${
                        density === d ? "bg-card text-brand-700 shadow-sm" : "text-text-muted hover:text-text-main"
                      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300`}
                    >
                      {d === "comfortable" ? s.lpComfortable : s.lpCompact}
                    </button>
                  ))}
                </div>
              ) : null}
              <span className="ml-auto text-caption text-text-muted">
                {interpolate(s.lpPageSummary, { shown: orders.length, total, page, pages: totalPages })}
              </span>
            </div>
            {/* Funnel strip (OD1): ALL + the 13 statuses in lifecycle
             *  order. Counts come from meta.counts — the list-v2 SQL
             *  aggregates over the set filtered by everything EXCEPT
             *  status — passed through untouched. Explicit zeros are
             *  dimmed, never hidden. Language/icons: ORDER_STATUS_VISUAL. */}
            <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={s.lpStatusFilterAria}>
              {funnelChips(counts).map((chip) => {
                const active = filter === chip.status;
                if (chip.status === "ALL") {
                  return (
                    <button
                      key="ALL"
                      type="button"
                      onClick={() => { setFilter("ALL"); setPage(1); }}
                      aria-pressed={active}
                      className={`flex min-h-[32px] items-center gap-1.5 rounded-full px-3 text-caption font-semibold transition duration-fast ease-smooth ${
                        active ? "bg-brand-600 text-white shadow-sm" : "border border-border bg-card text-text-muted hover:border-brand-300 hover:text-brand-700"
                      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300`}
                    >
                      {s.lpAll}
                      <span className={`tnum ${active ? "text-white/85" : "text-text-subtle"}`}>{chip.count ?? "—"}</span>
                    </button>
                  );
                }
                const visual = ORDER_STATUS_VISUAL[chip.status];
                return (
                  <button
                    key={chip.status}
                    type="button"
                    onClick={() => { setFilter(chip.status); setPage(1); }}
                    aria-pressed={active}
                    className={`flex min-h-[32px] items-center gap-1.5 rounded-full px-3 text-caption font-semibold transition duration-fast ease-smooth ${
                      active
                        ? "bg-brand-600 text-white shadow-sm"
                        : `border border-border bg-card text-text-muted hover:border-brand-300 hover:text-brand-700 ${chip.dimmed ? "opacity-55 hover:opacity-100" : ""}`
                    } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300`}
                  >
                    <Icon name={visual.icon} size={12} className={active ? "text-white" : "text-text-subtle"} />
                    {locale === "bn" ? visual.labelBn : visual.labelEn}
                    <span className={`tnum ${active ? "text-white/85" : "text-text-subtle"}`}>{chip.count ?? "—"}</span>
                  </button>
                );
              })}
            </div>
            {/* ADV-26 (BUILD-LITE): workflow-stage filter — rendered
             *  only while the add-on is ON and stages are defined
             *  (defs arrive in the list meta). Server-side filter:
             *  the `stage` param matches the `stage:<id>` order tag
             *  in SQL, and the counts above honour it too. */}
            {stageDefs.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label htmlFor="orders-stage-filter" className="text-caption font-semibold text-text-muted">
                  {s.lpStageFilterLabel}
                </label>
                <select
                  id="orders-stage-filter"
                  value={stageFilter}
                  onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}
                  className="min-h-[36px] rounded-xl border border-border bg-card px-2.5 text-small font-medium text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                >
                  <option value="">{s.lpAllStages}</option>
                  {stageDefs.map((sd) => (
                    <option key={sd.id} value={sd.id}>
                      {locale === "bn" ? sd.labelBn : sd.labelEn} ({locale === "bn" ? ORDER_STATUS_VISUAL[sd.anchorStatus].labelBn : ORDER_STATUS_VISUAL[sd.anchorStatus].labelEn})
                    </option>
                  ))}
                </select>
                {stageFilter ? (
                  <button
                    type="button"
                    onClick={() => { setStageFilter(""); setPage(1); }}
                    className="text-caption font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                  >
                    {s.lpClearFilter}
                  </button>
                ) : null}
              </div>
            ) : null}
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
                    columns={pickerColumns}
                    hidden={orderCols.hidden}
                    onToggle={orderCols.toggleColumn}
                    ready={orderCols.ready}
                  />
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-caption leading-relaxed text-text-subtle">{pick(locale, ADMIN_STRINGS).tpStorageNote}</p>
          </Card>

          {/* A failed REFETCH (rows already on screen) surfaces here
           *  instead of replacing the list with the error state. */}
          {loadError ? (
            <div role="alert" className="mb-4 rounded-2xl border border-danger/25 bg-danger-soft px-4 py-3 text-small text-danger">
              {interpolate(s.lpRefreshFail, { error: loadError })}
              <button type="button" onClick={() => void load()} className="ml-3 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                {s.tryAgain}
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
              className={`rounded-xl px-3.5 py-2 text-small font-semibold transition duration-fast ease-smooth ${
                selected.size > 0
                  ? "bg-brand-600 text-white shadow-sm hover:bg-brand-700"
                  : "cursor-not-allowed border border-border bg-card text-text-subtle"
              }`}
            >
              {s.lpPrintInvoices}
            </a>
            <span className="text-caption text-text-muted">
              {selected.size > 0
                ? interpolate(s.lpPrintHintSelected, { n: selected.size })
                : s.lpPrintHintEmpty}
            </span>
          </div>

          {/* Bulk bar — renders itself only when orders are selected.
           *  OD1: on phones it docks to the bottom of the viewport
           *  while a selection exists, so bulk actions stay reachable
           *  mid-scroll; desktop keeps the in-flow position. The bar
           *  component and its job behaviour are unchanged. */}
          <div className={selected.size > 0 ? "mb-4 max-md:fixed max-md:inset-x-3 max-md:bottom-3 max-md:z-40" : "mb-4 empty:mb-0"}>
            <BulkActionBar selectedIds={selectedIds} onClear={() => setSelected(new Set())} onDone={() => void load()} />
            {/* ADV-19: order merge — renders only for an exact pair. */}
            {selected.size === 2 ? (
              <div className="mt-2 flex justify-end">
                <MergeAction
                  selectedIds={selectedIds}
                  knownOrders={pageOrders
                    .filter((o) => selected.has(o.id))
                    .map((o) => ({ id: o.id, orderNo: o.orderNo, createdAt: o.createdAt }))}
                  onClear={() => setSelected(new Set())}
                  onDone={() => void load()}
                />
              </div>
            ) : null}
          </div>

          {orders.length === 0 ? (
            <EmptyState
              title={s.lpEmptyTitle}
              description={
                filter !== "ALL" || search.trim() !== ""
                  ? s.lpEmptyFiltered
                  : s.lpEmptyNone
              }
            >
              {filter !== "ALL" || search.trim() !== "" ? (
                <div className="mt-5">
                  <Button
                    variant="outline"
                    onClick={() => { setFilter("ALL"); setSearch(""); setPage(1); }}
                  >
                    {s.lpClearFiltersBtn}
                  </Button>
                </div>
              ) : null}
            </EmptyState>
          ) : view === "table" ? (
            <>
            {/* Desktop table — hidden under md, where the card list below
             *  takes over so a 360px screen never scrolls sideways. */}
            <div className="hidden overflow-auto rounded-2xl border border-border/60 bg-card shadow-xs md:block" style={{ maxHeight: "72vh" }}>
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-surface-2 text-left [&>th]:border-b [&>th]:border-border">
                    <th scope="col" className={`w-11 ${ORDER_DENSITY[density].headerCell}`}>
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        aria-label={s.lpSelectAllAria}
                        className="h-4 w-4 rounded accent-brand-600"
                      />
                    </th>
                    <SortHeader label={s.colOrder} sortKey="date" sort={sort} onSort={toggleSort} cellClassName={ORDER_DENSITY[density].headerCell} />
                    {orderCols.isVisible("customer") ? (
                      <th scope="col" className={`${ORDER_DENSITY[density].headerCell} text-caption font-semibold text-text-muted`}>{s.colCustomer}</th>
                    ) : null}
                    {orderCols.isVisible("total") ? (
                      <SortHeader label={t.total} sortKey="total" sort={sort} onSort={toggleSort} cellClassName={ORDER_DENSITY[density].headerCell} />
                    ) : null}
                    {orderCols.isVisible("payment") ? (
                      <th scope="col" className={`${ORDER_DENSITY[density].headerCell} text-caption font-semibold text-text-muted`}>{s.colPayment}</th>
                    ) : null}
                    {orderCols.isVisible("status") ? (
                      <SortHeader label={s.colStatus} sortKey="status" sort={sort} onSort={toggleSort} cellClassName={ORDER_DENSITY[density].headerCell} />
                    ) : null}
                    {orderCols.isVisible("risk") ? (
                      <th scope="col" className={`${ORDER_DENSITY[density].headerCell} text-caption font-semibold text-text-muted`}>{s.colRisk}</th>
                    ) : null}
                    {orderCols.isVisible("courier") ? (
                      <th scope="col" className={`${ORDER_DENSITY[density].headerCell} text-caption font-semibold text-text-muted`}>{s.colCourier}</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const level = riskLevel(o.riskScore);
                    const stageChip = stageChipOf(o, stageDefs, locale);
                    return (
                      <tr
                        key={o.id}
                        onClick={(e) => { if (isPlainRowClick(e)) setPreviewId(o.id); }}
                        aria-selected={selected.has(o.id) || undefined}
                        className={`cursor-pointer border-t border-border/60 transition duration-fast ease-smooth hover:bg-brand-soft/60 ${selected.has(o.id) ? "bg-brand-soft" : ""}`}
                      >
                        <td className={ORDER_DENSITY[density].cell}>
                          <input
                            type="checkbox"
                            checked={selected.has(o.id)}
                            onChange={() => toggleSelected(o.id)}
                            aria-label={interpolate(s.lpSelectAria, { orderNo: o.orderNo })}
                            className="h-4 w-4 rounded accent-brand-600"
                          />
                        </td>
                        <td className={ORDER_DENSITY[density].cell}>
                          <a href={`/admin/orders/${o.id}`} className="font-mono text-small font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                            {o.orderNo}
                          </a>
                          {/* ADV-19: pickup badge — the choice is recorded
                           *  in the create-time note with a [pickup:<id>]
                           *  marker (src/checkout/pickup-points.ts); list
                           *  rows already carry their notes. */}
                          {o.notes.some((n) => n.text.includes("[pickup:")) ? (
                            <span className="mt-1 block">
                              <Badge tone="info">{s.lpPickup}</Badge>
                            </span>
                          ) : null}
                          <span className="block text-caption text-text-subtle">{o.address.district}, {o.address.division}</span>
                        </td>
                        {orderCols.isVisible("customer") ? (
                          <td className={ORDER_DENSITY[density].cell}>
                            <span className="block font-medium leading-snug">{o.customerName}</span>
                            <span className="block text-caption text-text-muted">{displayPhone(o.customerPhone, false)}</span>
                          </td>
                        ) : null}
                        {orderCols.isVisible("total") ? (
                          <td className={`${ORDER_DENSITY[density].cell} tnum font-semibold`}>{formatBdt(o.totalPoisha)}</td>
                        ) : null}
                        {orderCols.isVisible("payment") ? (
                          <td className={ORDER_DENSITY[density].cell}>
                            <span className="flex flex-wrap items-center gap-1.5">
                              <Badge tone="neutral">{paymentMethodLabel(o.paymentMethod, locale)}</Badge>
                              {UI_PAYMENT_STATUSES.includes(o.paymentStatus)
                                ? <PaymentBadge status={o.paymentStatus as UiPaymentStatus} />
                                : <Badge tone="neutral">{o.paymentStatus}</Badge>}
                            </span>
                          </td>
                        ) : null}
                        {orderCols.isVisible("status") ? (
                          <td className={ORDER_DENSITY[density].cell}>
                            <span className="flex flex-wrap items-center gap-1.5">
                              <OrderStatusBadge status={o.status} lang={locale} />
                              {stageChip ? <WorkflowStageChip label={stageChip.label} tone={stageChip.tone} /> : null}
                            </span>
                          </td>
                        ) : null}
                        {orderCols.isVisible("risk") ? (
                          <td className={ORDER_DENSITY[density].cell}>
                            <span className="flex items-center gap-1.5">
                              <Badge tone={level === "High" ? "danger" : level === "Medium" ? "warning" : "success"}>
                                {level === "High" ? s.riskHigh : level === "Medium" ? s.riskMedium : s.riskLow}
                              </Badge>
                              <span className="tnum text-caption text-text-muted">{o.riskScore}</span>
                            </span>
                          </td>
                        ) : null}
                        {orderCols.isVisible("courier") ? (
                          <td className={`${ORDER_DENSITY[density].cell} text-text-muted`}>{o.courier ?? "—"}</td>
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
                const level = riskLevel(o.riskScore);
                const stageChip = stageChipOf(o, stageDefs, locale);
                return (
                  <article
                    key={o.id}
                    onClick={(e) => { if (isPlainRowClick(e)) setPreviewId(o.id); }}
                    className={`cursor-pointer rounded-2xl border border-border/60 bg-card p-4 shadow-xs ${selected.has(o.id) ? "ring-1 ring-brand-300" : ""}`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => toggleSelected(o.id)}
                        aria-label={interpolate(s.lpSelectAria, { orderNo: o.orderNo })}
                        className="mt-0.5 h-4 w-4 shrink-0 rounded accent-brand-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <a href={`/admin/orders/${o.id}`} className="font-mono text-small font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                            {o.orderNo}
                          </a>
                          <span className="flex items-center gap-1.5">
                            {o.notes.some((n) => n.text.includes("[pickup:")) ? <Badge tone="info">{s.lpPickup}</Badge> : null}
                            {stageChip ? <WorkflowStageChip label={stageChip.label} tone={stageChip.tone} /> : null}
                            <OrderStatusBadge status={o.status} lang={locale} />
                          </span>
                        </div>
                        <p className="mt-1.5 truncate text-small font-medium leading-snug">{o.customerName}</p>
                        <p className="text-caption text-text-muted">
                          {displayPhone(o.customerPhone, false)} · {o.address.district}, {o.address.division}
                        </p>
                        <p className="mt-1 truncate text-small text-text-muted">{itemsSummaryLabel(o, locale)}</p>
                        <div className="mt-2.5 flex items-center gap-2 border-t border-border pt-2.5">
                          <span className="tnum text-small font-bold">{formatBdt(o.totalPoisha)}</span>
                          <Badge tone="neutral">{paymentMethodLabel(o.paymentMethod, locale)}</Badge>
                          <Badge tone={level === "High" ? "danger" : level === "Medium" ? "warning" : "success"}>
                            {level === "High" ? s.riskHigh : level === "Medium" ? s.riskMedium : s.riskLow}
                          </Badge>
                          <span className="ml-auto flex items-center gap-1 text-caption text-text-subtle">
                            <Icon name="clock" size={12} />
                            {orderAgeLabel(o.createdAt, Date.now(), locale)}
                          </span>
                          <a
                            href={`/admin/orders/${o.id}`}
                            aria-label={interpolate(s.lpDetailsAria, { orderNo: o.orderNo })}
                            className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-text-muted transition duration-fast ease-smooth hover:bg-brand-soft hover:text-brand-ink md:h-8 md:w-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
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
              {s.lpKanbanNote1} <strong className="font-semibold text-text-main">{s.lpKanbanNoteBold}</strong> {interpolate(s.lpKanbanNote2, { shown: orders.length, total })}
            </p>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {STATUSES.filter((s) => s !== "ALL").map((status) => {
                const column = pageOrders.filter((o) => o.status === status);
                return (
                  <section key={status} className="flex w-[264px] shrink-0 flex-col rounded-2xl border border-border/60 bg-surface-2/60 shadow-xs">
                    <header className="flex items-center gap-2 px-3.5 pb-1 pt-3.5">
                      <OrderStatusBadge status={status} lang={locale} />
                      <span className="tnum ml-auto rounded-full bg-card px-2 py-0.5 text-caption font-semibold text-text-muted">
                        {column.length}
                      </span>
                    </header>
                    <div className="space-y-2 overflow-y-auto px-2.5 pb-3 pt-1.5" style={{ maxHeight: "60vh" }}>
                      {column.length === 0 ? (
                        <p className="px-1.5 py-2 text-caption text-text-subtle">{s.lpKanbanEmpty}</p>
                      ) : column.map((o) => (
                        <article
                          key={o.id}
                          onClick={(e) => { if (isPlainRowClick(e)) setPreviewId(o.id); }}
                          className="cursor-grab rounded-xl border border-border/60 bg-card p-3 shadow-xs transition duration-fast ease-smooth hover:shadow-card active:cursor-grabbing"
                        >
                          <a href={`/admin/orders/${o.id}`} className="font-mono text-small font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                            {o.orderNo}
                          </a>
                          <p className="mt-1 truncate text-small font-medium leading-snug">{o.customerName}</p>
                          <p className="text-caption text-text-muted">{displayPhone(o.customerPhone, false)}</p>
                          <p className="mt-2 flex items-center justify-between text-caption">
                            <span className="tnum font-semibold text-text-main">{formatBdt(o.totalPoisha)}</span>
                            <span className="text-text-muted">{paymentMethodLabel(o.paymentMethod, locale)}</span>
                          </p>
                          {(() => {
                            const chip = stageChipOf(o, stageDefs, locale);
                            return chip ? (
                              <p className="mt-2">
                                <WorkflowStageChip label={chip.label} tone={chip.tone} />
                              </p>
                            ) : null;
                          })()}
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
              {interpolate(s.lpPagerText, { total, page, pages: totalPages })}
              {fetching ? <span className="ml-2 text-text-subtle">{t.loading}</span> : null}
            </p>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className="text-caption text-text-muted" htmlFor="orders-page-size">{s.lpPerPage}</label>
              <select
                id="orders-page-size"
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="rounded-xl border border-border bg-card px-2 py-1.5 text-small outline-none focus:border-brand-ink"
              >
                {[25, 50, 100].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <Button variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || fetching}>
                {s.lpPrevPage}
              </Button>
              <Button variant="outline" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || fetching}>
                {s.lpNextPage}
              </Button>
            </div>
          </div>

          <p className="mt-3 text-caption leading-relaxed text-text-subtle">
            {s.lpBulkNote}
          </p>
        </>
      )}

      {/* Parked manual-order drafts (doc 17 O9-2): Resume loads one
       *  into the builder below; Convert re-validates its payload
       *  through the manual create. Renders nothing when empty. */}
      <DraftsPanel onConverted={load} />

      {/* Manual order — posts to the admin create endpoint */}
      <Card className="mt-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-h3">{s.lpManualTitle}</h2>
            <p className="mt-0.5 text-small text-text-muted">
              {interpolate(s.lpManualSteps, {
                steps: MANUAL_ORDER_STEPS.map((step) =>
                  locale === "bn" ? (MANUAL_STEP_BN[step] ?? step) : step,
                ).join(" → "),
              })}
            </p>
          </div>
        </div>
        <p className="mt-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-small leading-relaxed text-text-muted">
          {s.lpManualNote}
        </p>
        <ManualOrderBuilder onCreated={load} />
      </Card>

      {/* CSV bulk order import (doc 17 O4) — per-group results render
       *  inside the card; a successful import reloads the list. */}
      <OrderImportCard onImported={load} />

      {/* OD1 slide-over preview — row/card clicks set previewId; the
       *  drawer fetches the detail payload itself and renders nothing
       *  while closed. */}
      <OrderPreviewDrawer orderId={previewId} onClose={() => setPreviewId(null)} />
    </main>
  );
}

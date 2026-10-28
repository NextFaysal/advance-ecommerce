"use client";

// CRM — REAL data from GET /api/v1/admin/customers (Prisma-backed;
// aggregates computed from the Order table server-side). Phone is masked
// by the API for viewers without customers.view_full_phone, and this
// page masks again on display. An empty DB shows an honest empty state.
//
// Presentation (Design Refresh R3): PageHeader + filter card, token
// table with selected-row state, profile card. The "to be wired" tabs
// and quick actions stay labelled as such. Data flow unchanged.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Customer } from "../../../src/orders/types";
import { customerAovPoisha, customerSuccessRate, displayPhone } from "../../../src/orders/customer";
import { formatBdt } from "../../../src/checkout/pricing";
import { PageHeader } from "@/admin-shell/PageHeader";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTableSkeleton } from "@/components/ui/table";
import { CustomFieldsPanel } from "@/components/admin/custom-fields-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ColumnPicker,
  SavedViewsBar,
  useHiddenColumns,
  useSavedViews,
  type SavedView,
} from "../../../src/admin/table-prefs";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";
import { CUSTOMER_STRINGS } from "./strings";

type LoadState = "loading" | "error" | "ready";

/* Table v2 remainder: client-side sort (name / orders / success rate /
 * LTV) + saved views (search + sort) + column visibility, persisted
 * per staff user in localStorage (see src/admin/table-prefs.tsx).
 * Every desktop-table column except the customer name can be hidden. */
type CustomerSortKey = "name" | "orders" | "success" | "ltv";
type CustomerSort = { key: CustomerSortKey; dir: "asc" | "desc" };
interface CustomerViewState {
  search: string;
  sort: CustomerSort | null;
}
const CUSTOMER_HIDEABLE_KEYS = ["phone", "orders", "success", "ltv", "aov", "tags"] as const;

function SortTh({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: CustomerSortKey;
  sort: CustomerSort | null;
  onSort: (key: CustomerSortKey) => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, CUSTOMER_STRINGS);
  const active = sort?.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
      className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted"
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        aria-label={interpolate(s.sortByAria, { label })}
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

export default function AdminCustomersPage() {
  const { locale, t } = useLocale();
  const s = pick(locale, CUSTOMER_STRINGS);
  const profileTabs = [s.tabOrders, s.tabAddresses, s.tabWallet, s.tabNotes, s.tabActivity];
  const quickActions = [s.quickCall, s.quickSms, s.quickWhatsapp, s.quickBlock, s.quickNote, s.quickTag];
  const pickerColumns = [
    { key: "phone", label: s.colPhoneMasked },
    { key: "orders", label: s.colOrders },
    { key: "success", label: s.colSuccessRate },
    { key: "ltv", label: s.colLtv },
    { key: "aov", label: s.colAov },
    { key: "tags", label: s.colTags },
  ] as const;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CustomerSort | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const customerViews = useSavedViews<CustomerViewState>("customers");
  const customerCols = useHiddenColumns("customers", CUSTOMER_HIDEABLE_KEYS);

  function toggleSort(key: CustomerSortKey) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: key === "name" ? "asc" : "desc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }

  function applyCustomerView(view: SavedView<CustomerViewState>) {
    const s = view.state;
    setSearch(typeof s?.search === "string" ? s.search : "");
    const savedSort = s?.sort;
    setSort(
      savedSort && (["name", "orders", "success", "ltv"] as string[]).includes(savedSort.key)
        ? { key: savedSort.key, dir: savedSort.dir === "asc" ? "asc" : "desc" }
        : null,
    );
  }

  const load = useCallback(async (initialSearch: string) => {
    setLoadState("loading");
    try {
      const qs = new URLSearchParams({ pageSize: "100" });
      if (initialSearch) qs.set("search", initialSearch);
      const res = await fetch(`/api/v1/admin/customers?${qs.toString()}`);
      const body = (await res.json().catch(() => null)) as
        | { data?: Customer[]; meta?: { total?: number }; error?: { code: string; message: string } }
        | null;
      if (res.ok && body && "data" in body && body.data) {
        setCustomers(body.data);
        setTotal(body.meta?.total ?? body.data.length);
        setSelectedId((prev) => prev ?? body.data![0]?.id ?? null);
        setLoadState("ready");
      } else {
        setLoadError(
          body && "error" in body && body.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`,
        );
        setLoadState("error");
      }
    } catch {
      setLoadError(s.networkError);
      setLoadState("error");
    }
  }, [s]);

  useEffect(() => {
    // ?search= lands here from the command palette's customer links.
    const initial = new URLSearchParams(window.location.search).get("search") ?? "";
    setSearch(initial);
    void load(initial);
  }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = !needle
      ? customers
      : customers.filter(
          (c) => c.name.toLowerCase().includes(needle) || c.tags.some((t) => t.toLowerCase().includes(needle)),
        );
    if (!sort) return filtered;
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === "name") return a.name.localeCompare(b.name) * mul;
      if (sort.key === "orders") return (a.totalOrders - b.totalOrders) * mul;
      if (sort.key === "success") return (customerSuccessRate(a) - customerSuccessRate(b)) * mul;
      return (a.lifetimeValuePoisha - b.lifetimeValuePoisha) * mul;
    });
  }, [customers, search, sort]);

  const selected = visible.find((c) => c.id === selectedId) ?? visible[0];

  return (
    <main>
      <PageHeader
        title={s.title}
        subtitle={interpolate(s.description, { total })}
        actions={
          <Button variant="outline" onClick={() => void load(search)}>
            {s.refresh}
          </Button>
        }
      />

      <Card className="mb-4">
        <div className="relative max-w-md">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={s.searchPlaceholder}
            aria-label={s.searchAria}
            className="h-11 w-full rounded-xl border border-border/60 bg-card pl-9 pr-3 text-sm shadow-xs outline-none transition duration-fast ease-smooth focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/60 pt-3">
          <SavedViewsBar<CustomerViewState>
            views={customerViews.views}
            ready={customerViews.ready}
            currentState={{ search, sort }}
            onApply={applyCustomerView}
            onSave={customerViews.saveView}
            onDelete={customerViews.deleteView}
          />
          <span className="ml-auto">
            <ColumnPicker
              columns={pickerColumns}
              hidden={customerCols.hidden}
              onToggle={customerCols.toggleColumn}
              ready={customerCols.ready}
            />
          </span>
        </div>
        <p className="mt-2 text-caption leading-relaxed text-text-subtle">{pick(locale, ADMIN_STRINGS).tpStorageNote}</p>
      </Card>

      {loadState === "loading" && (
        <div role="status" aria-label={s.loadingAria}>
          <DataTableSkeleton columns={6} rows={4} />
          <p className="mt-3 text-small text-text-muted">{s.loadingText}</p>
        </div>
      )}

      {loadState === "error" && (
        <div role="alert" className="rounded-2xl border border-danger/30 bg-danger-soft p-5 shadow-xs">
          <p className="font-display font-semibold text-danger">{s.loadFailedTitle}</p>
          <p className="mt-1 text-small text-danger">{loadError}</p>
          <Button variant="outline" className="mt-4 bg-card" onClick={() => void load(search)}>
            {s.tryAgain}
          </Button>
        </div>
      )}

      {loadState === "ready" && visible.length === 0 && (
        <div role="status">
          <EmptyState title={s.emptyTitle} description={s.emptyText}>
            {search.trim() !== "" && (
              <Button variant="outline" className="mt-5" onClick={() => setSearch("")}>
                {s.clearSearch}
              </Button>
            )}
          </EmptyState>
        </div>
      )}

      {loadState === "ready" && visible.length > 0 && (
        <>
        {/* Desktop table — hidden under md (card list below takes over,
         *  so a 360px screen never scrolls sideways). */}
        <div className="hidden overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-xs md:block">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-surface-2/80 text-left">
                <SortTh label={t.name} sortKey="name" sort={sort} onSort={toggleSort} />
                {customerCols.isVisible("phone") ? (
                  <th scope="col" className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{s.colPhoneMasked}</th>
                ) : null}
                {customerCols.isVisible("orders") ? (
                  <SortTh label={s.colOrders} sortKey="orders" sort={sort} onSort={toggleSort} />
                ) : null}
                {customerCols.isVisible("success") ? (
                  <SortTh label={s.colSuccessRate} sortKey="success" sort={sort} onSort={toggleSort} />
                ) : null}
                {customerCols.isVisible("ltv") ? (
                  <SortTh label={s.colLtv} sortKey="ltv" sort={sort} onSort={toggleSort} />
                ) : null}
                {customerCols.isVisible("aov") ? (
                  <th scope="col" className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{s.colAov}</th>
                ) : null}
                {customerCols.isVisible("tags") ? (
                  <th scope="col" className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{s.colTags}</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const isSelected = selected?.id === c.id;
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    aria-selected={isSelected}
                    className={`cursor-pointer border-t border-border/60 transition duration-fast ease-smooth first:border-t-0 hover:bg-brand-soft/60 ${isSelected ? "bg-brand-soft" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium leading-snug">{c.name}</span>
                      {c.blocked ? <span className="ml-2 inline-flex"><Badge tone="danger">{s.blocked}</Badge></span> : null}
                    </td>
                    {customerCols.isVisible("phone") ? (
                      <td className="px-4 py-3 font-mono text-small tabular-nums text-text-muted">{displayPhone(c.phone, false)}</td>
                    ) : null}
                    {customerCols.isVisible("orders") ? (
                      <td className="px-4 py-3 font-mono tabular-nums">{c.totalOrders}</td>
                    ) : null}
                    {customerCols.isVisible("success") ? (
                      <td className="px-4 py-3 font-mono tabular-nums">{customerSuccessRate(c)}%</td>
                    ) : null}
                    {customerCols.isVisible("ltv") ? (
                      <td className="px-4 py-3 font-mono font-semibold tabular-nums">{formatBdt(c.lifetimeValuePoisha)}</td>
                    ) : null}
                    {customerCols.isVisible("aov") ? (
                      <td className="px-4 py-3 font-mono tabular-nums">{formatBdt(customerAovPoisha(c))}</td>
                    ) : null}
                    {customerCols.isVisible("tags") ? (
                      <td className="px-4 py-3">
                        {c.tags.length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {c.tags.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
                          </span>
                        ) : (
                          <span className="text-text-subtle">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile card list (under md) — tap selects the customer, same
         *  as tapping a table row on desktop. */}
        <div className="space-y-3 md:hidden">
          {visible.map((c) => {
            const isSelected = selected?.id === c.id;
            return (
              <article
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                aria-selected={isSelected}
                className={`cursor-pointer rounded-2xl border border-border/60 bg-card p-4 shadow-xs transition duration-fast ease-smooth ${isSelected ? "bg-brand-soft ring-1 ring-brand-300" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-medium leading-snug">{c.name}</p>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {c.blocked ? <Badge tone="danger">{s.blocked}</Badge> : null}
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-text-subtle">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </span>
                </div>
                <p className="mt-1 font-mono text-small tabular-nums text-text-muted">{displayPhone(c.phone, false)}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-center">
                  <span>
                    <span className="block text-caption text-text-subtle">{s.colOrders}</span>
                    <span className="font-mono font-semibold tabular-nums">{c.totalOrders}</span>
                  </span>
                  <span>
                    <span className="block text-caption text-text-subtle">{s.colSuccessRate}</span>
                    <span className="font-mono font-semibold tabular-nums">{customerSuccessRate(c)}%</span>
                  </span>
                  <span>
                    <span className="block text-caption text-text-subtle">{s.colTotalPurchases}</span>
                    <span className="font-mono font-semibold tabular-nums">{formatBdt(c.lifetimeValuePoisha)}</span>
                  </span>
                </div>
                {c.tags.length > 0 ? (
                  <p className="mt-3 flex flex-wrap gap-1">
                    {c.tags.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
        </>
      )}

      {loadState === "ready" && selected && (
        <Card className="mt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-h3 font-semibold">{selected.name} — {s.profileWord}</h2>
              <p className="mt-1 text-small text-text-muted">
                {t.phone}: <span className="font-mono tabular-nums">{displayPhone(selected.phone, false)}</span>{" "}
                {s.phonePermissionNote}
              </p>
            </div>
            {selected.blocked ? <Badge tone="danger">{s.blocked}</Badge> : <Badge tone="success">{s.active}</Badge>}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: s.statDelivered, value: String(selected.deliveredOrders) },
              { label: s.statCancelled, value: String(selected.cancelledOrders) },
              { label: s.statReturned, value: String(selected.returnedOrders) },
              { label: s.statLastOrder, value: selected.lastOrderAt ?? "—" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-surface-2 px-3.5 py-3">
                <p className="text-caption font-medium text-text-muted">{s.label}</p>
                <p className="mt-0.5 truncate font-mono text-h3 font-bold tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 border-t border-border/60 pt-4">
            <p className="flex flex-wrap items-center gap-1.5 text-small">
              <span className="mr-1 font-medium text-text-muted">{s.tabsLabel}</span>
              {profileTabs.map((t) => (
                <span key={t} className="rounded-full border border-dashed border-border/60 px-2.5 py-1 text-caption font-medium text-text-muted">{t}</span>
              ))}
            </p>
            <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-small">
              <span className="mr-1 font-medium text-text-muted">{s.quickActionsLabel}</span>
              {quickActions.map((a) => (
                <span key={a} className="rounded-full border border-dashed border-border/60 px-2.5 py-1 text-caption font-medium text-text-muted">{a}</span>
              ))}
            </p>
          </div>
        </Card>
      )}

      {/* Merchant custom fields (ADV-26, wave 53) — self-fetching;
          renders nothing until customer fields are defined in
          /admin/webhooks, so this page is unchanged by default. */}
      {loadState === "ready" && selected && (
        <div className="mt-5">
          <CustomFieldsPanel entity="customer" entityId={selected.id} />
        </div>
      )}
    </main>
  );
}

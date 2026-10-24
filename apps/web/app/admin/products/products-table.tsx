"use client";

// Admin product list — interactive table (client). The server page
// reads the real catalog DB and hands this component plain
// serializable rows; search + status filter + sort run client-side
// over those rows (same pattern as the orders/customers lists).
// Table v2 remainder: saved views (search + status + sort) and
// column visibility, persisted per staff user in localStorage (see
// src/admin/table-prefs.tsx). Column choices apply to the DESKTOP
// table only — the mobile card list below always shows every field.
// Delete goes through DeleteProductButton (reason-modal + API); on
// success it calls router.refresh(), which re-runs the server page
// and streams fresh rows back into this component.
import { useMemo, useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ColumnPicker,
  SavedViewsBar,
  TABLE_PREFS_NOTE,
  useHiddenColumns,
  useSavedViews,
  type SavedView,
} from "../../../src/admin/table-prefs";
import { DeleteProductButton } from "./delete-product-button";

export interface ProductRow {
  id: string;
  title: string;
  slug: string;
  pricePoisha: number;
  stock: number;
  status: string;
}

const STATUS_META: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "brand" }> = {
  ACTIVE: { label: "সক্রিয়", tone: "success" },
  DRAFT: { label: "খসড়া", tone: "warning" },
  ARCHIVED: { label: "আর্কাইভ", tone: "neutral" },
};
const STATUS_FILTERS = ["ALL", "ACTIVE", "DRAFT", "ARCHIVED"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

type ProductSortKey = "title" | "price" | "stock" | "status";
type ProductSort = { key: ProductSortKey; dir: "asc" | "desc" };
interface ProductViewState {
  search: string;
  status: string;
  sort: ProductSort | null;
}

const PICKER_COLUMNS = [
  { key: "price", label: "দাম (থেকে)" },
  { key: "stock", label: "স্টক" },
  { key: "status", label: "স্ট্যাটাস" },
] as const;
const HIDEABLE_KEYS = PICKER_COLUMNS.map((c) => c.key);

function SortTh({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: ProductSortKey;
  sort: ProductSort | null;
  onSort: (key: ProductSortKey) => void;
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

export function ProductsTable({ products, canDelete }: { products: ProductRow[]; canDelete: boolean }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [sort, setSort] = useState<ProductSort | null>(null);
  const views = useSavedViews<ProductViewState>("products");
  const cols = useHiddenColumns("products", HIDEABLE_KEYS);

  function toggleSort(key: ProductSortKey) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: key === "title" || key === "status" ? "asc" : "desc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }

  function applyView(view: SavedView<ProductViewState>) {
    const s = view.state;
    setSearch(typeof s?.search === "string" ? s.search : "");
    setStatus(
      s && (STATUS_FILTERS as readonly string[]).includes(s.status) ? (s.status as StatusFilter) : "ALL",
    );
    const savedSort = s?.sort;
    setSort(
      savedSort && (["title", "price", "stock", "status"] as string[]).includes(savedSort.key)
        ? { key: savedSort.key, dir: savedSort.dir === "asc" ? "asc" : "desc" }
        : null,
    );
  }

  const countFor = (s: StatusFilter) =>
    s === "ALL" ? products.length : products.filter((p) => p.status === s).length;

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = products.filter((p) => {
      if (status !== "ALL" && p.status !== status) return false;
      if (!needle) return true;
      return p.title.toLowerCase().includes(needle) || p.slug.toLowerCase().includes(needle);
    });
    if (!sort) return filtered;
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === "title") return a.title.localeCompare(b.title) * mul;
      if (sort.key === "price") return (a.pricePoisha - b.pricePoisha) * mul;
      if (sort.key === "stock") return (a.stock - b.stock) * mul;
      return a.status.localeCompare(b.status) * mul;
    });
  }, [products, search, status, sort]);

  return (
    <>
      <Card className="mb-4 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="পণ্যের নাম বা স্লাগ খুঁজুন…"
              aria-label="পণ্য খুঁজুন"
              className="h-11 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <span className="ml-auto">
            <ColumnPicker
              columns={PICKER_COLUMNS}
              hidden={cols.hidden}
              onToggle={cols.toggleColumn}
              ready={cols.ready}
            />
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((s) => {
            const label = s === "ALL" ? "সব" : (STATUS_META[s]?.label ?? s);
            const active = status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                aria-pressed={active}
                className={`flex min-h-[32px] items-center gap-1.5 rounded-full px-3 text-caption font-semibold transition motion-fast ${
                  active ? "bg-brand-600 text-white shadow-sm" : "border border-border bg-card text-text-muted hover:border-brand-300 hover:text-brand-700"
                }`}
              >
                {label}
                <span className={`font-mono tabular-nums ${active ? "text-white/85" : "text-text-subtle"}`}>{countFor(s)}</span>
              </button>
            );
          })}
          <span className="ml-auto text-caption text-text-muted">
            {visible.length}টি পণ্য দেখানো হচ্ছে (মোট {products.length}টি)
          </span>
        </div>
        <div className="mt-3 border-t border-border pt-3">
          <SavedViewsBar<ProductViewState>
            views={views.views}
            ready={views.ready}
            currentState={{ search, status, sort }}
            onApply={applyView}
            onSave={views.saveView}
            onDelete={views.deleteView}
          />
        </div>
        <p className="mt-2 text-caption leading-relaxed text-text-subtle">{TABLE_PREFS_NOTE}</p>
      </Card>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-6 py-14 text-center shadow-card">
          <h2 className="text-h3">কোনো পণ্য পাওয়া যায়নি</h2>
          <p className="mx-auto mt-1 max-w-md text-small leading-relaxed text-text-muted">
            এই ফিল্টার/খোঁজে ক্যাটালগে কোনো পণ্য নেই। ফিল্টার বদলে আবার দেখুন।
          </p>
          <Button
            variant="outline"
            className="mt-5"
            onClick={() => { setStatus("ALL"); setSearch(""); }}
          >
            ফিল্টার মুছে ফেলুন
          </Button>
        </div>
      ) : (
        <>
          {/* Desktop table — hidden under md (card list below takes over). */}
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-card shadow-card md:block">
            <table className="w-full min-w-[640px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-surface-2 text-left [&>th]:border-b [&>th]:border-border">
                  <SortTh label="পণ্য" sortKey="title" sort={sort} onSort={toggleSort} />
                  {cols.isVisible("price") ? (
                    <SortTh label="দাম (থেকে)" sortKey="price" sort={sort} onSort={toggleSort} />
                  ) : null}
                  {cols.isVisible("stock") ? (
                    <SortTh label="স্টক" sortKey="stock" sort={sort} onSort={toggleSort} />
                  ) : null}
                  {cols.isVisible("status") ? (
                    <SortTh label="স্ট্যাটাস" sortKey="status" sort={sort} onSort={toggleSort} />
                  ) : null}
                  {canDelete && (
                    <th scope="col" className="px-4 py-3 text-right text-caption font-semibold text-text-muted">অ্যাকশন</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const meta = STATUS_META[p.status] ?? { label: p.status, tone: "neutral" as const };
                  return (
                    <tr key={p.id} className="border-t border-border transition motion-fast first:border-t-0 hover:bg-surface-2/70">
                      <td className="min-w-0 px-4 py-3">
                        <span className="block break-words font-medium leading-snug [overflow-wrap:anywhere]">{p.title}</span>
                        <span className="font-mono text-caption text-text-subtle">/{p.slug}</span>
                      </td>
                      {cols.isVisible("price") ? (
                        <td className="px-4 py-3 font-mono font-semibold tabular-nums">{formatBdt(p.pricePoisha)}</td>
                      ) : null}
                      {cols.isVisible("stock") ? (
                        <td className="px-4 py-3">
                          <span className={`font-mono tabular-nums ${p.stock <= 0 ? "font-semibold text-rose-600" : ""}`}>{p.stock}</span>
                          {p.stock <= 0 ? <span className="ml-1.5 text-caption text-rose-500">স্টক শেষ</span> : null}
                        </td>
                      ) : null}
                      {cols.isVisible("status") ? (
                        <td className="px-4 py-3">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </td>
                      ) : null}
                      {canDelete && (
                        <td className="px-4 py-3 text-right">
                          <DeleteProductButton productId={p.id} productTitle={p.title} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list (under md) — always shows every field;
           *  column choices above apply to the desktop table only. */}
          <div className="space-y-3 md:hidden">
            {visible.map((p) => {
              const meta = STATUS_META[p.status] ?? { label: p.status, tone: "neutral" as const };
              return (
                <article key={p.id} className="rounded-lg border border-border bg-card p-4 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-words font-medium leading-snug [overflow-wrap:anywhere]">{p.title}</p>
                      <p className="mt-0.5 font-mono text-caption text-text-subtle">/{p.slug}</p>
                    </div>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-4 border-t border-border pt-3 text-small">
                    <span>
                      <span className="block text-caption text-text-subtle">দাম (থেকে)</span>
                      <span className="font-mono font-semibold tabular-nums">{formatBdt(p.pricePoisha)}</span>
                    </span>
                    <span>
                      <span className="block text-caption text-text-subtle">স্টক</span>
                      <span className={`font-mono tabular-nums ${p.stock <= 0 ? "font-semibold text-rose-600" : ""}`}>
                        {p.stock}
                        {p.stock <= 0 ? <span className="ml-1.5 text-caption text-rose-500">স্টক শেষ</span> : null}
                      </span>
                    </span>
                    {canDelete && (
                      <span className="ml-auto">
                        <DeleteProductButton productId={p.id} productTitle={p.title} />
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

"use client";

// Admin product list — interactive table (client), Wave 13-3.
//
// Data: SERVER-paginated through GET /api/v1/admin/products
// (q / status / category / page / pageSize=25) — the table fetches
// one page at a time instead of loading the whole catalog and
// filtering in the browser (the wave-12 approach capped at 100 rows
// per status). Status-chip counts come from lightweight pageSize=1
// reads of the same endpoint, honouring the current search/category.
// Saved views + column visibility are browser-local prefs (see
// src/admin/table-prefs.tsx) and keep working unchanged: a view now
// stores { search, status, category, sort }; sort applies to the
// loaded page's rows (server order is newest-first).
//
// Power tools:
//  - Row selection + bulk bar -> POST /api/v1/admin/products/bulk
//    (status / price-adjust % with REQUIRED reason / soft delete
//    with REQUIRED reason). The result summary lists every failure.
//  - Quick edit: price (first variant, taka input, reason collected
//    in an inline prompt row — mirroring the product editor), total
//    stock (save on Enter/blur), status (select). All go through
//    PATCH /api/v1/admin/products/[id]; variant payloads are built
//    from a fresh GET of the full product so cost prices and sibling
//    variants are never clobbered by the stripped list shape.
//  - Duplicate per row (DuplicateProductButton) -> DRAFT copy, then a
//    link into the copy's edit page.
// Delete still goes through DeleteProductButton (reason modal); its
// onDeleted callback refetches the current page.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { minVariantPricePoisha, type Product as CatalogProduct } from "../../../src/catalog/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  ColumnPicker,
  SavedViewsBar,
  TABLE_PREFS_NOTE,
  useHiddenColumns,
  useSavedViews,
  type SavedView,
} from "../../../src/admin/table-prefs";
import { DeleteProductButton } from "./delete-product-button";
import { DuplicateProductButton } from "./duplicate-product-button";

export interface ProductRow {
  id: string;
  title: string;
  slug: string;
  pricePoisha: number;
  stock: number;
  status: string;
  variantCount: number;
}

const PAGE_SIZE = 25;

const STATUS_META: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "brand" }> = {
  ACTIVE: { label: "সক্রিয়", tone: "success" },
  DRAFT: { label: "খসড়া", tone: "warning" },
  ARCHIVED: { label: "আর্কাইভ", tone: "neutral" },
};
const STATUS_FILTERS = ["ALL", "ACTIVE", "DRAFT", "ARCHIVED"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const PRODUCT_STATUSES = ["ACTIVE", "DRAFT", "ARCHIVED"] as const;

type ProductSortKey = "title" | "price" | "stock" | "status";
type ProductSort = { key: ProductSortKey; dir: "asc" | "desc" };
interface ProductViewState {
  search: string;
  status: string;
  sort: ProductSort | null;
  category: string;
}

const PICKER_COLUMNS = [
  { key: "price", label: "দাম (থেকে)" },
  { key: "stock", label: "স্টক" },
  { key: "status", label: "স্ট্যাটাস" },
] as const;
const HIDEABLE_KEYS = PICKER_COLUMNS.map((c) => c.key);

interface CategoryOption {
  slug: string;
  nameBn: string;
}

interface BulkResultItem {
  id: string;
  ok: boolean;
  changed?: boolean;
  code?: string;
  message?: string;
}

function toRow(p: CatalogProduct): ProductRow {
  return {
    id: p.id,
    title: p.title.bn,
    slug: p.slug,
    pricePoisha: minVariantPricePoisha(p),
    stock: p.variants.reduce((s, v) => s + v.stock, 0),
    status: p.status,
    variantCount: p.variants.length,
  };
}

/** Full variant payload for PATCH — update semantics replace the
 *  variant set by SKU, so every stored field is carried through and
 *  only the quick-edited field differs. Input comes from the by-id
 *  GET (which does not strip cost), never from the list rows. */
function toVariantInputs(product: CatalogProduct) {
  return product.variants.map((v) => ({
    attributes: v.attributes,
    sku: v.sku,
    barcode: v.barcode,
    pricePoisha: v.pricePoisha,
    compareAtPoisha: v.compareAtPoisha,
    costPoisha: v.costPoisha,
    stock: v.stock,
    imageUrl: v.imageUrl,
    isActive: v.isActive,
  }));
}

function pageList(current: number, last: number): (number | "…")[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const pages = new Set(
    [1, 2, last - 1, last, current - 1, current, current + 1].filter((p) => p >= 1 && p <= last),
  );
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

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

const cellInputCls =
  "h-9 w-28 rounded-md border border-brand-300 bg-card px-2 font-mono text-sm tabular-nums shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export function ProductsTable({
  canDelete,
  canEdit,
  canCreate,
}: {
  canDelete: boolean;
  canEdit: boolean;
  canCreate: boolean;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [counts, setCounts] = useState<Record<StatusFilter, number | null>>({
    ALL: null,
    ACTIVE: null,
    DRAFT: null,
    ARCHIVED: null,
  });
  const [sort, setSort] = useState<ProductSort | null>(null);
  const views = useSavedViews<ProductViewState>("products");
  const cols = useHiddenColumns("products", HIDEABLE_KEYS);

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<{ ok: number; failures: { id: string; title: string; message: string }[] } | null>(null);
  const [priceModal, setPriceModal] = useState(false);
  const [bulkPercent, setBulkPercent] = useState("");
  const [bulkReason, setBulkReason] = useState("");
  const [bulkModalError, setBulkModalError] = useState("");
  const [deleteModal, setDeleteModal] = useState(false);
  const [bulkDeleteReason, setBulkDeleteReason] = useState("");
  const [bulkDeleteError, setBulkDeleteError] = useState("");

  const [notice, setNotice] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; field: "price" | "stock" } | null>(null);
  const [editProduct, setEditProduct] = useState<CatalogProduct | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [editReason, setEditReason] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState("");
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement | null>(null);
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  // Synchronous mirrors of the edit session: the stock input saves on
  // blur, and blur fires right after an Escape keydown — the ref lets
  // saveStock tell "cancelled" apart from "save me" without waiting
  // for state to settle, and editBusyRef blocks Enter+blur doubles.
  const editingRef = useRef<{ id: string; field: "price" | "stock" } | null>(null);
  const editBusyRef = useRef(false);

  const showActions = canDelete || canCreate;

  /* ------------------------------ data ------------------------------ */

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        status,
      });
      if (debouncedSearch) params.set("q", debouncedSearch);
      if (category) params.set("category", category);
      const res = await fetch(`/api/v1/admin/products?${params.toString()}`);
      const body = (await res.json().catch(() => null)) as
        | { data?: CatalogProduct[]; meta?: { total: number }; error?: { code: string; message: string } }
        | null;
      if (!res.ok || !body?.data || !body.meta) {
        setLoadError(body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
        setRows([]);
        setTotal(0);
        return;
      }
      setRows(body.data.map(toRow));
      setTotal(body.meta.total);
    } catch {
      setLoadError("নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি।");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, status, debouncedSearch, category]);

  useEffect(() => {
    void load();
  }, [load]);

  // If a mutation emptied the current page (e.g. last row of page 3
  // deleted), step back instead of stranding the user on a blank page.
  useEffect(() => {
    if (!loading && rows.length === 0 && total > 0 && page > 1) setPage((p) => p - 1);
  }, [loading, rows.length, total, page]);

  // Status-chip counts: one tiny read per status over the same
  // endpoint, honouring search + category (not the status filter).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const entries = await Promise.all(
        STATUS_FILTERS.map(async (s) => {
          try {
            const params = new URLSearchParams({ page: "1", pageSize: "1", status: s });
            if (debouncedSearch) params.set("q", debouncedSearch);
            if (category) params.set("category", category);
            const res = await fetch(`/api/v1/admin/products?${params.toString()}`);
            const body = (await res.json().catch(() => null)) as { meta?: { total: number } } | null;
            return [s, res.ok && body?.meta ? body.meta.total : null] as const;
          } catch {
            return [s, null] as const;
          }
        }),
      );
      if (alive) {
        const next: Record<StatusFilter, number | null> = {
          ALL: null,
          ACTIVE: null,
          DRAFT: null,
          ARCHIVED: null,
        };
        for (const [s, v] of entries) next[s] = v;
        setCounts(next);
      }
    })();
    return () => {
      alive = false;
    };
  }, [debouncedSearch, category]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/v1/admin/categories");
        const body = (await res.json().catch(() => null)) as
          | { data?: { categories?: { slug: string; nameBn: string }[] } }
          | null;
        if (alive && res.ok && body?.data?.categories) {
          setCategories(body.data.categories.map((c) => ({ slug: c.slug, nameBn: c.nameBn })));
        }
      } catch {
        // Category filter is best-effort — the list works without it.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Debounced search -> server q, back to page 1, selection cleared.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
      setSelected(new Set());
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const displayRows = useMemo(() => {
    if (!sort) return rows;
    const mul = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sort.key === "title") return a.title.localeCompare(b.title) * mul;
      if (sort.key === "price") return (a.pricePoisha - b.pricePoisha) * mul;
      if (sort.key === "stock") return (a.stock - b.stock) * mul;
      return a.status.localeCompare(b.status) * mul;
    });
  }, [rows, sort]);

  /* --------------------------- view prefs --------------------------- */

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
    setCategory(typeof s?.category === "string" ? s.category : "");
    const savedSort = s?.sort;
    setSort(
      savedSort && (["title", "price", "stock", "status"] as string[]).includes(savedSort.key)
        ? { key: savedSort.key, dir: savedSort.dir === "asc" ? "asc" : "desc" }
        : null,
    );
    setPage(1);
    setSelected(new Set());
  }

  function changeStatus(s: StatusFilter) {
    setStatus(s);
    setPage(1);
    setSelected(new Set());
    setBulkSummary(null);
  }

  function changeCategory(slug: string) {
    setCategory(slug);
    setPage(1);
    setSelected(new Set());
    setBulkSummary(null);
  }

  /* ---------------------------- selection ---------------------------- */

  const allPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const somePageSelected = rows.some((r) => selected.has(r.id));
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = somePageSelected && !allPageSelected;
    }
  }, [somePageSelected, allPageSelected]);

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function togglePage(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (checked) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  }

  /* ------------------------------ bulk ------------------------------ */

  async function callBulk(payload: Record<string, unknown>) {
    if (bulkBusy) return;
    setBulkBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/admin/products/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            data?: { succeeded: number; results: BulkResultItem[] };
            error?: { code: string; message: string };
          }
        | null;
      if (!res.ok || !body?.data) {
        setNotice({
          tone: "error",
          text: body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`,
        });
        return;
      }
      const titleById = new Map(rows.map((r) => [r.id, r.title]));
      const failures = body.data.results
        .filter((r) => !r.ok)
        .map((r) => ({
          id: r.id,
          title: titleById.get(r.id) ?? r.id,
          message: `${r.code ?? "ERROR"}: ${r.message ?? ""}`,
        }));
      setBulkSummary({ ok: body.data.succeeded, failures });
      setSelected(new Set());
      void load();
    } catch {
      setNotice({ tone: "error", text: "নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি।" });
    } finally {
      setBulkBusy(false);
    }
  }

  function confirmBulkPrice() {
    const percent = Number(bulkPercent);
    if (bulkPercent.trim() === "" || !Number.isFinite(percent) || percent <= -100 || percent > 1000) {
      setBulkModalError("সঠিক শতাংশ লিখুন (যেমন 10 মানে ১০% বৃদ্ধি, -5 মানে ৫% ছাড়) — -100-এর বেশি হতে হবে।");
      return;
    }
    if (bulkReason.trim() === "") {
      setBulkModalError("দাম বদলের কারণ লিখুন — এটি অডিট লগে সংরক্ষিত থাকে।");
      return;
    }
    setPriceModal(false);
    setBulkModalError("");
    void callBulk({
      ids: [...selected],
      action: "price-adjust",
      percent,
      reason: bulkReason.trim(),
    });
    setBulkPercent("");
    setBulkReason("");
  }

  function confirmBulkDelete() {
    if (bulkDeleteReason.trim() === "") {
      setBulkDeleteError("মুছে ফেলার কারণ লিখুন — এটি অডিট লগে সংরক্ষিত থাকে।");
      return;
    }
    setDeleteModal(false);
    setBulkDeleteError("");
    void callBulk({ ids: [...selected], action: "delete", reason: bulkDeleteReason.trim() });
    setBulkDeleteReason("");
  }

  /* ---------------------------- quick edit ---------------------------- */

  async function fetchFullProduct(id: string): Promise<CatalogProduct | null> {
    try {
      const res = await fetch(`/api/v1/admin/products/${encodeURIComponent(id)}`);
      const body = (await res.json().catch(() => null)) as { data?: CatalogProduct } | null;
      return res.ok && body?.data ? body.data : null;
    } catch {
      return null;
    }
  }

  async function patchProduct(
    id: string,
    payload: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    try {
      const res = await fetch(`/api/v1/admin/products/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: { code: string; message: string } }
        | null;
      if (res.ok) return { ok: true };
      return {
        ok: false,
        message: body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`,
      };
    } catch {
      return { ok: false, message: "নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি।" };
    }
  }

  async function startEdit(row: ProductRow, field: "price" | "stock") {
    editingRef.current = { id: row.id, field };
    setEditing({ id: row.id, field });
    setEditError("");
    setEditReason("");
    setEditProduct(null);
    if (field === "stock") {
      setDraft(String(row.stock));
      return;
    }
    // Price edits the FIRST variant (the editor's first row) — the
    // list cell shows the MINIMUM price, which may belong to another
    // variant, so prefill from a fresh full read, not from the row.
    setDraft("");
    setEditLoading(true);
    const full = await fetchFullProduct(row.id);
    setEditLoading(false);
    if (!full || full.variants.length === 0) {
      editingRef.current = null;
      setEditing(null);
      setNotice({ tone: "error", text: "পণ্যের বিবরণ লোড করা যায়নি — আবার চেষ্টা করুন।" });
      return;
    }
    setEditProduct(full);
    const base = full.variants[0];
    setDraft(
      base.pricePoisha % 100 === 0
        ? String(base.pricePoisha / 100)
        : (base.pricePoisha / 100).toFixed(2),
    );
  }

  function cancelEdit() {
    editingRef.current = null;
    setEditing(null);
    setEditProduct(null);
    setEditError("");
    setEditReason("");
  }

  async function savePrice(row: ProductRow) {
    if (editBusyRef.current) return;
    const session = editingRef.current;
    if (!session || session.id !== row.id || session.field !== "price") return;
    if (!editProduct || editProduct.variants.length === 0) return;
    const raw = draft.trim();
    const taka = Number(raw);
    if (raw === "" || !Number.isFinite(taka) || taka < 0) {
      setEditError("সঠিক দাম লিখুন (টাকায় — যেমন 1250 বা 1250.50)।");
      return;
    }
    const poisha = Math.round(taka * 100);
    const variants = toVariantInputs(editProduct);
    if (variants[0].pricePoisha === poisha) {
      cancelEdit();
      return;
    }
    if (editReason.trim() === "") {
      // Mirror the editor: a price change cannot save without the
      // audited reason — the inline prompt row below collects it.
      setEditError("দাম বদলেছে — সেভ করার আগে দাম বদলের কারণ লিখুন (অডিটে থাকবে)।");
      reasonRef.current?.focus();
      return;
    }
    variants[0].pricePoisha = poisha;
    editBusyRef.current = true;
    setEditBusy(true);
    setEditError("");
    const result = await patchProduct(row.id, { variants, reason: editReason.trim() });
    editBusyRef.current = false;
    setEditBusy(false);
    if (!result.ok) {
      setEditError(result.message);
      return;
    }
    cancelEdit();
    void load();
  }

  async function saveStock(row: ProductRow) {
    if (editBusyRef.current) return;
    // Blur-after-Escape lands here with a stale closure — the ref is
    // the source of truth for "this edit session is still live".
    const session = editingRef.current;
    if (!session || session.id !== row.id || session.field !== "stock") return;
    const raw = draft.trim();
    const next = Number(raw);
    if (raw === "" || !Number.isInteger(next) || next < 0) {
      setEditError("সঠিক স্টক সংখ্যা লিখুন (০ বা তার বেশি পূর্ণ সংখ্যা)।");
      return;
    }
    editBusyRef.current = true;
    setEditBusy(true);
    setEditError("");
    try {
      const full = await fetchFullProduct(row.id);
      if (!full || full.variants.length === 0) {
        setEditError("পণ্যের বিবরণ লোড করা যায়নি — আবার চেষ্টা করুন।");
        return;
      }
      const oldTotal = full.variants.reduce((s, v) => s + v.stock, 0);
      if (next === oldTotal) {
        cancelEdit();
        return;
      }
      // The cell edits the TOTAL: the delta lands on the first variant
      // (single-variant products — the common case — are exact). If
      // the first variant cannot absorb a decrease, refuse honestly
      // and point at the editor instead of inventing a rule.
      const delta = next - oldTotal;
      const variants = toVariantInputs(full);
      if (variants[0].stock + delta < 0) {
        setEditError(
          "একাধিক ভ্যারিয়েন্টের পণ্যে মোট স্টক এখান থেকে এতটা কমানো যাচ্ছে না — এডিট পেজ থেকে ভ্যারিয়েন্ট অনুযায়ী স্টক বদলান।",
        );
        return;
      }
      variants[0].stock += delta;
      const result = await patchProduct(row.id, { variants });
      if (!result.ok) {
        setEditError(result.message);
        return;
      }
      cancelEdit();
      void load();
    } finally {
      editBusyRef.current = false;
      setEditBusy(false);
    }
  }

  async function quickStatus(row: ProductRow, next: string) {
    if (next === row.status || statusBusyId) return;
    setStatusBusyId(row.id);
    setNotice(null);
    const result = await patchProduct(row.id, { status: next });
    setStatusBusyId(null);
    if (!result.ok) setNotice({ tone: "error", text: result.message });
    void load();
  }

  /* ------------------------- shared cell bits ------------------------ */

  const colSpan =
    2 + PICKER_COLUMNS.filter((c) => cols.isVisible(c.key)).length + (showActions ? 1 : 0);

  function renderPriceCell(row: ProductRow) {
    const isEditing = editing?.id === row.id && editing.field === "price";
    if (isEditing) {
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-text-subtle">৳</span>
          <input
            autoFocus
            value={draft}
            disabled={editLoading || editBusy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (editReason.trim() === "") {
                  setEditError("দাম বদলেছে — সেভ করার আগে নিচে দাম বদলের কারণ লিখুন (অডিটে থাকবে)।");
                  reasonRef.current?.focus();
                } else void savePrice(row);
              }
              if (e.key === "Escape") cancelEdit();
            }}
            inputMode="decimal"
            aria-label={`${row.title} — প্রথম ভ্যারিয়েন্টের দাম (টাকায়)`}
            className={cellInputCls}
          />
          {editLoading ? <span className="text-caption text-text-subtle">লোড হচ্ছে…</span> : null}
        </span>
      );
    }
    if (!canEdit) {
      return <span className="font-mono font-semibold tabular-nums">{formatBdt(row.pricePoisha)}</span>;
    }
    return (
      <span className="inline-flex flex-col">
        <button
          type="button"
          onClick={() => void startEdit(row, "price")}
          title="দাম দ্রুত বদলান (প্রথম ভ্যারিয়েন্ট)"
          className="rounded px-1 py-0.5 text-left font-mono font-semibold tabular-nums transition motion-fast hover:bg-brand-50 hover:text-brand-700"
        >
          {formatBdt(row.pricePoisha)}
        </button>
        {row.variantCount > 1 ? (
          <span className="px-1 text-caption text-text-subtle">সর্বনিম্ন · সম্পাদনা: প্রথম ভ্যারিয়েন্ট</span>
        ) : null}
      </span>
    );
  }

  function renderStockCell(row: ProductRow) {
    const isEditing = editing?.id === row.id && editing.field === "stock";
    if (isEditing) {
      return (
        <input
          autoFocus
          value={draft}
          disabled={editBusy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void saveStock(row);
            }
            if (e.key === "Escape") cancelEdit();
          }}
          onBlur={() => {
            if (!editBusy) void saveStock(row);
          }}
          inputMode="numeric"
          aria-label={`${row.title} — মোট স্টক`}
          className={cellInputCls}
        />
      );
    }
    const stockLabel = (
      <>
        <span className={`font-mono tabular-nums ${row.stock <= 0 ? "font-semibold text-rose-600" : ""}`}>
          {row.stock}
        </span>
        {row.stock <= 0 ? <span className="ml-1.5 text-caption text-rose-500">স্টক শেষ</span> : null}
      </>
    );
    if (!canEdit) return stockLabel;
    return (
      <button
        type="button"
        onClick={() => void startEdit(row, "stock")}
        title="মোট স্টক দ্রুত বদলান"
        className="rounded px-1 py-0.5 text-left transition motion-fast hover:bg-brand-50"
      >
        {stockLabel}
      </button>
    );
  }

  function renderStatusCell(row: ProductRow) {
    const meta = STATUS_META[row.status] ?? { label: row.status, tone: "neutral" as const };
    if (!canEdit) return <Badge tone={meta.tone}>{meta.label}</Badge>;
    return (
      <select
        value={row.status}
        disabled={statusBusyId === row.id}
        onChange={(e) => void quickStatus(row, e.target.value)}
        aria-label={`${row.title} — স্ট্যাটাস`}
        className="h-9 rounded-md border border-border bg-card px-2 text-small font-semibold shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:opacity-50"
      >
        {PRODUCT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_META[s].label}
          </option>
        ))}
      </select>
    );
  }

  function renderReasonRow(row: ProductRow) {
    if (!(editing?.id === row.id && editing.field === "price")) return null;
    return (
      <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-3">
        <label className="block text-small font-medium">
          দাম বদলের কারণ *{" "}
          <span className="text-text-subtle">(প্রথম ভ্যারিয়েন্টের দাম বদলাচ্ছে — কারণটি অডিট লগে থাকবে)</span>
        </label>
        <textarea
          ref={reasonRef}
          value={editReason}
          onChange={(e) => setEditReason(e.target.value)}
          rows={2}
          placeholder="যেমন: সরবরাহকারীর দাম বেড়েছে"
          className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        {editError ? (
          <p role="alert" className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-small text-rose-700">
            {editError}
          </p>
        ) : null}
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={() => void savePrice(row)}
            disabled={editBusy || editLoading}
            className="inline-flex min-h-[36px] items-center rounded-md bg-brand-600 px-4 text-small font-semibold text-white shadow-sm transition motion-fast hover:brightness-105 disabled:opacity-50"
          >
            {editBusy ? "সেভ হচ্ছে…" : "দাম সেভ করুন"}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={editBusy}
            className="inline-flex min-h-[36px] items-center rounded-md border border-border bg-card px-4 text-small font-semibold transition motion-fast hover:border-brand-300 disabled:opacity-50"
          >
            বাতিল
          </button>
        </div>
      </div>
    );
  }

  function renderRowActions(row: ProductRow) {
    if (!showActions) return null;
    return (
      <span className="inline-flex items-start justify-end gap-1">
        {canCreate ? (
          <DuplicateProductButton productId={row.id} productTitle={row.title} onDuplicated={() => void load()} />
        ) : null}
        {canDelete ? (
          <DeleteProductButton productId={row.id} productTitle={row.title} onDeleted={() => void load()} />
        ) : null}
      </span>
    );
  }

  /* ------------------------------ render ----------------------------- */

  const filtersActive = debouncedSearch !== "" || status !== "ALL" || category !== "";
  const catalogEmpty = !loading && !loadError && total === 0 && counts.ALL === 0 && !filtersActive;

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
          <select
            value={category}
            onChange={(e) => changeCategory(e.target.value)}
            aria-label="ক্যাটাগরি দিয়ে ছাঁকুন"
            className="h-11 max-w-[220px] rounded-md border border-border bg-card px-2.5 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="">সব ক্যাটাগরি</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.nameBn}
              </option>
            ))}
          </select>
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
                onClick={() => changeStatus(s)}
                aria-pressed={active}
                className={`flex min-h-[32px] items-center gap-1.5 rounded-full px-3 text-caption font-semibold transition motion-fast ${
                  active ? "bg-brand-600 text-white shadow-sm" : "border border-border bg-card text-text-muted hover:border-brand-300 hover:text-brand-700"
                }`}
              >
                {label}
                <span className={`font-mono tabular-nums ${active ? "text-white/85" : "text-text-subtle"}`}>
                  {counts[s] ?? "…"}
                </span>
              </button>
            );
          })}
          <span className="ml-auto text-caption text-text-muted">
            {loading ? "লোড হচ্ছে…" : `মোট ${total}টি পণ্য — পৃষ্ঠা ${page}/${totalPages}`}
          </span>
        </div>
        <div className="mt-3 border-t border-border pt-3">
          <SavedViewsBar<ProductViewState>
            views={views.views}
            ready={views.ready}
            currentState={{ search, status, sort, category }}
            onApply={applyView}
            onSave={views.saveView}
            onDelete={views.deleteView}
          />
        </div>
        <p className="mt-2 text-caption leading-relaxed text-text-subtle">{TABLE_PREFS_NOTE}</p>
      </Card>

      {selected.size > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50/70 px-4 py-3 shadow-card">
          <span className="text-small font-semibold">{selected.size}টি পণ্য নির্বাচিত</span>
          {canEdit ? (
            <>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void callBulk({ ids: [...selected], action: "status", status: "ACTIVE" })}
                className="inline-flex min-h-[36px] items-center rounded-md bg-emerald-600 px-3 text-small font-semibold text-white shadow-sm transition motion-fast hover:brightness-105 disabled:opacity-50"
              >
                সক্রিয় করুন
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void callBulk({ ids: [...selected], action: "status", status: "DRAFT" })}
                className="inline-flex min-h-[36px] items-center rounded-md border border-border bg-card px-3 text-small font-semibold transition motion-fast hover:border-brand-300 disabled:opacity-50"
              >
                খসড়া করুন
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void callBulk({ ids: [...selected], action: "status", status: "ARCHIVED" })}
                className="inline-flex min-h-[36px] items-center rounded-md border border-border bg-card px-3 text-small font-semibold transition motion-fast hover:border-brand-300 disabled:opacity-50"
              >
                আর্কাইভ
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => {
                  setBulkModalError("");
                  setPriceModal(true);
                }}
                className="inline-flex min-h-[36px] items-center rounded-md border border-border bg-card px-3 text-small font-semibold transition motion-fast hover:border-brand-300 disabled:opacity-50"
              >
                দাম সমন্বয়…
              </button>
            </>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => {
                setBulkDeleteError("");
                setDeleteModal(true);
              }}
              className="inline-flex min-h-[36px] items-center rounded-md px-3 text-small font-semibold text-rose-600 transition motion-fast hover:bg-rose-50 disabled:opacity-50"
            >
              মুছুন…
            </button>
          ) : null}
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => setSelected(new Set())}
            className="ml-auto inline-flex min-h-[36px] items-center rounded-md px-3 text-small font-semibold text-text-muted transition motion-fast hover:text-text-main disabled:opacity-50"
          >
            নির্বাচন বাতিল
          </button>
          {bulkBusy ? <span className="text-small text-text-muted">প্রসেস হচ্ছে…</span> : null}
        </div>
      ) : null}

      {bulkSummary ? (
        <div
          role="status"
          className={`mb-4 rounded-lg border px-4 py-3 shadow-card ${
            bulkSummary.failures.length === 0
              ? "border-emerald-200 bg-emerald-50"
              : "border-amber-200 bg-amber-50"
          }`}
        >
          <p className="text-small font-semibold">
            বাল্ক কাজ শেষ: {bulkSummary.ok}টি সফল
            {bulkSummary.failures.length > 0 ? `, ${bulkSummary.failures.length}টি ব্যর্থ` : ""}।
          </p>
          {bulkSummary.failures.length > 0 ? (
            <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-small text-rose-700">
              {bulkSummary.failures.map((f) => (
                <li key={f.id}>
                  {f.title} — {f.message}
                </li>
              ))}
            </ul>
          ) : null}
          <button
            type="button"
            onClick={() => setBulkSummary(null)}
            className="mt-2 text-caption font-semibold text-text-muted underline-offset-2 hover:underline"
          >
            বন্ধ করুন
          </button>
        </div>
      ) : null}

      {notice ? (
        <p
          role="alert"
          className={`mb-4 rounded-md px-3 py-2 text-small ${
            notice.tone === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {notice.text}
        </p>
      ) : null}

      {loadError ? (
        <div className="rounded-lg border border-border bg-card px-6 py-14 text-center shadow-card">
          <h2 className="text-h3">তালিকা লোড করা যায়নি</h2>
          <p className="mx-auto mt-1 max-w-md text-small leading-relaxed text-rose-600">{loadError}</p>
          <Button variant="outline" className="mt-5" onClick={() => void load()}>
            আবার চেষ্টা করুন
          </Button>
        </div>
      ) : catalogEmpty ? (
        <div className="rounded-lg border border-border bg-card px-6 py-14 text-center shadow-card">
          <span aria-hidden="true" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
            </svg>
          </span>
          <h2 className="mt-4 text-h3">কোনো পণ্য নেই</h2>
          <p className="mx-auto mt-1 max-w-md text-small leading-relaxed text-text-muted">
            ক্যাটালগে এখনো কোনো পণ্য যোগ হয়নি — নতুন পণ্য যোগ করলেই এখানে দেখা যাবে।
          </p>
          <Link
            href="/admin/products/new"
            className="brand-gradient mt-5 inline-flex min-h-[44px] items-center justify-center rounded-md px-4 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105"
          >
            + নতুন পণ্য যোগ করুন
          </Link>
        </div>
      ) : !loading && rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-6 py-14 text-center shadow-card">
          <h2 className="text-h3">কোনো পণ্য পাওয়া যায়নি</h2>
          <p className="mx-auto mt-1 max-w-md text-small leading-relaxed text-text-muted">
            এই ফিল্টার/খোঁজে ক্যাটালগে কোনো পণ্য নেই। ফিল্টার বদলে আবার দেখুন।
          </p>
          <Button
            variant="outline"
            className="mt-5"
            onClick={() => {
              changeStatus("ALL");
              setSearch("");
              changeCategory("");
            }}
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
                  <th scope="col" className="w-10 px-3 py-3">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={(e) => togglePage(e.target.checked)}
                      aria-label="এই পৃষ্ঠার সব পণ্য নির্বাচন করুন"
                      className="h-4 w-4 rounded accent-[#4F46E5]"
                    />
                  </th>
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
                  {showActions && (
                    <th scope="col" className="px-4 py-3 text-right text-caption font-semibold text-text-muted">অ্যাকশন</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((p) => (
                  <Fragment key={p.id}>
                    <tr
                      className={`border-t border-border transition motion-fast first:border-t-0 hover:bg-surface-2/70 ${
                        selected.has(p.id) ? "bg-brand-50/50" : ""
                      }`}
                    >
                      <td className="px-3 py-3 align-top">
                        <input
                          type="checkbox"
                          checked={selected.has(p.id)}
                          onChange={(e) => toggleRow(p.id, e.target.checked)}
                          aria-label={`${p.title} নির্বাচন করুন`}
                          className="h-4 w-4 rounded accent-[#4F46E5]"
                        />
                      </td>
                      <td className="min-w-0 px-4 py-3 align-top">
                        <Link
                          href={`/admin/products/${p.id}`}
                          className="block break-words font-medium leading-snug text-brand-700 underline-offset-2 transition motion-fast [overflow-wrap:anywhere] hover:underline"
                        >
                          {p.title}
                        </Link>
                        <Link
                          href={`/admin/products/${p.id}`}
                          className="font-mono text-caption text-text-subtle underline-offset-2 transition motion-fast hover:text-brand-700 hover:underline"
                        >
                          /{p.slug}
                        </Link>
                      </td>
                      {cols.isVisible("price") ? (
                        <td className="px-4 py-3 align-top">{renderPriceCell(p)}</td>
                      ) : null}
                      {cols.isVisible("stock") ? (
                        <td className="px-4 py-3 align-top">{renderStockCell(p)}</td>
                      ) : null}
                      {cols.isVisible("status") ? (
                        <td className="px-4 py-3 align-top">{renderStatusCell(p)}</td>
                      ) : null}
                      {showActions && (
                        <td className="px-4 py-3 text-right align-top">{renderRowActions(p)}</td>
                      )}
                    </tr>
                    {editing?.id === p.id && editing.field === "price" ? (
                      <tr className="border-t border-border bg-surface-2/50">
                        <td colSpan={colSpan} className="px-4 py-3">
                          {renderReasonRow(p)}
                        </td>
                      </tr>
                    ) : null}
                    {editing?.id === p.id && editing.field === "stock" && editError ? (
                      <tr className="border-t border-border bg-surface-2/50">
                        <td colSpan={colSpan} className="px-4 py-3">
                          <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-small text-rose-700">
                            {editError}
                          </p>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list (under md) — always shows every field;
           *  column choices above apply to the desktop table only. */}
          <div className="space-y-3 md:hidden">
            {displayRows.map((p) => (
              <article key={p.id} className="rounded-lg border border-border bg-card p-4 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      onChange={(e) => toggleRow(p.id, e.target.checked)}
                      aria-label={`${p.title} নির্বাচন করুন`}
                      className="mt-1 h-4 w-4 shrink-0 rounded accent-[#4F46E5]"
                    />
                    <div className="min-w-0">
                      <Link
                        href={`/admin/products/${p.id}`}
                        className="block break-words font-medium leading-snug text-brand-700 underline-offset-2 [overflow-wrap:anywhere] hover:underline"
                      >
                        {p.title}
                      </Link>
                      <Link
                        href={`/admin/products/${p.id}`}
                        className="mt-0.5 block font-mono text-caption text-text-subtle underline-offset-2 hover:text-brand-700 hover:underline"
                      >
                        /{p.slug}
                      </Link>
                    </div>
                  </div>
                  {renderStatusCell(p)}
                </div>
                <div className="mt-3 flex items-start gap-4 border-t border-border pt-3 text-small">
                  <span>
                    <span className="block text-caption text-text-subtle">দাম (থেকে)</span>
                    {renderPriceCell(p)}
                  </span>
                  <span>
                    <span className="block text-caption text-text-subtle">স্টক</span>
                    {renderStockCell(p)}
                  </span>
                  {showActions ? <span className="ml-auto">{renderRowActions(p)}</span> : null}
                </div>
                {editing?.id === p.id && editing.field === "price" ? (
                  <div className="mt-3">{renderReasonRow(p)}</div>
                ) : null}
                {editing?.id === p.id && editing.field === "stock" && editError ? (
                  <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-small text-rose-700">
                    {editError}
                  </p>
                ) : null}
              </article>
            ))}
          </div>

          {/* Pager */}
          <nav aria-label="পণ্য তালিকার পৃষ্ঠা" className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-caption text-text-muted">
              মোট {total}টি পণ্যের মধ্যে এই পৃষ্ঠায় {rows.length}টি — পৃষ্ঠা {page} / {totalPages}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex min-h-[36px] items-center rounded-md border border-border bg-card px-3 text-small font-semibold transition motion-fast hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ← আগের
              </button>
              {pageList(page, totalPages).map((n, i) =>
                n === "…" ? (
                  <span key={`gap-${i}`} className="px-1 text-text-subtle">
                    …
                  </span>
                ) : (
                  <button
                    key={n}
                    type="button"
                    disabled={loading}
                    onClick={() => setPage(n)}
                    aria-current={n === page ? "page" : undefined}
                    className={`inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md px-2 text-small font-semibold tabular-nums transition motion-fast disabled:opacity-50 ${
                      n === page
                        ? "bg-brand-600 text-white shadow-sm"
                        : "border border-border bg-card hover:border-brand-300 hover:text-brand-700"
                    }`}
                  >
                    {n}
                  </button>
                ),
              )}
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex min-h-[36px] items-center rounded-md border border-border bg-card px-3 text-small font-semibold transition motion-fast hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                পরের →
              </button>
            </div>
          </nav>
        </>
      )}

      {/* Bulk price-adjust modal — percent + the audited reason the
       *  service's price-change rule demands. */}
      <Modal
        open={priceModal}
        onClose={() => {
          if (!bulkBusy) setPriceModal(false);
        }}
        title="দাম সমন্বয় (বাল্ক)"
        onConfirm={confirmBulkPrice}
      >
        <p className="text-small leading-relaxed">
          নির্বাচিত <strong>{selected.size}টি</strong> পণ্যের <strong>সব ভ্যারিয়েন্টের</strong> দাম শতাংশ
          হারে বদলাবে। নতুন দাম নিকটতম পয়সায় রাউন্ড হবে।
        </p>
        <label className="mb-1.5 mt-4 block text-small font-medium" htmlFor="bulk-percent">
          শতাংশ (%, যেমন 10 = ১০% বৃদ্ধি, -5 = ৫% ছাড়)
        </label>
        <input
          id="bulk-percent"
          value={bulkPercent}
          onChange={(e) => setBulkPercent(e.target.value)}
          inputMode="decimal"
          placeholder="10"
          className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        <label className="mb-1.5 mt-4 block text-small font-medium" htmlFor="bulk-price-reason">
          দাম বদলের কারণ * <span className="text-text-subtle">(অডিট লগে থাকবে)</span>
        </label>
        <input
          id="bulk-price-reason"
          value={bulkReason}
          onChange={(e) => setBulkReason(e.target.value)}
          placeholder="যেমন: সরবরাহকারীর দাম বেড়েছে"
          className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        {bulkModalError ? (
          <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-small text-rose-700">
            {bulkModalError}
          </p>
        ) : null}
      </Modal>

      {/* Bulk delete modal — reason required, same rule as single delete. */}
      <Modal
        open={deleteModal}
        onClose={() => {
          if (!bulkBusy) setDeleteModal(false);
        }}
        title="নির্বাচিত পণ্য মুছে ফেলুন"
        onConfirm={confirmBulkDelete}
      >
        <p className="text-small leading-relaxed">
          নির্বাচিত <strong>{selected.size}টি</strong> পণ্য সফট-ডিলিট হবে: স্টোরফ্রন্ট ও সার্চ থেকে সরে
          যাবে, ভ্যারিয়েন্টগুলো আর অর্ডার করা যাবে না। পুরনো অর্ডারের ইতিহাসে তথ্য থেকে যাবে (হার্ড
          ডিলিট হয় না)।
        </p>
        <label className="mb-1.5 mt-4 block text-small font-medium" htmlFor="bulk-delete-reason">
          মুছে ফেলার কারণ (আবশ্যক)
        </label>
        <input
          id="bulk-delete-reason"
          value={bulkDeleteReason}
          onChange={(e) => setBulkDeleteReason(e.target.value)}
          placeholder="যেমন: পণ্যের লাইন বন্ধ হয়ে গেছে"
          className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        {bulkDeleteError ? (
          <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-small text-rose-700">
            {bulkDeleteError}
          </p>
        ) : null}
      </Modal>
    </>
  );
}

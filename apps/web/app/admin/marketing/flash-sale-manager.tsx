"use client";

// Flash sale manager — real DB-backed admin UI (2026-10-25).
// Lists sales from GET /api/v1/admin/flash-sales and writes through
// the same API (POST create, PUT full-replace update, PATCH isActive
// toggle, DELETE soft delete). The API's answer is shown as-is — this
// component never claims success on its own. All times are entered
// and shown in Bangladesh time (Asia/Dhaka, fixed +06:00); the API
// stores UTC instants. Prices are entered in টাকা and sent as
// integer poisha.
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatPoisha } from "@/components/ui/money";
import {
  flashSaleStatus,
  remainingFlashStock,
  type FlashSaleWithItems,
} from "@/marketing/flash-sale";

export interface FlashSalePickerVariant {
  id: string;
  sku: string;
  attributesLabel: string;
  pricePoisha: number;
  stock: number;
  isActive: boolean;
}

export interface FlashSalePickerProduct {
  id: string;
  titleBn: string;
  titleEn: string;
  slug: string;
  status: string;
  variants: FlashSalePickerVariant[];
}

interface ItemRow {
  productId: string;
  variantId: string;
  salePriceTaka: string;
  stockCap: string;
}

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

function isoToDhakaLocal(iso: string): string {
  const d = new Date(Date.parse(iso) + DHAKA_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function dhakaLocalToIso(local: string): string {
  return new Date(`${local}:00+06:00`).toISOString();
}

function formatDhaka(iso: string): string {
  return new Intl.DateTimeFormat("bn-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

const STATUS_META: Record<string, { label: string; tone: "success" | "info" | "neutral" | "warning" }> = {
  live: { label: "চলমান", tone: "success" },
  upcoming: { label: "আসন্ন", tone: "info" },
  ended: { label: "শেষ", tone: "neutral" },
  inactive: { label: "বন্ধ", tone: "warning" },
};

const inputClass = "mt-1 min-h-[44px] w-full rounded-xl border border-border bg-card px-3 py-2 text-text-main";

export default function FlashSaleManager({
  initialSales,
  dbReady,
  products,
}: {
  initialSales: FlashSaleWithItems[];
  dbReady: boolean;
  products: FlashSalePickerProduct[];
}) {
  const [sales, setSales] = useState<FlashSaleWithItems[]>(initialSales);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [startsLocal, setStartsLocal] = useState("");
  const [endsLocal, setEndsLocal] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [itemRows, setItemRows] = useState<ItemRow[]>([]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const nowIso = new Date().toISOString();

  async function refresh() {
    try {
      const res = await fetch("/api/v1/admin/flash-sales");
      const data = (await res.json().catch(() => ({}))) as {
        data?: { flashSales?: FlashSaleWithItems[] };
      };
      if (res.ok && data.data?.flashSales) setSales(data.data.flashSales);
    } catch {
      // Keep the current list; the next action will surface errors.
    }
  }

  async function callApi(run: () => Promise<Response>, okMessage: string) {
    setBusy(true);
    setStatus(null);
    try {
      const res = await run();
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (res.ok) {
        setStatus(okMessage);
        await refresh();
        return true;
      }
      setStatus(data.error?.message ?? `ব্যর্থ হয়েছে (${res.status}) — কিছুই সংরক্ষিত হয়নি।`);
      return false;
    } catch {
      setStatus("নেটওয়ার্ক ত্রুটি — কিছুই সংরক্ষিত হয়নি।");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    const now = Date.now();
    setEditingId(null);
    setName("");
    setStartsLocal(isoToDhakaLocal(new Date(now).toISOString()));
    setEndsLocal(isoToDhakaLocal(new Date(now + 24 * 60 * 60 * 1000).toISOString()));
    setIsActive(true);
    setItemRows([]);
    setFormOpen(true);
  }

  function openEdit(sale: FlashSaleWithItems) {
    setEditingId(sale.id);
    setName(sale.name);
    setStartsLocal(isoToDhakaLocal(sale.startsAt));
    setEndsLocal(isoToDhakaLocal(sale.endsAt));
    setIsActive(sale.isActive);
    setItemRows(
      sale.items.map((item) => ({
        productId: item.productId,
        variantId: item.variantId,
        salePriceTaka: String(item.salePricePoisha / 100),
        stockCap: String(item.stockCap),
      })),
    );
    setFormOpen(true);
  }

  function addItemRow() {
    const first = products.find((p) => p.variants.length > 0);
    if (!first) return;
    setItemRows((rows) => [
      ...rows,
      {
        productId: first.id,
        variantId: first.variants[0].id,
        salePriceTaka: String(first.variants[0].pricePoisha / 100),
        stockCap: "10",
      },
    ]);
  }

  function updateRow(index: number, patch: Partial<ItemRow>) {
    setItemRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function changeRowProduct(index: number, productId: string) {
    const product = productById.get(productId);
    const variant = product?.variants[0];
    updateRow(index, {
      productId,
      variantId: variant?.id ?? "",
      salePriceTaka: variant ? String(variant.pricePoisha / 100) : "",
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (itemRows.length === 0) {
      setStatus("অন্তত একটি আইটেম যোগ করুন।");
      return;
    }
    const items = itemRows.map((r) => ({
      productId: r.productId,
      variantId: r.variantId,
      salePricePoisha: Math.round(Number.parseFloat(r.salePriceTaka) * 100),
      stockCap: Number.parseInt(r.stockCap, 10),
    }));
    if (items.some((i) => !i.variantId || !Number.isFinite(i.salePricePoisha) || !Number.isFinite(i.stockCap))) {
      setStatus("আইটেমের দাম ও স্টক ক্যাপ ঠিকমতো দিন।");
      return;
    }
    const body = {
      name: name.trim(),
      startsAt: dhakaLocalToIso(startsLocal),
      endsAt: dhakaLocalToIso(endsLocal),
      isActive,
      items,
    };
    const ok = await callApi(
      () =>
        fetch(editingId ? `/api/v1/admin/flash-sales/${editingId}` : "/api/v1/admin/flash-sales", {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      editingId ? "ফ্ল্যাশ সেল হালনাগাদ হয়েছে।" : "ফ্ল্যাশ সেল তৈরি হয়েছে।",
    );
    if (ok) setFormOpen(false);
  }

  async function toggleActive(sale: FlashSaleWithItems) {
    await callApi(
      () =>
        fetch(`/api/v1/admin/flash-sales/${sale.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: !sale.isActive }),
        }),
      sale.isActive ? "ফ্ল্যাশ সেল বন্ধ করা হয়েছে।" : "ফ্ল্যাশ সেল সক্রিয় করা হয়েছে।",
    );
  }

  async function removeSale(sale: FlashSaleWithItems) {
    const ok = await callApi(
      () => fetch(`/api/v1/admin/flash-sales/${sale.id}`, { method: "DELETE" }),
      "ফ্ল্যাশ সেল মুছে ফেলা হয়েছে।",
    );
    if (ok) setConfirmDeleteId(null);
  }

  if (!dbReady) {
    return (
      <Card>
        <h3 className="font-semibold text-text-main">ফ্ল্যাশ সেল</h3>
        <p className="mt-2 text-sm text-text-muted">
          ডাটাবেস পাওয়া যাচ্ছে না — ফ্ল্যাশ সেলের তালিকা লোড হয়নি। ডাটাবেস চালু হলে এই অংশে আসল
          তালিকা ও ফর্ম দেখা যাবে।
        </p>
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={openCreate} disabled={busy}>
          নতুন ফ্ল্যাশ সেল
        </Button>
        {status ? (
          <p role="status" className="text-sm text-text-muted">
            {status}
          </p>
        ) : null}
      </div>

      {formOpen ? (
        <Card className="mb-6">
          <h3 className="mb-1 font-semibold text-text-main">{editingId ? "ফ্ল্যাশ সেল সম্পাদনা" : "নতুন ফ্ল্যাশ সেল"}</h3>
          <p className="mb-4 text-xs text-text-muted">
            সব সময় বাংলাদেশ সময় (Asia/Dhaka) অনুযায়ী। আইটেম বদলালে পুরো আইটেম তালিকা নতুন করে
            সংরক্ষিত হয়; বিক্রির হিসাব (soldCount) এখান থেকে বদলানো যায় না।
          </p>
          <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              সেলের নাম
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="যেমন: ঈদ ফ্ল্যাশ সেল"
                required
              />
            </label>
            <label className="text-sm">
              শুরু (বাংলাদেশ সময়)
              <input
                className={inputClass}
                type="datetime-local"
                value={startsLocal}
                onChange={(e) => setStartsLocal(e.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              শেষ (বাংলাদেশ সময়)
              <input
                className={inputClass}
                type="datetime-local"
                value={endsLocal}
                onChange={(e) => setEndsLocal(e.target.value)}
                required
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4"
              />
              সক্রিয় রাখুন
            </label>

            <div className="sm:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">আইটেমসমূহ</span>
                <Button type="button" variant="outline" size="sm" onClick={addItemRow} disabled={products.length === 0}>
                  আইটেম যোগ করুন
                </Button>
              </div>
              {products.length === 0 ? (
                <p className="text-sm text-text-muted">
                  ক্যাটালগে কোনো পণ্য নেই — আগে পণ্য যোগ করুন, তারপর ফ্ল্যাশ সেল তৈরি করা যাবে।
                </p>
              ) : null}
              <div className="grid gap-3">
                {itemRows.map((row, i) => {
                  const product = productById.get(row.productId);
                  return (
                    <div key={i} className="grid gap-3 rounded-2xl border border-border/60 bg-surface-2/50 p-4 sm:grid-cols-2">
                      <label className="text-sm">
                        পণ্য
                        <select
                          className={inputClass}
                          value={row.productId}
                          onChange={(e) => changeRowProduct(i, e.target.value)}
                        >
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.titleBn} ({p.status})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm">
                        ভ্যারিয়েন্ট
                        <select
                          className={inputClass}
                          value={row.variantId}
                          onChange={(e) => updateRow(i, { variantId: e.target.value })}
                        >
                          {(product?.variants ?? []).map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.sku}
                              {v.attributesLabel ? ` — ${v.attributesLabel}` : ""} —{" "}
                              {formatPoisha(v.pricePoisha)} — স্টক {v.stock}
                              {v.isActive ? "" : " (বন্ধ)"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-sm">
                        ফ্ল্যাশ দাম (টাকা)
                        <input
                          className={inputClass}
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.salePriceTaka}
                          onChange={(e) => updateRow(i, { salePriceTaka: e.target.value })}
                          required
                        />
                      </label>
                      <label className="text-sm">
                        স্টক ক্যাপ
                        <input
                          className={inputClass}
                          type="number"
                          min={1}
                          value={row.stockCap}
                          onChange={(e) => updateRow(i, { stockCap: e.target.value })}
                          required
                        />
                      </label>
                      <div className="sm:col-span-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setItemRows((rows) => rows.filter((_, j) => j !== i))}
                        >
                          আইটেম সরান
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? "সংরক্ষণ হচ্ছে…" : editingId ? "হালনাগাদ করুন" : "ফ্ল্যাশ সেল তৈরি করুন"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setFormOpen(false)} disabled={busy}>
                বাতিল
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {sales.length === 0 ? (
        <Card>
          <p className="text-sm text-text-muted">
            এখনো কোনো ফ্ল্যাশ সেল নেই। "নতুন ফ্ল্যাশ সেল" দিয়ে প্রথম সেল তৈরি করুন — সময় হলে তা
            স্টোরফ্রন্টে স্বয়ংক্রিয়ভাবে দেখা যাবে।
          </p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {sales.map((sale) => {
            const st = flashSaleStatus(sale, nowIso);
            const meta = STATUS_META[st];
            const soldTotal = sale.items.reduce((sum, i) => sum + i.soldCount, 0);
            const capTotal = sale.items.reduce((sum, i) => sum + i.stockCap, 0);
            const pct = capTotal > 0 ? Math.min(100, Math.round((soldTotal / capTotal) * 100)) : 0;
            return (
              <Card key={sale.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-text-main">{sale.name}</h3>
                    <p className="mt-1 text-sm text-text-muted">
                      {formatDhaka(sale.startsAt)} → {formatDhaka(sale.endsAt)} (বাংলাদেশ সময়)
                    </p>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>

                <ul className="mt-3 grid gap-1.5 text-sm">
                  {sale.items.map((item) => (
                    <li key={item.id} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{item.productTitleBn}</span>
                      <span className="font-mono text-xs text-text-muted">{item.variantSku}</span>
                      <span className="tnum font-mono">{formatPoisha(item.salePricePoisha)}</span>
                      {item.regularPricePoisha > item.salePricePoisha ? (
                        <span className="tnum font-mono text-xs text-text-subtle line-through">
                          {formatPoisha(item.regularPricePoisha)}
                        </span>
                      ) : null}
                      <span className="text-xs text-text-muted">
                        বিক্রি {item.soldCount} / {item.stockCap} (বাকি {remainingFlashStock(item)})
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
                  <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
                </div>
                <p className="tnum mt-1 text-xs text-text-muted">
                  মোট বিক্রি {soldTotal} / {capTotal}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => openEdit(sale)} disabled={busy}>
                    সম্পাদনা
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => toggleActive(sale)} disabled={busy}>
                    {sale.isActive ? "বন্ধ করুন" : "সক্রিয় করুন"}
                  </Button>
                  {confirmDeleteId === sale.id ? (
                    <>
                      <Button type="button" variant="destructive" size="sm" onClick={() => removeSale(sale)} disabled={busy}>
                        নিশ্চিত মুছুন
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)} disabled={busy}>
                        থাক
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDeleteId(sale.id)}
                      disabled={busy}
                    >
                      মুছুন
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

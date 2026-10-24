// Product editor skeleton — Step 9 contract.
// Client component only for tab/variant UI state. Save wiring (Step 8/9):
//   POST /api/v1/admin/products with Zod validation, audit log, and
//   stock_movements ledger for initial stock — never a direct stock write.
// Cost price field is shown here for staff with products.edit_cost_price permission;
// Step 4 RBAC must hide it server-side for staff without that permission.
"use client";

import { useMemo, useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { generateVariantDrafts, validateVariantDrafts } from "@/catalog/variants";
import type { ProductAttribute } from "@/catalog/types";

type Tab = "basic" | "media" | "variants" | "seo";

const QUALITY_CHECKLIST = [
  { key: "title", label: "টাইটেল (বাংলা + English)" },
  { key: "image", label: "কমপক্ষে ১টি ছবি (WebP/AVIF)" },
  { key: "description", label: "বিবরণ (বাংলা + English)" },
  { key: "price", label: "দাম + স্টক (poisha-তে)" },
  { key: "seo", label: "SEO: slug + meta" },
];

export default function NewProductPage() {
  const [tab, setTab] = useState<Tab>("basic");
  const [titleBn, setTitleBn] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [slug, setSlug] = useState("");
  const [priceTaka, setPriceTaka] = useState("");
  const [costTaka, setCostTaka] = useState("");
  const [descriptionBn, setDescriptionBn] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [categorySlug, setCategorySlug] = useState("fashion");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [attrInput, setAttrInput] = useState("color: লাল, নীল\nsize: M, L");

  const attributes: ProductAttribute[] = useMemo(() => {
    return attrInput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, rest] = line.split(":");
        return {
          key: (key ?? "").trim(),
          label: { bn: (key ?? "").trim(), en: (key ?? "").trim() },
          values: (rest ?? "").split(",").map((v) => v.trim()).filter(Boolean),
        };
      })
      .filter((a) => a.key && a.values.length > 0);
  }, [attrInput]);

  const pricePoisha = useMemo(() => {
    const n = Number(priceTaka);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
  }, [priceTaka]);
  const costPoisha = useMemo(() => {
    const n = Number(costTaka);
    return costTaka === "" ? null : Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
  }, [costTaka]);

  const drafts = useMemo(
    () => generateVariantDrafts(slug || "new-product", attributes, { pricePoisha, costPoisha }),
    [slug, attributes, pricePoisha, costPoisha],
  );
  const errors = validateVariantDrafts(drafts);

  const qualityDone = {
    title: Boolean(titleBn && titleEn),
    image: false, // media upload lands in Step 9 (see src/catalog/media.ts pipeline)
    description: Boolean(descriptionBn && descriptionEn),
    price: pricePoisha > 0,
    seo: Boolean(slug),
  };

  // Save wiring (Agent 8): POST /api/v1/admin/products.
  // Server validates with Zod, checks slug/SKU uniqueness, writes an
  // audit log, and records initial stock as ledger entries only.
  // Until catalog tables are migrated + Prisma is generated, the API
  // returns 503 DB_NOT_READY — that message is shown, never hidden.
  async function handleSave() {
    setSaveStatus("saving");
    setSaveErrors([]);
    setSaveMessage("");
    try {
      const res = await fetch("/api/v1/admin/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          titleBn,
          titleEn,
          descriptionBn,
          descriptionEn,
          categorySlug,
          status: "DRAFT",
          tags: [],
          images: [],
          variants: drafts.map((d) => ({
            attributes: d.attributes,
            sku: d.sku,
            barcode: d.barcode,
            pricePoisha: d.pricePoisha,
            compareAtPoisha: d.compareAtPoisha,
            costPoisha: d.costPoisha,
            stock: d.stock,
            imageUrl: d.imageUrl,
            isActive: true,
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: { product?: { id?: string }; ledgerPending?: boolean };
        error?: { code?: string; message?: string; details?: unknown };
      };
      if (!res.ok) {
        setSaveStatus("error");
        const details = Array.isArray(data.error?.details)
          ? (data.error?.details as { field?: string; message?: string }[]).map(
              (d) => `${d.field ?? "field"}: ${d.message ?? "invalid"}`,
            )
          : [];
        setSaveErrors(details);
        setSaveMessage(data.error?.message ?? "Save failed.");
        return;
      }
      setSaveStatus("saved");
      setSaveMessage(
        data.data?.ledgerPending
          ? "পণ্য সেভ হয়েছে, কিন্তু stock ledger এখনো pending — StockMovement table migrate হলে ledger write হবে।"
          : "পণ্য সেভ হয়েছে (Draft)।",
      );
    } catch {
      setSaveStatus("error");
      setSaveMessage("Network error — API-তে পৌঁছানো যায়নি।");
    }
  }

  return (
    <main className="min-w-0">
      <h1 className="text-xl font-bold">নতুন পণ্য</h1>
      <p className="mt-1 text-sm text-slate-500">সেভ wired: POST /api/v1/admin/products — Zod validation, slug/SKU check, audit log, stock ledger (initial stock)। DB migrate না হলে API 503 DB_NOT_READY দেবে, সেটা নিচে দেখানো হবে।</p>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist">
        {(["basic", "media", "variants", "seo"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm ${tab === t ? "bg-[#4F46E5] text-white" : "border"}`}
          >
            {t === "basic" ? "বেসিক" : t === "media" ? "মিডিয়া" : t === "variants" ? "ভেরিয়েন্ট" : "SEO"}
          </button>
        ))}
      </div>

      {tab === "basic" && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            টাইটেল (বাংলা)
            <input value={titleBn} onChange={(e) => setTitleBn(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="যেমন: জামদানি শাড়ি" />
          </label>
          <label className="block text-sm">
            Title (English)
            <input value={titleEn} onChange={(e) => setTitleEn(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="e.g. Jamdani Sharee" />
          </label>
          <label className="block text-sm">
            Slug
            <input value={slug} onChange={(e) => setSlug(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="jamdani-sharee" />
          </label>
          <label className="block text-sm">
            দাম (৳) — ভেতরে poisha-তে যাবে
            <input value={priceTaka} onChange={(e) => setPriceTaka(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="4500" />
            <span className="text-xs text-slate-500">Poisha: {pricePoisha} • দেখাবে: {formatBdt(pricePoisha)}</span>
          </label>
          <label className="block text-sm">
            Cost price (৳) — staff permission ছাড়া দেখা যাবে না (Step 4)
            <input value={costTaka} onChange={(e) => setCostTaka(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="3000" />
          </label>
          <label className="block text-sm">
            Category slug
            <input value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="fashion" />
          </label>
          <label className="block text-sm md:col-span-2">
            বিবরণ (বাংলা)
            <textarea value={descriptionBn} onChange={(e) => setDescriptionBn(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="পণ্যের বাংলা বিবরণ" />
          </label>
          <label className="block text-sm md:col-span-2">
            Description (English)
            <textarea value={descriptionEn} onChange={(e) => setDescriptionEn(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="Product description in English" />
          </label>
        </div>
      )}

      {tab === "media" && (
        <div className="mt-4 rounded-xl border p-4 text-sm">
          <p>মিডিয়া গ্যালারি (Step 9): drag-reorder, WebP/AVIF auto-convert, thumbnail, alt text (bn/en)।</p>
          <p className="mt-2 text-slate-500">এই skeleton-এ আপলোড এখনো নেই — R2 + CDN pipeline Step 9-এ আসবে।</p>
        </div>
      )}

      {tab === "variants" && (
        <div className="mt-4">
          <label className="block text-sm">
            Attribute (প্রতি লাইনে key: value, value — যেমন color: লাল, নীল)
            <textarea value={attrInput} onChange={(e) => setAttrInput(e.target.value)} rows={4} className="mt-1 w-full rounded-lg border px-3 py-2 font-mono text-sm" />
          </label>
          {errors.length > 0 && (
            <ul className="mt-3 text-sm text-red-600">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
          <div className="mt-3 overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="bg-[#F8F9FD]">
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Attribute</th>
                  <th className="px-3 py-2">দাম</th>
                  <th className="px-3 py-2">স্টক</th>
                  <th className="px-3 py-2">ছবি</th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.sku} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{d.sku}</td>
                    <td className="px-3 py-2">{Object.entries(d.attributes).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}</td>
                    <td className="px-3 py-2">{formatBdt(d.pricePoisha)}</td>
                    <td className="px-3 py-2">{d.stock}</td>
                    <td className="px-3 py-2 text-slate-500">Step 9-এ per-variant ছবি</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "seo" && (
        <div className="mt-4 rounded-xl border p-4 text-sm">
          <p>SEO (Step 9/11): meta title/description (bn/en), OG image, schema.org Product, canonical, sitemap-এ auto-include।</p>
          <p className="mt-2">বর্তমান slug: <span className="font-mono">/product/{slug || "…"}</span></p>
        </div>
      )}

      <div className="mt-6 rounded-xl border p-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saveStatus === "saving" || errors.length > 0}
          className="rounded-lg bg-[#4F46E5] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saveStatus === "saving" ? "সেভ হচ্ছে…" : "পণ্য সেভ করুন (Draft)"}
        </button>
        {saveMessage && (
          <p role="status" className={`mt-3 text-sm ${saveStatus === "error" ? "text-red-600" : "text-emerald-700"}`}>
            {saveMessage}
          </p>
        )}
        {saveErrors.length > 0 && (
          <ul className="mt-2 text-sm text-red-600">
            {saveErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded-xl border p-4">
        <h2 className="font-semibold">Product quality score (checklist)</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {QUALITY_CHECKLIST.map((item) => (
            <li key={item.key}>
              {qualityDone[item.key as keyof typeof qualityDone] ? "✅" : "⬜"} {item.label}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

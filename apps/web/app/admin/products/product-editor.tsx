"use client";

// Shared admin product editor — used by BOTH the create page
// (app/admin/products/new) and the edit page
// (app/admin/products/[id]). Every control maps to the real catalog
// API contract (productInputSchema for POST, productUpdateSchema for
// PATCH — see src/catalog/service.ts):
//   - Money is entered in TAKA (decimal) and converted to integer
//     poisha for the API; edit mode pre-fills taka back from poisha.
//   - Category is a real <select> over the live category list; the API
//     resolves categorySlug server-side. No free-text slug anywhere.
//   - Brand is free text with a datalist of existing brand names — the
//     server find-or-creates the Brand row by name. Tags are a
//     comma-separated input mapped to string[].
//   - Variants start from the attribute-lines generator
//     (src/catalog/variants.ts, merged by SKU) plus manual rows, and
//     every row is EDITABLE: price / compare-at / cost / stock /
//     barcode / image URL / active. On PATCH the API upserts variants
//     by SKU, soft-deletes dropped ones, and books stock deltas in the
//     stock_movements ledger.
//   - Images are URL rows (url + alt bn/en + up/down ordering); on
//     PATCH the API replaces the image set inside the transaction.
//     File UPLOAD is P1 — this editor never pretends to upload.
//   - Price-change rule: when any EXISTING variant's price differs
//     from the loaded price, PATCH requires `reason`
//     (products.price_change audit). The editor detects the change
//     (same SKU-match rule the service uses) and collects the reason
//     inline before saving.
// Cost price stays visible to all staff in this form, matching the
// editor's long-standing behaviour; field-level hiding is a separate
// RBAC item and is deliberately not invented here.

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatBdt } from "@advance-ecommerce/validators";
import { generateVariantDrafts, validateVariantDrafts } from "@/catalog/variants";
import type { Product, ProductAttribute, ProductStatus } from "@/catalog/types";

export interface CategoryOption {
  slug: string;
  nameBn: string;
  nameEn: string;
}

interface VariantRow {
  key: number;
  /** SKU as loaded from the server (null = row created in this session). */
  originalSku: string | null;
  originalPricePoisha: number | null;
  originalStock: number | null;
  attributes: Record<string, string>;
  sku: string;
  barcode: string; // "" -> null
  priceTaka: string;
  compareAtTaka: string; // "" -> null
  costTaka: string; // "" -> null
  stock: string;
  imageUrl: string; // "" -> null
  isActive: boolean;
}

interface ImageRow {
  key: number;
  url: string;
  altBn: string;
  altEn: string;
}

type Tab = "basic" | "media" | "variants" | "seo";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** ASCII-only slugify (the API's slug rule admits [a-z0-9-] only, so a
 *  Bangla title contributes only its latin/digit characters — there is
 *  no transliteration). Returns "" when nothing slug-safe remains. */
function slugifyAscii(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function poishaToTakaInput(poisha: number | null): string {
  if (poisha === null) return "";
  return (poisha / 100).toFixed(2).replace(/\.?0+$/, "");
}

/** Taka text -> integer poisha, or null when empty/invalid. Never fractional. */
function takaToPoisha(value: string): number | null {
  const t = value.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function emptyToNull(value: string): string | null {
  const t = value.trim();
  return t === "" ? null : t;
}

/** Rebuild "key: v1, v2" lines from loaded variants (edit mode). */
function attributeLinesFromVariants(variants: { attributes: Record<string, string> }[]): string {
  const byKey = new Map<string, string[]>();
  for (const v of variants) {
    for (const [k, val] of Object.entries(v.attributes)) {
      const arr = byKey.get(k) ?? [];
      if (!arr.includes(val)) arr.push(val);
      byKey.set(k, arr);
    }
  }
  return [...byKey.entries()].map(([k, vals]) => `${k}: ${vals.join(", ")}`).join("\n");
}

const inputCls =
  "mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const cellInputCls =
  "w-full min-w-[84px] rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export function ProductEditor({
  mode,
  productId,
  categories,
  brandNames,
  initial,
}: {
  mode: "create" | "edit";
  productId?: string;
  categories: CategoryOption[];
  brandNames: string[];
  initial: Product | null;
}) {
  const router = useRouter();
  const keySeq = useRef(1);
  const nextKey = () => keySeq.current++;

  // The categories read lists ACTIVE categories only. If this
  // product's own category is inactive it would be missing from the
  // <select> while state still holds its slug — add it back as an
  // option so what the merchant sees is what will be saved.
  const categoryOptions: CategoryOption[] =
    initial && !categories.some((c) => c.slug === initial.categorySlug)
      ? [
          { slug: initial.categorySlug, nameBn: initial.categoryName.bn, nameEn: initial.categoryName.en },
          ...categories,
        ]
      : categories;

  const [tab, setTab] = useState<Tab>("basic");

  // --- Basic fields -------------------------------------------------------
  const [titleBn, setTitleBn] = useState(initial?.title.bn ?? "");
  const [titleEn, setTitleEn] = useState(initial?.title.en ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [descriptionBn, setDescriptionBn] = useState(initial?.description.bn ?? "");
  const [descriptionEn, setDescriptionEn] = useState(initial?.description.en ?? "");
  const [categorySlug, setCategorySlug] = useState(
    initial?.categorySlug ?? categories[0]?.slug ?? "",
  );
  const [brandName, setBrandName] = useState(initial?.brandName ?? "");
  const [tagsText, setTagsText] = useState(initial?.tags.join(", ") ?? "");
  const [status, setStatus] = useState<ProductStatus>(initial?.status ?? "DRAFT");

  // Generator defaults (taka) — applied to NEW drafts only; existing
  // rows keep their own values when drafts merge by SKU.
  const firstVariant = initial?.variants[0];
  const [basePriceTaka, setBasePriceTaka] = useState(
    firstVariant ? poishaToTakaInput(firstVariant.pricePoisha) : "",
  );
  const [baseCompareAtTaka, setBaseCompareAtTaka] = useState(
    firstVariant ? poishaToTakaInput(firstVariant.compareAtPoisha) : "",
  );
  const [baseCostTaka, setBaseCostTaka] = useState(
    firstVariant ? poishaToTakaInput(firstVariant.costPoisha) : "",
  );

  // --- Variants -----------------------------------------------------------
  const [attrInput, setAttrInput] = useState(
    initial ? attributeLinesFromVariants(initial.variants) : "",
  );
  const [rows, setRows] = useState<VariantRow[]>(() => {
    if (initial) {
      return initial.variants.map((v) => ({
        key: keySeq.current++,
        originalSku: v.sku,
        originalPricePoisha: v.pricePoisha,
        originalStock: v.stock,
        attributes: v.attributes,
        sku: v.sku,
        barcode: v.barcode ?? "",
        priceTaka: poishaToTakaInput(v.pricePoisha),
        compareAtTaka: poishaToTakaInput(v.compareAtPoisha),
        costTaka: poishaToTakaInput(v.costPoisha),
        stock: String(v.stock),
        imageUrl: v.imageUrl ?? "",
        isActive: v.isActive,
      }));
    }
    return [
      {
        key: keySeq.current++,
        originalSku: null,
        originalPricePoisha: null,
        originalStock: null,
        attributes: {},
        sku: "",
        barcode: "",
        priceTaka: "",
        compareAtTaka: "",
        costTaka: "",
        stock: "0",
        imageUrl: "",
        isActive: true,
      },
    ];
  });

  // --- Images ---------------------------------------------------------------
  const [imageRows, setImageRows] = useState<ImageRow[]>(() =>
    initial
      ? [...initial.images]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((i) => ({ key: keySeq.current++, url: i.url, altBn: i.altBn, altEn: i.altEn }))
      : [],
  );

  // --- SEO ------------------------------------------------------------------
  const [seoTitleBn, setSeoTitleBn] = useState(initial?.seoTitle?.bn ?? "");
  const [seoTitleEn, setSeoTitleEn] = useState(initial?.seoTitle?.en ?? "");
  const [seoDescriptionBn, setSeoDescriptionBn] = useState(initial?.seoDescription?.bn ?? "");
  const [seoDescriptionEn, setSeoDescriptionEn] = useState(initial?.seoDescription?.en ?? "");

  // --- Save state -------------------------------------------------------------
  const [reason, setReason] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [saveErrors, setSaveErrors] = useState<string[]>([]);

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
          values: (rest ?? "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        };
      })
      .filter((a) => a.key && a.values.length > 0);
  }, [attrInput]);

  const basePricePoisha = takaToPoisha(basePriceTaka) ?? 0;

  /**
   * Price-change detection mirrors the service exactly: a payload
   * variant counts as "changed" only when it matches an EXISTING
   * variant by (unchanged) SKU and its pricePoisha differs. Renaming
   * a SKU makes it a new variant server-side (the old one is
   * soft-deleted), so a renamed row never triggers the reason rule.
   */
  const priceChanged =
    mode === "edit" &&
    rows.some(
      (r) =>
        r.originalSku !== null &&
        r.sku.trim() === r.originalSku &&
        r.originalPricePoisha !== null &&
        takaToPoisha(r.priceTaka) !== r.originalPricePoisha,
    );

  function updateRow(key: number, patch: Partial<VariantRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function isPristineEmptyRow(r: VariantRow): boolean {
    return (
      r.originalSku === null &&
      r.sku === "" &&
      r.priceTaka === "" &&
      r.compareAtTaka === "" &&
      r.costTaka === "" &&
      r.barcode === "" &&
      r.imageUrl === "" &&
      (r.stock === "0" || r.stock === "")
    );
  }

  /** Generate drafts from the attribute lines and merge by SKU:
   *  rows that already exist keep their edited values; brand-new
   *  combinations arrive with the base price/cost defaults. */
  function handleGenerate() {
    const drafts = generateVariantDrafts(slug || "product", attributes, {
      pricePoisha: basePricePoisha,
      compareAtPoisha: takaToPoisha(baseCompareAtTaka),
      costPoisha: takaToPoisha(baseCostTaka),
    });
    setRows((prev) => {
      const kept = prev.filter((r) => !isPristineEmptyRow(r));
      const bySku = new Map(kept.map((r) => [r.sku, r]));
      const mergedKeys = new Set<number>();
      const merged: VariantRow[] = [];
      for (const d of drafts) {
        const existing = bySku.get(d.sku);
        if (existing) {
          merged.push({ ...existing, attributes: d.attributes });
          mergedKeys.add(existing.key);
        } else {
          merged.push({
            key: nextKey(),
            originalSku: null,
            originalPricePoisha: null,
            originalStock: null,
            attributes: d.attributes,
            sku: d.sku,
            barcode: d.barcode ?? "",
            priceTaka: poishaToTakaInput(d.pricePoisha),
            compareAtTaka: poishaToTakaInput(d.compareAtPoisha),
            costTaka: poishaToTakaInput(d.costPoisha),
            stock: String(d.stock),
            imageUrl: d.imageUrl ?? "",
            isActive: true,
          });
        }
      }
      for (const r of kept) {
        if (!mergedKeys.has(r.key)) merged.push(r);
      }
      return merged;
    });
  }

  function handleAddManualRow() {
    const base = (slug || "product").toUpperCase();
    const taken = new Set(rows.map((r) => r.sku));
    let n = rows.length + 1;
    let sku = `${base}-${n}`;
    while (taken.has(sku)) {
      n += 1;
      sku = `${base}-${n}`;
    }
    setRows((prev) => [
      ...prev,
      {
        key: nextKey(),
        originalSku: null,
        originalPricePoisha: null,
        originalStock: null,
        attributes: {},
        sku,
        barcode: "",
        priceTaka: basePriceTaka,
        compareAtTaka: baseCompareAtTaka,
        costTaka: baseCostTaka,
        stock: "0",
        imageUrl: "",
        isActive: true,
      },
    ]);
  }

  function regenerateSlug() {
    setSlug(slugifyAscii(titleEn) || slugifyAscii(titleBn));
    // In create mode, title edits keep following; in edit mode the
    // merchant explicitly asked once — later title edits must not
    // silently rewrite a live URL.
    setSlugTouched(mode === "edit");
  }

  function handleTitleEnChange(value: string) {
    setTitleEn(value);
    if (mode === "create" && !slugTouched) {
      setSlug(slugifyAscii(value) || slugifyAscii(titleBn));
    }
  }

  function handleTitleBnChange(value: string) {
    setTitleBn(value);
    if (mode === "create" && !slugTouched && slugifyAscii(titleEn) === "") {
      setSlug(slugifyAscii(value));
    }
  }

  // --- Payload build + client validation -------------------------------------

  interface VariantPayload {
    attributes: Record<string, string>;
    sku: string;
    barcode: string | null;
    pricePoisha: number;
    compareAtPoisha: number | null;
    costPoisha: number | null;
    stock: number;
    imageUrl: string | null;
    isActive: boolean;
  }

  function buildPayload(effectiveStatus: ProductStatus): { payload?: Record<string, unknown>; errors: string[] } {
    const errors: string[] = [];
    if (titleBn.trim() === "") errors.push("টাইটেল (বাংলা) আবশ্যক।");
    if (titleEn.trim() === "") errors.push("Title (English) আবশ্যক।");
    if (descriptionBn.trim() === "") errors.push("বিবরণ (বাংলা) আবশ্যক — API খালি বিবরণ নেয় না।");
    if (descriptionEn.trim() === "") errors.push("Description (English) আবশ্যক — API খালি বিবরণ নেয় না।");
    if (!SLUG_PATTERN.test(slug)) {
      errors.push("Slug ঠিক করুন — ছোট হাতের ইংরেজি অক্ষর, সংখ্যা আর হাইফেন (-) ছাড়া কিছু চলবে না।");
    }
    if (categorySlug === "") errors.push("ক্যাটাগরি বেছে নিন।");

    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.some((t) => t.length > 64)) errors.push("প্রতিটি ট্যাগ সর্বোচ্চ 64 অক্ষরের হতে পারবে।");
    if (tags.length > 50) errors.push("সর্বোচ্চ 50টি ট্যাগ দেওয়া যাবে।");

    if (rows.length === 0) errors.push("অন্তত ১টি ভেরিয়েন্ট লাগবে।");
    const variants: VariantPayload[] = [];
    for (const r of rows) {
      const sku = r.sku.trim();
      if (sku === "") {
        errors.push("একটি ভেরিয়েন্টের SKU খালি — SKU লিখুন বা সারিটি মুছুন।");
        continue;
      }
      const price = takaToPoisha(r.priceTaka);
      if (price === null) {
        errors.push(`SKU ${sku}: দাম (৳) ঠিকমতো লিখুন।`);
        continue;
      }
      if (r.compareAtTaka.trim() !== "" && takaToPoisha(r.compareAtTaka) === null) {
        errors.push(`SKU ${sku}: Compare-at দাম ঠিকমতো লিখুন।`);
        continue;
      }
      if (r.costTaka.trim() !== "" && takaToPoisha(r.costTaka) === null) {
        errors.push(`SKU ${sku}: Cost price ঠিকমতো লিখুন।`);
        continue;
      }
      const stockNum = Number(r.stock);
      if (r.stock.trim() === "" || !Number.isInteger(stockNum) || stockNum < 0) {
        errors.push(`SKU ${sku}: স্টক শূন্য বা তার বেশি পূর্ণ সংখ্যা হতে হবে।`);
        continue;
      }
      variants.push({
        attributes: r.attributes,
        sku,
        barcode: emptyToNull(r.barcode),
        pricePoisha: price,
        compareAtPoisha: takaToPoisha(r.compareAtTaka),
        costPoisha: takaToPoisha(r.costTaka),
        stock: stockNum,
        imageUrl: emptyToNull(r.imageUrl),
        isActive: r.isActive,
      });
    }
    if (variants.length > 0) {
      // Same draft rules the generator validates: unique SKUs etc.
      for (const e of validateVariantDrafts(variants)) {
        errors.push(`ভেরিয়েন্ট: ${e}`);
      }
    }

    const images = imageRows
      .filter((i) => i.url.trim() !== "")
      .map((i, idx) => ({ url: i.url.trim(), altBn: i.altBn, altEn: i.altEn, sortOrder: idx }));
    if (images.length > 20) errors.push("সর্বোচ্চ 20টি ছবি দেওয়া যাবে।");

    if (errors.length > 0) return { errors };

    const payload: Record<string, unknown> = {
      slug,
      titleBn: titleBn.trim(),
      titleEn: titleEn.trim(),
      descriptionBn,
      descriptionEn,
      categorySlug,
      brandName: emptyToNull(brandName),
      status: effectiveStatus,
      tags,
      seoTitleBn: emptyToNull(seoTitleBn),
      seoTitleEn: emptyToNull(seoTitleEn),
      seoDescriptionBn: emptyToNull(seoDescriptionBn),
      seoDescriptionEn: emptyToNull(seoDescriptionEn),
      images,
      variants,
    };
    if (mode === "edit" && priceChanged) {
      if (reason.trim() === "") {
        return { errors: ["দাম বদলেছে — সেভ করার আগে দাম বদলের কারণ লিখুন (অডিটে থাকবে)।"] };
      }
      payload.reason = reason.trim();
    }
    return { payload, errors: [] };
  }

  async function handleSave(statusOverride?: ProductStatus) {
    const effectiveStatus = statusOverride ?? status;
    const { payload, errors } = buildPayload(effectiveStatus);
    if (!payload) {
      setSaveStatus("error");
      setSaveMessage("কিছু তথ্য ঠিক করতে হবে:");
      setSaveErrors(errors);
      return;
    }
    setSaveStatus("saving");
    setSaveErrors([]);
    setSaveMessage("");
    try {
      const res = await fetch(
        mode === "create" ? "/api/v1/admin/products" : `/api/v1/admin/products/${productId}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        data?: { product?: { id?: string }; ledgerPending?: boolean };
        error?: { code?: string; message?: string; details?: unknown };
      };
      if (!res.ok) {
        setSaveStatus("error");
        const details = Array.isArray(data.error?.details)
          ? (data.error?.details as (string | { field?: string; message?: string })[]).map((d) =>
              typeof d === "string" ? d : `${d.field ?? "field"}: ${d.message ?? "invalid"}`,
            )
          : [];
        setSaveErrors(details);
        setSaveMessage(data.error?.message ?? "সেভ করা যায়নি।");
        return;
      }
      if (mode === "create") {
        const newId = data.data?.product?.id;
        if (newId) {
          const qs = data.data?.ledgerPending ? "?created=1&ledger=pending" : "?created=1";
          router.push(`/admin/products/${newId}${qs}`);
          return;
        }
        setSaveStatus("saved");
        setSaveMessage("পণ্য তৈরি হয়েছে।");
        return;
      }
      // Edit: the saved values become the new "originals", so the
      // price-change detector resets and the reason box clears.
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          originalSku: r.sku.trim(),
          originalPricePoisha: takaToPoisha(r.priceTaka),
          originalStock: Number.isInteger(Number(r.stock)) ? Number(r.stock) : r.originalStock,
        })),
      );
      setStatus(effectiveStatus);
      setReason("");
      setSaveStatus("saved");
      setSaveMessage(
        data.data?.ledgerPending
          ? "সেভ হয়েছে — তবে stock ledger এখনো pending (ডিফল্ট গুদাম পাওয়া যায়নি)।"
          : "পরিবর্তন সেভ হয়েছে।",
      );
      router.refresh();
    } catch {
      setSaveStatus("error");
      setSaveMessage("Network error — API-তে পৌঁছানো যায়নি।");
    }
  }

  const qualityDone = {
    title: Boolean(titleBn.trim() && titleEn.trim()),
    image: imageRows.some((i) => i.url.trim() !== ""),
    description: Boolean(descriptionBn.trim() && descriptionEn.trim()),
    price: rows.some((r) => (takaToPoisha(r.priceTaka) ?? 0) > 0),
    seo: Boolean(slug && (seoTitleBn || seoTitleEn || seoDescriptionBn || seoDescriptionEn)),
  };
  const QUALITY_CHECKLIST = [
    { key: "title", label: "টাইটেল (বাংলা + English)" },
    { key: "image", label: "কমপক্ষে ১টি ছবি (URL)" },
    { key: "description", label: "বিবরণ (বাংলা + English)" },
    { key: "price", label: "কমপক্ষে ১টি ভেরিয়েন্টে দাম + স্টক" },
    { key: "seo", label: "SEO: slug + meta" },
  ] as const;

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {(["basic", "media", "variants", "seo"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm transition motion-fast ${
              tab === t ? "bg-brand-600 text-white shadow-sm" : "border border-border bg-card hover:border-brand-300"
            }`}
          >
            {t === "basic" ? "বেসিক" : t === "media" ? "মিডিয়া" : t === "variants" ? `ভেরিয়েন্ট (${rows.length})` : "SEO"}
          </button>
        ))}
        {mode === "edit" && status === "ACTIVE" && (
          <Link
            href={`/product/${slug}`}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-brand-700 transition motion-fast hover:border-brand-300"
          >
            স্টোরফ্রন্টে দেখুন ↗
          </Link>
        )}
      </div>

      {tab === "basic" && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            টাইটেল (বাংলা) *
            <input value={titleBn} onChange={(e) => handleTitleBnChange(e.target.value)} className={inputCls} placeholder="যেমন: জামদানি শাড়ি" />
          </label>
          <label className="block text-sm">
            Title (English) *
            <input value={titleEn} onChange={(e) => handleTitleEnChange(e.target.value)} className={inputCls} placeholder="e.g. Jamdani Sharee" />
          </label>
          <label className="block text-sm">
            Slug *
            <span className="mt-1 flex gap-2">
              <input
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                }}
                className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                placeholder="jamdani-sharee"
              />
              <button
                type="button"
                onClick={regenerateSlug}
                className="shrink-0 rounded-md border border-border bg-card px-3 py-2 text-sm transition motion-fast hover:border-brand-300"
              >
                টাইটেল থেকে তৈরি করুন
              </button>
            </span>
            <span className="mt-1 block text-xs text-text-subtle">
              English টাইটেল থেকে অটো তৈরি হয়; হাতে বদলালে অটো বন্ধ হয়ে যাবে। স্টোরের ঠিকানা: /product/{slug || "…"}
            </span>
          </label>
          <label className="block text-sm">
            স্ট্যাটাস
            <select value={status} onChange={(e) => setStatus(e.target.value as ProductStatus)} className={inputCls}>
              <option value="DRAFT">খসড়া (DRAFT) — স্টোরে দেখা যাবে না</option>
              <option value="ACTIVE">সক্রিয় (ACTIVE) — স্টোরে লাইভ</option>
              <option value="ARCHIVED">আর্কাইভ (ARCHIVED)</option>
            </select>
          </label>
          <label className="block text-sm">
            ক্যাটাগরি *
            <select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className={inputCls}>
              {categoryOptions.length === 0 && <option value="">— কোনো ক্যাটাগরি পাওয়া যায়নি —</option>}
              {categoryOptions.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.nameBn} ({c.nameEn})
                </option>
              ))}
            </select>
            {categoryOptions.length === 0 && (
              <span className="mt-1 block text-xs text-rose-600">
                ডাটাবেসে কোনো ক্যাটাগরি নেই — ক্যাটাগরি যোগ না হলে পণ্য সেভ করা যাবে না।
              </span>
            )}
          </label>
          <label className="block text-sm">
            ব্র্যান্ড (না থাকলে খালি রাখুন)
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className={inputCls}
              placeholder="যেমন: Aarong"
              list="product-editor-brand-names"
            />
            <datalist id="product-editor-brand-names">
              {brandNames.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
            <span className="mt-1 block text-xs text-text-subtle">নতুন নাম লিখলে ব্র্যান্ডটি সার্ভারে অটো তৈরি হয়ে যাবে।</span>
          </label>
          <label className="block text-sm md:col-span-2">
            ট্যাগ (কমা দিয়ে আলাদা করুন)
            <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} className={inputCls} placeholder="যেমন: ঈদ, নতুন, বেস্ট সেলার" />
          </label>
          <label className="block text-sm">
            ডিফল্ট দাম (৳) — নতুন ভেরিয়েন্টে বসবে
            <input value={basePriceTaka} onChange={(e) => setBasePriceTaka(e.target.value)} inputMode="decimal" className={inputCls} placeholder="4500" />
            <span className="mt-1 block text-xs text-text-subtle">
              Poisha: {basePricePoisha} • দেখাবে: {formatBdt(basePricePoisha)} — প্রতিটি ভেরিয়েন্টের দাম Variants ট্যাবে আলাদা করে বদলানো যায়।
            </span>
          </label>
          <label className="block text-sm">
            ডিফল্ট Compare-at দাম (৳) — ছাড় দেখাতে
            <input value={baseCompareAtTaka} onChange={(e) => setBaseCompareAtTaka(e.target.value)} inputMode="decimal" className={inputCls} placeholder="5200" />
          </label>
          <label className="block text-sm">
            ডিফল্ট Cost price (৳) — শুধু স্টাফদের জন্য
            <input value={baseCostTaka} onChange={(e) => setBaseCostTaka(e.target.value)} inputMode="decimal" className={inputCls} placeholder="3000" />
          </label>
          <label className="block text-sm md:col-span-2">
            বিবরণ (বাংলা) *
            <textarea value={descriptionBn} onChange={(e) => setDescriptionBn(e.target.value)} rows={4} className={inputCls} placeholder="পণ্যের বাংলা বিবরণ" />
          </label>
          <label className="block text-sm md:col-span-2">
            Description (English) *
            <textarea value={descriptionEn} onChange={(e) => setDescriptionEn(e.target.value)} rows={4} className={inputCls} placeholder="Product description in English" />
          </label>
        </div>
      )}

      {tab === "media" && (
        <div className="mt-4">
          <p className="text-sm text-text-muted">
            ছবির URL বসান — ক্রম অনুযায়ী প্রথম ছবিটাই প্রধান ছবি হিসেবে স্টোরে দেখাবে। ফাইল আপলোড পরের ধাপে (P1) আসছে; আপাতত হোস্ট করা ছবির লিংক ব্যবহার করুন।
          </p>
          <div className="mt-3 space-y-3">
            {imageRows.length === 0 && (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-subtle">
                এখনো কোনো ছবি যোগ হয়নি।
              </p>
            )}
            {imageRows.map((img, idx) => (
              <div key={img.key} className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
                {img.url.trim() !== "" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img.url} alt={img.altEn || img.altBn} className="h-16 w-16 shrink-0 rounded-md border border-border object-cover" />
                ) : (
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-xs text-text-subtle">ছবি নেই</span>
                )}
                <div className="grid min-w-[260px] flex-1 gap-2 md:grid-cols-3">
                  <label className="block text-xs md:col-span-3">
                    ছবির URL *
                    <input
                      value={img.url}
                      onChange={(e) =>
                        setImageRows((prev) => prev.map((p) => (p.key === img.key ? { ...p, url: e.target.value } : p)))
                      }
                      className={cellInputCls}
                      placeholder="https://…"
                    />
                  </label>
                  <label className="block text-xs">
                    Alt text (বাংলা)
                    <input
                      value={img.altBn}
                      onChange={(e) =>
                        setImageRows((prev) => prev.map((p) => (p.key === img.key ? { ...p, altBn: e.target.value } : p)))
                      }
                      className={cellInputCls}
                    />
                  </label>
                  <label className="block text-xs">
                    Alt text (English)
                    <input
                      value={img.altEn}
                      onChange={(e) =>
                        setImageRows((prev) => prev.map((p) => (p.key === img.key ? { ...p, altEn: e.target.value } : p)))
                      }
                      className={cellInputCls}
                    />
                  </label>
                  <span className="flex items-end gap-1.5 pb-0.5">
                    <button
                      type="button"
                      aria-label="ছবি উপরে নিন"
                      disabled={idx === 0}
                      onClick={() =>
                        setImageRows((prev) => {
                          const copy = [...prev];
                          [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                          return copy;
                        })
                      }
                      className="rounded-md border border-border px-2.5 py-1.5 text-sm disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label="ছবি নিচে নামান"
                      disabled={idx === imageRows.length - 1}
                      onClick={() =>
                        setImageRows((prev) => {
                          const copy = [...prev];
                          [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
                          return copy;
                        })
                      }
                      className="rounded-md border border-border px-2.5 py-1.5 text-sm disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageRows((prev) => prev.filter((p) => p.key !== img.key))}
                      className="rounded-md border border-border px-2.5 py-1.5 text-sm text-rose-600"
                    >
                      মুছুন
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setImageRows((prev) => [...prev, { key: nextKey(), url: "", altBn: "", altEn: "" }])}
            className="mt-3 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium transition motion-fast hover:border-brand-300"
          >
            + আরেকটি ছবি যোগ করুন
          </button>
        </div>
      )}

      {tab === "variants" && (
        <div className="mt-4">
          <label className="block text-sm">
            অ্যাট্রিবিউট (প্রতি লাইনে key: value, value — যেমন color: লাল, নীল)
            <textarea value={attrInput} onChange={(e) => setAttrInput(e.target.value)} rows={4} className={`${inputCls} font-mono`} placeholder={"color: লাল, নীল\nsize: M, L"} />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleGenerate}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition motion-fast hover:brightness-105"
            >
              ভেরিয়েন্ট তৈরি / আপডেট করুন
            </button>
            <button
              type="button"
              onClick={handleAddManualRow}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm font-medium transition motion-fast hover:border-brand-300"
            >
              + একটি ভেরিয়েন্ট হাতে যোগ করুন
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-text-subtle">
            জেনারেট করলে সব কম্বিনেশনের সারি তৈরি হবে; আগে থেকে থাকা SKU-র সারির দাম/স্টক আগেরটাই থাকবে। নিচের প্রতিটি সারির দাম, compare-at, cost, স্টক, barcode, ছবি আর সক্রিয় অবস্থা আলাদা করে বদলানো যায়।
            {mode === "edit" && " এডিট মোডে কোনো সারি মুছে সেভ করলে সেই ভেরিয়েন্টটি সফট-ডিলিট হবে (অর্ডার ইতিহাসে রেফারেন্স থাকবে)। স্টক বদলালে পার্থক্যটা stock ledger-এ এন্ট্রি হবে।"}
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card shadow-card">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr className="bg-surface-2 [&>th]:border-b [&>th]:border-border [&>th]:px-3 [&>th]:py-2 [&>th]:text-caption [&>th]:font-semibold [&>th]:text-text-muted">
                  <th>SKU *</th>
                  <th>অ্যাট্রিবিউট</th>
                  <th>দাম (৳) *</th>
                  <th>Compare-at (৳)</th>
                  <th>Cost (৳)</th>
                  <th>স্টক</th>
                  <th>Barcode</th>
                  <th>ছবির URL</th>
                  <th>সক্রিয়</th>
                  <th aria-label="অ্যাকশন" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <input value={r.sku} onChange={(e) => updateRow(r.key, { sku: e.target.value })} className={`${cellInputCls} font-mono text-xs`} />
                      {r.originalSku !== null && r.sku.trim() !== r.originalSku && (
                        <span className="mt-1 block text-[11px] text-amber-600">SKU বদলালে এটি নতুন ভেরিয়েন্ট হিসেবে তৈরি হবে, পুরনোটি সফট-ডিলিট হবে।</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs leading-relaxed text-text-muted">
                      {Object.entries(r.attributes).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <input value={r.priceTaka} onChange={(e) => updateRow(r.key, { priceTaka: e.target.value })} inputMode="decimal" className={cellInputCls} />
                      <span className="mt-1 block text-[11px] text-text-subtle">{formatBdt(takaToPoisha(r.priceTaka) ?? 0)}</span>
                    </td>
                    <td className="px-3 py-2">
                      <input value={r.compareAtTaka} onChange={(e) => updateRow(r.key, { compareAtTaka: e.target.value })} inputMode="decimal" className={cellInputCls} />
                    </td>
                    <td className="px-3 py-2">
                      <input value={r.costTaka} onChange={(e) => updateRow(r.key, { costTaka: e.target.value })} inputMode="decimal" className={cellInputCls} />
                    </td>
                    <td className="px-3 py-2">
                      <input value={r.stock} onChange={(e) => updateRow(r.key, { stock: e.target.value })} inputMode="numeric" className={cellInputCls} />
                      {r.originalStock !== null && Number(r.stock) !== r.originalStock && (
                        <span className="mt-1 block text-[11px] text-text-subtle">আগের স্টক: {r.originalStock}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input value={r.barcode} onChange={(e) => updateRow(r.key, { barcode: e.target.value })} className={`${cellInputCls} font-mono text-xs`} />
                    </td>
                    <td className="px-3 py-2">
                      <input value={r.imageUrl} onChange={(e) => updateRow(r.key, { imageUrl: e.target.value })} className={cellInputCls} placeholder="https://…" />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={r.isActive}
                        onChange={(e) => updateRow(r.key, { isActive: e.target.checked })}
                        aria-label={`SKU ${r.sku || "নতুন"} সক্রিয়`}
                        className="h-4 w-4 accent-brand-600"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setRows((prev) => prev.filter((p) => p.key !== r.key))}
                        className="rounded-md border border-border px-2.5 py-1.5 text-xs text-rose-600"
                      >
                        মুছুন
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-sm text-text-subtle">
                      কোনো ভেরিয়েন্ট নেই — উপরের বোতামে জেনারেট করুন বা হাতে যোগ করুন।
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "seo" && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="block text-sm">
            SEO টাইটেল (বাংলা)
            <input value={seoTitleBn} onChange={(e) => setSeoTitleBn(e.target.value)} className={inputCls} placeholder="খালি রাখলে পণ্যের টাইটেলই যাবে" />
          </label>
          <label className="block text-sm">
            SEO Title (English)
            <input value={seoTitleEn} onChange={(e) => setSeoTitleEn(e.target.value)} className={inputCls} placeholder="Empty = product title is used" />
          </label>
          <label className="block text-sm">
            SEO বিবরণ (বাংলা)
            <textarea value={seoDescriptionBn} onChange={(e) => setSeoDescriptionBn(e.target.value)} rows={3} className={inputCls} />
          </label>
          <label className="block text-sm">
            SEO Description (English)
            <textarea value={seoDescriptionEn} onChange={(e) => setSeoDescriptionEn(e.target.value)} rows={3} className={inputCls} />
          </label>
          <p className="text-sm text-text-muted md:col-span-2">
            স্টোরের ঠিকানা: <span className="font-mono">/product/{slug || "…"}</span> — এই slug দিয়েই সার্চ ইঞ্জিনে পণ্যটি আসবে।
          </p>
        </div>
      )}

      <div className="mt-6 rounded-lg border border-border bg-card p-4 shadow-card">
        {priceChanged && (
          <label className="mb-3 block text-sm">
            দাম বদলের কারণ * <span className="text-text-subtle">(এক বা একাধিক পুরনো ভেরিয়েন্টের দাম বদলেছে — কারণটি অডিট লগে থাকবে)</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className={inputCls}
              placeholder="যেমন: সরবরাহকারীর দাম বেড়েছে"
            />
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saveStatus === "saving"}
            className="rounded-md bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition motion-fast hover:brightness-105 disabled:opacity-50"
          >
            {saveStatus === "saving" ? "সেভ হচ্ছে…" : mode === "create" ? "পণ্য তৈরি করুন" : "পরিবর্তন সেভ করুন"}
          </button>
          {status === "DRAFT" && (
            <button
              type="button"
              onClick={() => void handleSave("ACTIVE")}
              disabled={saveStatus === "saving"}
              className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition motion-fast hover:brightness-105 disabled:opacity-50"
            >
              প্রকাশ করুন (সেভ করে Active)
            </button>
          )}
        </div>
        {saveMessage && (
          <p role="status" className={`mt-3 text-sm ${saveStatus === "error" ? "text-rose-600" : "text-emerald-700"}`}>
            {saveMessage}
          </p>
        )}
        {saveErrors.length > 0 && (
          <ul className="mt-2 list-inside list-disc text-sm text-rose-600">
            {saveErrors.map((e, i) => (
              <li key={`${e}-${i}`}>{e}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded-lg border border-border bg-card p-4 shadow-card">
        <h2 className="font-semibold">Product quality checklist</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {QUALITY_CHECKLIST.map((item) => (
            <li key={item.key}>
              {qualityDone[item.key] ? "✅" : "⬜"} {item.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

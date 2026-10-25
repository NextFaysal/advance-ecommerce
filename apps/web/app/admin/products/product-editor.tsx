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
//     File UPLOAD (P1) is real: the Media tab asks
//     POST /api/v1/admin/products/upload for presigned PUT tickets
//     and uploads each file straight to the configured R2/S3 storage
//     with per-file progress; the resulting public URL lands as a row
//     here. When storage is not configured the endpoint says so
//     (STORAGE_NOT_CONFIGURED) and the tab shows that honestly while
//     URL rows keep working. OG image (SEO tab) is Product.ogImage;
//     empty means the PDP falls back to the first gallery image.
//   - Price-change rule: when any EXISTING variant's price differs
//     from the loaded price, PATCH requires `reason`
//     (products.price_change audit). The editor detects the change
//     (same SKU-match rule the service uses) and collects the reason
//     inline before saving.
// Cost price stays visible to all staff in this form, matching the
// editor's long-standing behaviour; field-level hiding is a separate
// RBAC item and is deliberately not invented here.
//
// Product types (wave 15, doc 16 §P7): behind the prop
// `productTypesEnabled` (the server pages read the
// `module.product_types` flag). When the flag is OFF the editor
// behaves exactly as before — no selector, no panels — and the
// payload only gains `type: "SIMPLE"`. The one exception: a product
// that ALREADY has a non-SIMPLE type keeps its type UI visible and
// round-trips its type + per-type block untouched, so an unrelated
// price edit can never silently strip a digital product's files.
// When the UI is visible, the payload sends `type` plus ONLY the
// active type's block (digitalFiles / bundleComponents / preorder —
// see src/catalog/product-type-contract.ts); switching type keeps
// the other blocks' data in state for when the merchant switches
// back. Digital files upload through
// POST /api/v1/admin/products/digital-upload exactly like images do
// through /upload (metadata -> presigned PUT -> row), and the
// license-key pool is managed against
// /api/v1/admin/products/[id]/license-keys (edit mode only — a
// product must exist before keys can belong to it).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatBdt } from "@advance-ecommerce/validators";
import { generateVariantDrafts, validateVariantDrafts } from "@/catalog/variants";
import { renderDescriptionHtml } from "@/catalog/description";
import { formatFileSize, type ProductTypeValue, type ProductWithTypeFields } from "@/catalog/product-type-contract";
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

/** Digital deliverable row (wave 15): storageKey + display name +
 *  size. sizeBytes stays text in state (manual rows type it in);
 *  it is parsed to an integer when the payload is built. */
interface DigitalFileRow {
  key: number;
  storageKey: string;
  fileName: string;
  sizeBytes: string;
}

/** Bundle component row (wave 15). The payload needs only
 *  variantId + quantity; the display fields are filled from the
 *  loaded product shape and/or the picker search so staff can see
 *  WHAT they bundled. unitPricePoisha is null when unknown (the
 *  summary line then says so instead of guessing). */
interface BundleRow {
  key: number;
  variantId: string;
  quantity: string;
  productTitle: string;
  productSlug: string;
  variantSku: string;
  variantLabel: string;
  unitPricePoisha: number | null;
}

type Tab = "basic" | "media" | "variants" | "content" | "seo";

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

/** ISO instant -> <input type="datetime-local"> value (browser-local
 *  wall time). "" when unset/unparseable. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value -> ISO instant for the API; null when empty. */
function localInputToIso(value: string): string | null {
  const t = value.trim();
  if (t === "") return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Optional non-negative-integer field: "" -> null; junk -> error. */
function parseNonNegativeInt(value: string, label: string, errors: string[]): number | null {
  const t = value.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0) {
    errors.push(`${label}: শূন্য বা তার বেশি পূর্ণ সংখ্যা হতে হবে।`);
    return null;
  }
  return n;
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
const toolbarBtnCls =
  "rounded-md border border-border bg-card px-2.5 py-1 text-xs font-semibold transition motion-fast hover:border-brand-300";

/**
 * Description textarea with a markdown-subset toolbar + live preview
 * (wave 14). The syntax inserted here is exactly what
 * src/catalog/description.ts renders — the PDP uses the same
 * renderDescriptionHtml, so the preview is faithful, never a mock.
 */
function DescriptionField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  /** Replace the current selection with fn(selection) and reselect it. */
  function applyToSelection(fn: (selected: string) => string) {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const replacement = fn(value.slice(start, end));
    onChange(value.slice(0, start) + replacement + value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, start + replacement.length);
    });
  }

  /** Prefix the line the cursor sits on (headings, bullets). */
  function prefixCurrentLine(prefix: string) {
    const el = ref.current;
    if (!el) return;
    const pos = el.selectionStart ?? 0;
    const lineStart = pos === 0 ? 0 : value.lastIndexOf("\n", pos - 1) + 1;
    onChange(value.slice(0, lineStart) + prefix + value.slice(lineStart));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos + prefix.length, pos + prefix.length);
    });
  }

  function addLink() {
    const url = window.prompt("লিংকের URL লিখুন (https:// দিয়ে শুরু হতে হবে)");
    if (!url || url.trim() === "") return;
    applyToSelection((s) => `[${s || "লিংক"}](${url.trim()})`);
  }

  return (
    <div className="block text-sm">
      <span>{label}</span>
      <span className="mt-1 flex flex-wrap items-center gap-1.5">
        <button type="button" className={toolbarBtnCls} onClick={() => applyToSelection((s) => `**${s || "গুরুত্বপূর্ণ"}**`)} aria-label="Bold">
          B
        </button>
        <button type="button" className={`${toolbarBtnCls} italic`} onClick={() => applyToSelection((s) => `*${s || "লেখা"}*`)} aria-label="Italic">
          I
        </button>
        <button type="button" className={toolbarBtnCls} onClick={() => prefixCurrentLine("## ")} aria-label="Heading">
          H
        </button>
        <button type="button" className={toolbarBtnCls} onClick={() => prefixCurrentLine("- ")} aria-label="Bullet list">
          • তালিকা
        </button>
        <button type="button" className={toolbarBtnCls} onClick={addLink} aria-label="Link">
          🔗 লিংক
        </button>
        <button
          type="button"
          className={`${toolbarBtnCls} ml-auto font-medium`}
          onClick={() => setShowPreview((v) => !v)}
          aria-expanded={showPreview}
        >
          {showPreview ? "প্রিভিউ লুকান" : "প্রিভিউ দেখুন"}
        </button>
      </span>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        className={inputCls}
        placeholder={placeholder}
      />
      <span className="mt-1 block text-xs text-text-subtle">
        Markdown চলবে: **গাঢ়**, *তির্যক*, ## শিরোনাম, - তালিকা, [লেখা](https://…) লিংক। স্টোরে ঠিক এভাবেই দেখাবে।
      </span>
      {showPreview && (
        <div
          className="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm leading-relaxed [&_a]:font-medium [&_a]:text-brand-700 [&_a]:underline [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:font-semibold [&_h4]:mb-1 [&_h4]:mt-2 [&_h4]:font-semibold [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
          // The renderer escapes ALL raw HTML first — this is the
          // same sanitized string the PDP renders.
          dangerouslySetInnerHTML={{ __html: renderDescriptionHtml(value) }}
        />
      )}
    </div>
  );
}

export function ProductEditor({
  mode,
  productId,
  categories,
  brandNames,
  initial,
  productTypesEnabled = false,
}: {
  mode: "create" | "edit";
  productId?: string;
  categories: CategoryOption[];
  brandNames: string[];
  initial: Product | null;
  /** module.product_types flag, read server-side by the pages.
   *  Default false: every other consumer keeps today's behaviour. */
  productTypesEnabled?: boolean;
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
  const [ogImage, setOgImage] = useState(initial?.ogImage ?? "");

  // --- Wave 14: physicals, low-stock, scheduling, content -------------------
  const [weightGrams, setWeightGrams] = useState(
    initial?.weightGrams != null ? String(initial.weightGrams) : "",
  );
  const [lengthMm, setLengthMm] = useState(initial?.lengthMm != null ? String(initial.lengthMm) : "");
  const [widthMm, setWidthMm] = useState(initial?.widthMm != null ? String(initial.widthMm) : "");
  const [heightMm, setHeightMm] = useState(initial?.heightMm != null ? String(initial.heightMm) : "");
  const [lowStockThreshold, setLowStockThreshold] = useState(
    initial?.lowStockThreshold != null ? String(initial.lowStockThreshold) : "",
  );
  // Scheduling — datetime-local strings in state, ISO on the wire.
  const [publishAt, setPublishAt] = useState(isoToLocalInput(initial?.publishAt ?? null));
  const [saleStartsAt, setSaleStartsAt] = useState(isoToLocalInput(initial?.saleStartsAt ?? null));
  const [saleEndsAt, setSaleEndsAt] = useState(isoToLocalInput(initial?.saleEndsAt ?? null));
  // Content tab.
  const [videoUrl, setVideoUrl] = useState(initial?.videoUrl ?? "");
  const [sizeChart, setSizeChart] = useState<{ headers: string[]; rows: string[][] }>(() =>
    initial?.sizeChart
      ? { headers: [...initial.sizeChart.headers], rows: initial.sizeChart.rows.map((r) => [...r]) }
      : { headers: [], rows: [] },
  );
  const [faqRows, setFaqRows] = useState<{ q: string; a: string }[]>(() =>
    initial?.faqItems ? initial.faqItems.map((f) => ({ ...f })) : [],
  );
  // Related product ids (wave 14): the picker UI lives on the edit
  // page (parallel section) — the editor's duty here is only to
  // ROUND-TRIP the loaded ids unchanged so a save never wipes them.
  const [relatedIds] = useState<string[]>(initial?.relatedIds ?? []);

  // --- Product types (wave 15) ---------------------------------------------
  // The loaded type blocks ride the Product shape (service contract —
  // see src/catalog/product-type-contract.ts); read them through the
  // view type so this file does not depend on ./types carrying them.
  const initialTypeFields = (initial ?? null) as ProductWithTypeFields | null;
  const loadedType: ProductTypeValue = initialTypeFields?.type ?? "SIMPLE";
  const [productType, setProductType] = useState<ProductTypeValue>(loadedType);
  // Selector + panels render when the module flag is on, OR when the
  // product already IS a typed product (its data must stay visible
  // and editable even if the flag was later switched off).
  const showTypeUi = productTypesEnabled || loadedType !== "SIMPLE";

  const [digitalRows, setDigitalRows] = useState<DigitalFileRow[]>(() =>
    (initialTypeFields?.digitalFiles ?? []).map((f) => ({
      key: keySeq.current++,
      storageKey: f.storageKey ?? "",
      fileName: f.fileName,
      sizeBytes: String(f.sizeBytes ?? 0),
    })),
  );
  // Digital upload mirrors the image upload (metadata -> presigned
  // PUT -> row) with its own item list + notice.
  const digitalFileInputRef = useRef<HTMLInputElement | null>(null);
  const [digitalUploadItems, setDigitalUploadItems] = useState<
    { id: number; name: string; progress: number; status: "uploading" | "done" | "error"; error?: string }[]
  >([]);
  const [digitalUploadNotice, setDigitalUploadNotice] = useState("");

  // License-key pool (edit mode + DIGITAL only — the keys belong to
  // a saved product). GET returns MASKED keys + counts; POST takes a
  // pasted batch. Assigned state comes from the service.
  const [licenseKeys, setLicenseKeys] = useState<
    { id: string; masked: string; assigned: boolean }[]
  >([]);
  const [licenseCounts, setLicenseCounts] = useState<{
    total: number;
    available: number;
    assigned: number;
  } | null>(null);
  const [licensePaste, setLicensePaste] = useState("");
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseNotice, setLicenseNotice] = useState("");
  const [licenseLoaded, setLicenseLoaded] = useState(false);

  const [bundleRows, setBundleRows] = useState<BundleRow[]>(() =>
    (initialTypeFields?.bundleComponents ?? []).map((c) => ({
      key: keySeq.current++,
      variantId: c.variantId,
      quantity: String(c.quantity ?? 1),
      productTitle: c.productTitle?.bn ?? c.productTitle?.en ?? "",
      productSlug: c.productSlug ?? "",
      variantSku: c.sku ?? "",
      variantLabel: c.variantLabel ?? "",
      unitPricePoisha: c.unitPricePoisha ?? null,
    })),
  );
  const [bundleQuery, setBundleQuery] = useState("");
  const [bundleHits, setBundleHits] = useState<
    {
      productId: string;
      productTitle: string;
      productSlug: string;
      variantId: string;
      variantSku: string;
      variantLabel: string;
      pricePoisha: number;
      stock: number;
    }[]
  >([]);
  const [bundleSearching, setBundleSearching] = useState(false);
  const bundleDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [preorderDeposit, setPreorderDeposit] = useState(
    initialTypeFields?.preorder?.depositPercent != null
      ? String(initialTypeFields.preorder.depositPercent)
      : "",
  );
  const [preorderExpected, setPreorderExpected] = useState(
    initialTypeFields?.preorder?.expectedDate
      ? initialTypeFields.preorder.expectedDate.slice(0, 10)
      : "",
  );
  const [preorderMaxUnits, setPreorderMaxUnits] = useState(
    initialTypeFields?.preorder?.maxUnits != null
      ? String(initialTypeFields.preorder.maxUnits)
      : "",
  );

  // --- Image upload (P1: presigned direct-to-storage) ------------------------
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadItems, setUploadItems] = useState<
    { id: number; name: string; progress: number; status: "uploading" | "done" | "error"; error?: string }[]
  >([]);
  const [uploadNotice, setUploadNotice] = useState("");

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

    // --- Wave 14 fields -------------------------------------------------
    const weightGramsValue = parseNonNegativeInt(weightGrams, "ওজন (গ্রাম)", errors);
    const lengthMmValue = parseNonNegativeInt(lengthMm, "দৈর্ঘ্য (মিমি)", errors);
    const widthMmValue = parseNonNegativeInt(widthMm, "প্রস্থ (মিমি)", errors);
    const heightMmValue = parseNonNegativeInt(heightMm, "উচ্চতা (মিমি)", errors);
    const lowStockThresholdValue = parseNonNegativeInt(lowStockThreshold, "লো-স্টক সীমা", errors);

    const videoUrlValue = emptyToNull(videoUrl);
    if (videoUrlValue !== null) {
      try {
        new URL(videoUrlValue);
      } catch {
        errors.push("ভিডিও URL ঠিকমতো লিখুন (https:// দিয়ে শুরু হতে হবে)।");
      }
    }

    if (publishAt.trim() !== "" && localInputToIso(publishAt) === null) {
      errors.push("প্রকাশের সময় ঠিকমতো বেছে নিন।");
    }
    if (saleStartsAt.trim() !== "" && localInputToIso(saleStartsAt) === null) {
      errors.push("সেল শুরুর সময় ঠিকমতো বেছে নিন।");
    }
    if (saleEndsAt.trim() !== "" && localInputToIso(saleEndsAt) === null) {
      errors.push("সেল শেষের সময় ঠিকমতো বেছে নিন।");
    }

    // Size chart: completely empty -> null; otherwise normalize every
    // row to the header width so the stored shape always matches.
    const sizeChartValue =
      sizeChart.headers.length === 0 ||
      (sizeChart.headers.every((h) => h.trim() === "") &&
        sizeChart.rows.every((r) => r.every((c) => c.trim() === "")))
        ? null
        : {
            headers: sizeChart.headers,
            rows: sizeChart.rows.map((r) => sizeChart.headers.map((_, ci) => r[ci] ?? "")),
          };
    if (sizeChartValue !== null && sizeChartValue.headers.some((h) => h.trim() === "")) {
      errors.push("সাইজ চার্টের সব কলামের শিরোনাম লিখুন।");
    }

    // FAQ: fully-blank rows drop out; a half-filled row is an error.
    const faqItemsValue: { q: string; a: string }[] = [];
    for (const row of faqRows) {
      const q = row.q.trim();
      const a = row.a.trim();
      if (q === "" && a === "") continue;
      if (q === "" || a === "") {
        errors.push("প্রতিটি প্রশ্নের জোড়ায় প্রশ্ন ও উত্তর দুটোই লিখতে হবে।");
        break;
      }
      faqItemsValue.push({ q: row.q, a: row.a });
    }

    // --- Product types (wave 15): validate + build the ACTIVE type's
    // block. The other blocks stay in state untouched — switching
    // type away and back never loses what staff typed.
    let digitalFilesValue: { storageKey: string; fileName: string; sizeBytes: number }[] | undefined;
    if (productType === "DIGITAL") {
      digitalFilesValue = [];
      for (const row of digitalRows) {
        const storageKey = row.storageKey.trim();
        const fileName = row.fileName.trim();
        const sizeText = row.sizeBytes.trim();
        if (storageKey === "" && fileName === "" && (sizeText === "" || sizeText === "0")) continue;
        if (storageKey === "" || fileName === "") {
          errors.push("ডিজিটাল ফাইল: প্রতিটি সারিতে storage key ও ফাইলের নাম দুটোই লাগবে।");
          break;
        }
        const size = Number(sizeText);
        if (sizeText === "" || !Number.isInteger(size) || size < 0) {
          errors.push(`ডিজিটাল ফাইল "${fileName}": সাইজ (bytes) শূন্য বা তার বেশি পূর্ণ সংখ্যা হতে হবে।`);
          continue;
        }
        digitalFilesValue.push({ storageKey, fileName, sizeBytes: size });
      }
      if (effectiveStatus === "ACTIVE" && digitalFilesValue.length === 0) {
        errors.push("ডিজিটাল পণ্য প্রকাশ করতে অন্তত ১টি ফাইল যোগ করুন — ফাইল ছাড়া ক্রেতা কিছুই ডাউনলোড করতে পারবে না।");
      }
    }
    let bundleComponentsValue: { variantId: string; quantity: number }[] | undefined;
    if (productType === "BUNDLE") {
      bundleComponentsValue = [];
      const seen = new Set<string>();
      for (const row of bundleRows) {
        if (seen.has(row.variantId)) continue;
        seen.add(row.variantId);
        const qty = Number(row.quantity);
        if (row.quantity.trim() === "" || !Number.isInteger(qty) || qty < 1) {
          errors.push(`বান্ডল কম্পোনেন্ট ${row.variantSku || row.variantId}: পরিমাণ কমপক্ষে ১ হতে হবে।`);
          continue;
        }
        bundleComponentsValue.push({ variantId: row.variantId, quantity: qty });
      }
      if (effectiveStatus === "ACTIVE" && bundleComponentsValue.length === 0) {
        errors.push("বান্ডল প্রকাশ করতে অন্তত ১টি কম্পোনেন্ট যোগ করুন।");
      }
    }
    let preorderValue:
      | { depositPercent: number | null; expectedDate: string | null; maxUnits: number | null }
      | undefined;
    if (productType === "PREORDER") {
      const depositText = preorderDeposit.trim();
      let deposit: number | null = null;
      if (depositText !== "") {
        const n = Number(depositText);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          errors.push("অগ্রিম (%): ০ থেকে ১০০-এর মধ্যে হতে হবে।");
        } else {
          deposit = n;
        }
      }
      const maxUnits = parseNonNegativeInt(preorderMaxUnits, "সর্বোচ্চ প্রি-অর্ডার সংখ্যা", errors);
      if (maxUnits !== null && maxUnits < 1) {
        errors.push("সর্বোচ্চ প্রি-অর্ডার সংখ্যা কমপক্ষে ১ হতে হবে।");
      }
      preorderValue = {
        depositPercent: deposit,
        expectedDate: preorderExpected.trim() === "" ? null : preorderExpected.trim(),
        maxUnits,
      };
    }

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
      ogImage: emptyToNull(ogImage),
      videoUrl: videoUrlValue,
      sizeChart: sizeChartValue,
      faqItems: faqItemsValue.length > 0 ? faqItemsValue : null,
      publishAt: localInputToIso(publishAt),
      saleStartsAt: localInputToIso(saleStartsAt),
      saleEndsAt: localInputToIso(saleEndsAt),
      relatedIds,
      weightGrams: weightGramsValue,
      lengthMm: lengthMmValue,
      widthMm: widthMmValue,
      heightMm: heightMmValue,
      lowStockThreshold: lowStockThresholdValue,
      images,
      variants,
    };
    // Product types (wave 15): `type` always rides along; ONLY the
    // active type's block is sent. A SIMPLE product's payload is
    // therefore exactly the pre-type payload + type: "SIMPLE".
    payload.type = productType;
    if (productType === "DIGITAL") payload.digitalFiles = digitalFilesValue ?? [];
    if (productType === "BUNDLE") payload.bundleComponents = bundleComponentsValue ?? [];
    if (productType === "PREORDER") {
      payload.preorder = preorderValue ?? { depositPercent: null, expectedDate: null, maxUnits: null };
    }
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

  /** PUT one file straight to storage at its presigned URL, reporting
   *  progress into uploadItems. Content-Type is set from the file so it
   *  matches the signed header exactly; Content-Length is the file's
   *  own size (also signed), so storage rejects any tampered transfer. */
  function putFileWithProgress(
    file: File,
    ticket: { uploadUrl: string; publicUrl: string },
    itemId: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      const fail = (message: string) => {
        setUploadItems((prev) =>
          prev.map((it) => (it.id === itemId ? { ...it, status: "error" as const, error: message } : it)),
        );
        resolve();
      };
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", ticket.uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 100);
          setUploadItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, progress: pct } : it)));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setUploadItems((prev) =>
            prev.map((it) => (it.id === itemId ? { ...it, progress: 100, status: "done" as const } : it)),
          );
          setImageRows((prev) => [...prev, { key: nextKey(), url: ticket.publicUrl, altBn: "", altEn: "" }]);
          resolve();
        } else {
          fail(`স্টোরেজ আপলোড ব্যর্থ হয়েছে (HTTP ${xhr.status}) — আবার চেষ্টা করুন।`);
        }
      };
      xhr.onerror = () => fail("নেটওয়ার্ক সমস্যায় আপলোড ব্যর্থ হয়েছে — সংযোগ দেখে আবার চেষ্টা করুন।");
      xhr.onabort = () => fail("আপলোড বাতিল হয়েছে।");
      xhr.send(file);
    });
  }

  /** File-picker flow: ask the server for presigned tickets (metadata
   *  only — the bytes go straight to storage), then PUT each file.
   *  A STORAGE_NOT_CONFIGURED answer becomes a clear notice on the
   *  Media tab; URL rows remain fully usable either way. */
  async function handleFilesSelected(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    const items = files.map((f) => ({
      id: nextKey(),
      name: f.name,
      progress: 0,
      status: "uploading" as const,
    }));
    setUploadItems((prev) => [...prev, ...items]);
    setUploadNotice("");
    const markAllError = (message: string) =>
      setUploadItems((prev) =>
        prev.map((it) =>
          items.some((i) => i.id === it.id) ? { ...it, status: "error" as const, error: message } : it,
        ),
      );
    try {
      const res = await fetch("/api/v1/admin/products/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productSlug: slug.trim() || null,
          files: files.map((f) => ({ filename: f.name, contentType: f.type, sizeBytes: f.size })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: { uploads?: { uploadUrl: string; publicUrl: string }[] };
        error?: { code?: string; message?: string };
      };
      if (!res.ok) {
        const message = data.error?.message ?? "আপলোড শুরু করা যায়নি।";
        if (data.error?.code === "STORAGE_NOT_CONFIGURED") setUploadNotice(message);
        markAllError(message);
        return;
      }
      const uploads = data.data?.uploads ?? [];
      await Promise.all(
        uploads.map((ticket, idx) => {
          const file = files[idx];
          const item = items[idx];
          return file && item ? putFileWithProgress(file, ticket, item.id) : Promise.resolve();
        }),
      );
    } catch {
      markAllError("Network error — আপলোড সার্ভারে পৌঁছানো যায়নি।");
    }
  }

  // --- Product types: digital upload (mirrors the image flow) --------------
  /** PUT one digital file at its presigned URL with progress, then
   *  land it as a digital-file row carrying the ticket's storage key. */
  function putDigitalFileWithProgress(
    file: File,
    ticket: { uploadUrl: string; storageKey: string },
    itemId: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      const fail = (message: string) => {
        setDigitalUploadItems((prev) =>
          prev.map((it) => (it.id === itemId ? { ...it, status: "error" as const, error: message } : it)),
        );
        resolve();
      };
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", ticket.uploadUrl);
      if (file.type) xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const pct = Math.round((event.loaded / event.total) * 100);
          setDigitalUploadItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, progress: pct } : it)));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setDigitalUploadItems((prev) =>
            prev.map((it) => (it.id === itemId ? { ...it, progress: 100, status: "done" as const } : it)),
          );
          setDigitalRows((prev) => [
            ...prev,
            { key: nextKey(), storageKey: ticket.storageKey, fileName: file.name, sizeBytes: String(file.size) },
          ]);
          resolve();
        } else {
          fail(`স্টোরেজ আপলোড ব্যর্থ হয়েছে (HTTP ${xhr.status}) — আবার চেষ্টা করুন।`);
        }
      };
      xhr.onerror = () => fail("নেটওয়ার্ক সমস্যায় আপলোড ব্যর্থ হয়েছে — সংযোগ দেখে আবার চেষ্টা করুন।");
      xhr.onabort = () => fail("আপলোড বাতিল হয়েছে।");
      xhr.send(file);
    });
  }

  /** Digital file-picker flow: metadata -> tickets from
   *  /digital-upload -> direct PUT per file. STORAGE_NOT_CONFIGURED
   *  becomes the panel notice; manual storage-key rows keep working. */
  async function handleDigitalFilesSelected(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    const items = files.map((f) => ({
      id: nextKey(),
      name: f.name,
      progress: 0,
      status: "uploading" as const,
    }));
    setDigitalUploadItems((prev) => [...prev, ...items]);
    setDigitalUploadNotice("");
    const markAllError = (message: string) =>
      setDigitalUploadItems((prev) =>
        prev.map((it) =>
          items.some((i) => i.id === it.id) ? { ...it, status: "error" as const, error: message } : it,
        ),
      );
    try {
      const res = await fetch("/api/v1/admin/products/digital-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productSlug: slug.trim() || null,
          files: files.map((f) => ({ filename: f.name, contentType: f.type, sizeBytes: f.size })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: { uploads?: { key?: string; storageKey?: string; uploadUrl: string }[] };
        error?: { code?: string; message?: string };
      };
      if (!res.ok) {
        const message = data.error?.message ?? "আপলোড শুরু করা যায়নি।";
        if (data.error?.code === "STORAGE_NOT_CONFIGURED") setDigitalUploadNotice(message);
        markAllError(message);
        return;
      }
      const uploads = data.data?.uploads ?? [];
      await Promise.all(
        uploads.map((ticket, idx) => {
          const file = files[idx];
          const item = items[idx];
          const storageKey = ticket.key ?? ticket.storageKey ?? "";
          if (!file || !item) return Promise.resolve();
          if (storageKey === "") {
            markAllError("সার্ভার আপলোডের storage key দেয়নি — ফাইলটি যোগ করা যায়নি।");
            return Promise.resolve();
          }
          return putDigitalFileWithProgress(file, { uploadUrl: ticket.uploadUrl, storageKey }, item.id);
        }),
      );
    } catch {
      markAllError("Network error — আপলোড সার্ভারে পৌঁছানো যায়নি।");
    }
  }

  // --- Product types: license-key pool --------------------------------------
  const loadLicenseKeys = useCallback(async () => {
    if (mode !== "edit" || !productId) return;
    try {
      const res = await fetch(`/api/v1/admin/products/${productId}/license-keys`);
      const json = (await res.json().catch(() => ({}))) as {
        data?: {
          keys?: { id?: string; masked?: string; maskedKey?: string; assigned?: boolean; status?: string }[];
          items?: { id?: string; masked?: string; maskedKey?: string; assigned?: boolean; status?: string }[];
          counts?: { total?: number; available?: number; assigned?: number };
          total?: number;
          available?: number;
          assigned?: number;
          poolTotal?: number;
          poolAvailable?: number;
        };
        error?: { message?: string };
      };
      if (!res.ok) {
        setLicenseNotice(json.error?.message ?? "লাইসেন্স কী লোড করা যায়নি।");
        setLicenseLoaded(true);
        return;
      }
      const raw = json.data?.keys ?? json.data?.items ?? [];
      const keys = raw.map((k, i) => ({
        id: k.id ?? `key-${i}`,
        masked: k.masked ?? k.maskedKey ?? "",
        assigned: k.assigned ?? k.status === "ASSIGNED",
      }));
      const c = json.data?.counts;
      const assignedCount = keys.filter((k) => k.assigned).length;
      setLicenseKeys(keys);
      setLicenseCounts({
        total: c?.total ?? json.data?.total ?? json.data?.poolTotal ?? keys.length,
        available: c?.available ?? json.data?.available ?? json.data?.poolAvailable ?? keys.length - assignedCount,
        assigned: c?.assigned ?? json.data?.assigned ?? assignedCount,
      });
      setLicenseLoaded(true);
    } catch {
      setLicenseNotice("Network error — লাইসেন্স কী লোড করা যায়নি।");
      setLicenseLoaded(true);
    }
  }, [mode, productId]);

  useEffect(() => {
    if (showTypeUi && productType === "DIGITAL" && mode === "edit" && !licenseLoaded) {
      void loadLicenseKeys();
    }
  }, [showTypeUi, productType, mode, licenseLoaded, loadLicenseKeys]);

  async function handleAddLicenseKeys() {
    if (mode !== "edit" || !productId) return;
    const keys = licensePaste
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (keys.length === 0) {
      setLicenseNotice("আগে অন্তত একটি কী পেস্ট করুন (প্রতি লাইনে একটি)।");
      return;
    }
    setLicenseBusy(true);
    setLicenseNotice("");
    try {
      const res = await fetch(`/api/v1/admin/products/${productId}/license-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { added?: number; inserted?: number; duplicates?: number; skipped?: number; skippedDuplicates?: number };
        error?: { message?: string };
      };
      if (!res.ok) {
        setLicenseNotice(json.error?.message ?? "লাইসেন্স কী যোগ করা যায়নি।");
        return;
      }
      const added = json.data?.added ?? json.data?.inserted ?? keys.length;
      const dup = json.data?.duplicates ?? json.data?.skippedDuplicates ?? json.data?.skipped ?? 0;
      setLicensePaste("");
      setLicenseNotice(
        `✅ ${added}টি নতুন লাইসেন্স কী যোগ হয়েছে${dup > 0 ? ` — ${dup}টি আগে থেকেই ছিল, বাদ দেওয়া হয়েছে` : ""}।`,
      );
      // Reload the masked list + counts from the server (source of truth).
      setLicenseLoaded(false);
    } catch {
      setLicenseNotice("Network error — লাইসেন্স কী যোগ করা যায়নি।");
    } finally {
      setLicenseBusy(false);
    }
  }

  // --- Product types: bundle component search --------------------------------
  const searchBundle = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setBundleHits([]);
        return;
      }
      setBundleSearching(true);
      try {
        const params = new URLSearchParams({ q: q.trim(), status: "ALL", page: "1", pageSize: "10" });
        const res = await fetch(`/api/v1/admin/products?${params.toString()}`);
        const json = (await res.json().catch(() => ({}))) as {
          data?: Array<{
            id: string;
            slug: string;
            title: { bn: string; en: string };
            variants: {
              id: string;
              sku: string;
              attributes: Record<string, string>;
              pricePoisha: number;
              stock: number;
            }[];
          }>;
        };
        const hits: typeof bundleHits = [];
        for (const p of json.data ?? []) {
          // A product never bundles ITSELF (its own variants would
          // make fulfilment circular); other products are fair game.
          if (productId && p.id === productId) continue;
          for (const v of p.variants ?? []) {
            hits.push({
              productId: p.id,
              productTitle: p.title.bn,
              productSlug: p.slug,
              variantId: v.id,
              variantSku: v.sku,
              variantLabel: Object.values(v.attributes ?? {}).join(" / ") || "স্ট্যান্ডার্ড",
              pricePoisha: v.pricePoisha,
              stock: v.stock,
            });
          }
        }
        setBundleHits(hits);
      } catch {
        setBundleHits([]);
      } finally {
        setBundleSearching(false);
      }
    },
    [productId],
  );

  useEffect(() => {
    if (bundleDebounce.current) clearTimeout(bundleDebounce.current);
    bundleDebounce.current = setTimeout(() => void searchBundle(bundleQuery), 250);
    return () => {
      if (bundleDebounce.current) clearTimeout(bundleDebounce.current);
    };
  }, [bundleQuery, searchBundle]);

  // Loaded bundle rows may carry only variantId + quantity (the wire
  // minimum). Resolve their display data once from the admin list so
  // staff see titles/SKUs/prices instead of raw ids; unresolved rows
  // keep the id display and stay fully editable.
  const bundleResolveTried = useRef(false);
  useEffect(() => {
    if (bundleResolveTried.current) return;
    if (mode !== "edit" || loadedType !== "BUNDLE") return;
    if (!bundleRows.some((r) => r.unitPricePoisha === null || r.productTitle === "")) return;
    bundleResolveTried.current = true;
    void (async () => {
      try {
        const params = new URLSearchParams({ status: "ALL", page: "1", pageSize: "100" });
        const res = await fetch(`/api/v1/admin/products?${params.toString()}`);
        const json = (await res.json().catch(() => ({}))) as {
          data?: Array<{
            id: string;
            slug: string;
            title: { bn: string; en: string };
            variants: {
              id: string;
              sku: string;
              attributes: Record<string, string>;
              pricePoisha: number;
            }[];
          }>;
        };
        const byVariant = new Map<
          string,
          { productTitle: string; productSlug: string; variantSku: string; variantLabel: string; unitPricePoisha: number }
        >();
        for (const p of json.data ?? []) {
          for (const v of p.variants ?? []) {
            byVariant.set(v.id, {
              productTitle: p.title.bn,
              productSlug: p.slug,
              variantSku: v.sku,
              variantLabel: Object.values(v.attributes ?? {}).join(" / ") || "স্ট্যান্ডার্ড",
              unitPricePoisha: v.pricePoisha,
            });
          }
        }
        setBundleRows((prev) =>
          prev.map((r) => {
            const found = byVariant.get(r.variantId);
            if (!found) return r;
            return {
              ...r,
              productTitle: r.productTitle || found.productTitle,
              productSlug: r.productSlug || found.productSlug,
              variantSku: r.variantSku || found.variantSku,
              variantLabel: r.variantLabel || found.variantLabel,
              unitPricePoisha: r.unitPricePoisha ?? found.unitPricePoisha,
            };
          }),
        );
      } catch {
        // Display resolution is best-effort; the rows remain valid.
      }
    })();
    // One-shot: bundleRows is read as the initial snapshot on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, loadedType]);

  function addBundleComponent(hit: (typeof bundleHits)[number]) {
    setBundleRows((prev) => {
      if (prev.some((r) => r.variantId === hit.variantId)) return prev;
      return [
        ...prev,
        {
          key: nextKey(),
          variantId: hit.variantId,
          quantity: "1",
          productTitle: hit.productTitle,
          productSlug: hit.productSlug,
          variantSku: hit.variantSku,
          variantLabel: hit.variantLabel,
          unitPricePoisha: hit.pricePoisha,
        },
      ];
    });
  }

  // Bundle summary: components' total (known prices only) vs this
  // product's own default price from the Basic tab.
  const bundleKnownTotal = bundleRows.reduce(
    (sum, r) => sum + (r.unitPricePoisha !== null ? r.unitPricePoisha * (Number(r.quantity) || 0) : 0),
    0,
  );
  const bundleHasUnknownPrice = bundleRows.some((r) => r.unitPricePoisha === null);

  const qualityDone = {
    title: Boolean(titleBn.trim() && titleEn.trim()),
    image: imageRows.some((i) => i.url.trim() !== ""),
    description: Boolean(descriptionBn.trim() && descriptionEn.trim()),
    price: rows.some((r) => (takaToPoisha(r.priceTaka) ?? 0) > 0),
    seo: Boolean(slug && (seoTitleBn || seoTitleEn || seoDescriptionBn || seoDescriptionEn)),
  };
  const QUALITY_CHECKLIST = [
    { key: "title", label: "টাইটেল (বাংলা + English)" },
    { key: "image", label: "কমপক্ষে ১টি ছবি (আপলোড বা URL)" },
    { key: "description", label: "বিবরণ (বাংলা + English)" },
    { key: "price", label: "কমপক্ষে ১টি ভেরিয়েন্টে দাম + স্টক" },
    { key: "seo", label: "SEO: slug + meta" },
  ] as const;

  // Live schedule status (wave 14) — derived from the CURRENT form
  // state, so the merchant sees the effect before saving. Mirrors the
  // server rules: publishAt gates public visibility (read-time), the
  // sale window only drives the public saleActive flag.
  const fmtWhen = (d: Date) => d.toLocaleString("bn-BD", { dateStyle: "medium", timeStyle: "short" });
  const publishDate = publishAt.trim() !== "" ? new Date(publishAt) : null;
  const publishLine =
    status !== "ACTIVE"
      ? `স্ট্যাটাস ${status} — ACTIVE না করলে স্টোরে দেখা যাবে না।`
      : publishDate !== null && !Number.isNaN(publishDate.getTime()) && publishDate.getTime() > Date.now()
        ? `🕒 শিডিউল করা: ${fmtWhen(publishDate)} থেকে লাইভ হবে।`
        : "✅ এখন লাইভ (বা সেভ করলেই লাইভ হবে)।";
  const saleStartDate = saleStartsAt.trim() !== "" ? new Date(saleStartsAt) : null;
  const saleEndDate = saleEndsAt.trim() !== "" ? new Date(saleEndsAt) : null;
  const saleLine =
    saleStartDate === null && saleEndDate === null
      ? "কোনো সেলের সময়সীমা সেট করা নেই।"
      : (() => {
          const now = Date.now();
          if (saleStartDate !== null && !Number.isNaN(saleStartDate.getTime()) && now < saleStartDate.getTime()) {
            return `🏷️ সেল ${fmtWhen(saleStartDate)} থেকে শুরু হবে।`;
          }
          if (saleEndDate !== null && !Number.isNaN(saleEndDate.getTime()) && now > saleEndDate.getTime()) {
            return `🏷️ সেলের সময়সীমা শেষ (${fmtWhen(saleEndDate)})।`;
          }
          return saleEndDate !== null && !Number.isNaN(saleEndDate.getTime())
            ? `🏷️ সেল চলছে — ${fmtWhen(saleEndDate)} পর্যন্ত।`
            : "🏷️ সেল চলছে।";
        })();

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {(["basic", "media", "variants", "content", "seo"] as Tab[]).map((t) => (
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
            {t === "basic"
              ? "বেসিক"
              : t === "media"
                ? "মিডিয়া"
                : t === "variants"
                  ? `ভেরিয়েন্ট (${rows.length})`
                  : t === "content"
                    ? "কনটেন্ট"
                    : "SEO"}
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
          {showTypeUi && (
            <label className="block text-sm">
              ধরন
              <select
                value={productType}
                onChange={(e) => setProductType(e.target.value as ProductTypeValue)}
                className={inputCls}
              >
                <option value="SIMPLE">সাধারণ পণ্য (SIMPLE)</option>
                <option value="DIGITAL">ডিজিটাল পণ্য (DIGITAL) — ডাউনলোড / লাইসেন্স</option>
                <option value="BUNDLE">বান্ডল (BUNDLE) — একসাথে কয়েকটি পণ্য</option>
                <option value="PREORDER">প্রি-অর্ডার (PREORDER)</option>
              </select>
              <span className="mt-1 block text-xs text-text-subtle">
                ধরন বদলালে আগের ধরনের তথ্য হারায় না — সেভের সময় শুধু সক্রিয় ধরনের ব্লকটাই যাবে। ধরন অনুযায়ী সেটিংস নিচে আসবে।
              </span>
            </label>
          )}
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
          <label className="block text-sm">
            ওজন (গ্রাম) — কুরিয়ারের ওজন-ভিত্তিক চার্জে লাগে
            <input value={weightGrams} onChange={(e) => setWeightGrams(e.target.value)} inputMode="numeric" className={inputCls} placeholder="যেমন: 500" />
          </label>
          <label className="block text-sm">
            লো-স্টক সতর্কতার সীমা (খালি = গ্লোবাল ডিফল্ট)
            <input value={lowStockThreshold} onChange={(e) => setLowStockThreshold(e.target.value)} inputMode="numeric" className={inputCls} placeholder="যেমন: 5" />
          </label>
          <div className="md:col-span-2">
            <span className="text-sm">প্যাকেজের মাপ (মিলিমিটার)</span>
            <div className="mt-1 grid gap-3 sm:grid-cols-3">
              <label className="block text-xs">
                দৈর্ঘ্য (mm)
                <input value={lengthMm} onChange={(e) => setLengthMm(e.target.value)} inputMode="numeric" className={cellInputCls} placeholder="300" />
              </label>
              <label className="block text-xs">
                প্রস্থ (mm)
                <input value={widthMm} onChange={(e) => setWidthMm(e.target.value)} inputMode="numeric" className={cellInputCls} placeholder="200" />
              </label>
              <label className="block text-xs">
                উচ্চতা (mm)
                <input value={heightMm} onChange={(e) => setHeightMm(e.target.value)} inputMode="numeric" className={cellInputCls} placeholder="50" />
              </label>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface-2 p-3 md:col-span-2">
            <h3 className="text-sm font-semibold">শিডিউল — প্রকাশ ও সেলের সময়</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <label className="block text-xs">
                প্রকাশের সময় (খালি = সঙ্গে সঙ্গে লাইভ)
                <input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} className={cellInputCls} />
              </label>
              <label className="block text-xs">
                সেল শুরু
                <input type="datetime-local" value={saleStartsAt} onChange={(e) => setSaleStartsAt(e.target.value)} className={cellInputCls} />
              </label>
              <label className="block text-xs">
                সেল শেষ
                <input type="datetime-local" value={saleEndsAt} onChange={(e) => setSaleEndsAt(e.target.value)} className={cellInputCls} />
              </label>
            </div>
            <p role="status" className="mt-2 text-xs leading-relaxed text-text-muted">
              {publishLine} {saleLine}
              <span className="block text-text-subtle">
                সেলের সময়সীমা শুধু স্টোরে "সেল চলছে" অবস্থা ঠিক করে — দাম বদলাতে চাইলে ভেরিয়েন্টের Compare-at দাম ব্যবহার করুন। বিবরণ (বাংলা + English) এখন "কনটেন্ট" ট্যাবে।
              </span>
            </p>
          </div>
        </div>
      )}

      {tab === "basic" && showTypeUi && productType === "DIGITAL" && (
        <section className="mt-4 rounded-lg border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold">ডিজিটাল ফাইল — ক্রেতা পেমেন্টের পর যা ডাউনলোড করবে</h3>
          <p className="mt-1 text-xs leading-relaxed text-text-subtle">
            ফাইল আপলোড করুন (সরাসরি স্টোরেজে যাবে), অথবা স্টোরেজে আগে থেকে থাকা ফাইলের key হাতে বসান। প্রকাশ (ACTIVE) করতে অন্তত ১টি ফাইল লাগবে।
          </p>
          <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => digitalFileInputRef.current?.click()}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition motion-fast hover:brightness-105"
              >
                ফাইল আপলোড করুন
              </button>
              <span className="text-xs text-text-subtle">
                যেকোনো ধরনের ফাইল (PDF, ZIP, MP4, সফটওয়্যার…)। আপলোড শেষ হলে ফাইলটি নিচের তালিকায় যোগ হবে; সেভ না করা পর্যন্ত পণ্যে যুক্ত হবে না।
              </span>
              <input
                ref={digitalFileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleDigitalFilesSelected(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {digitalUploadNotice && (
              <p role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                ⚠️ {digitalUploadNotice} — স্টোরেজ সেটআপ না থাকলে উপরের পদ্ধতিতে আপলোড হবে না; তখন key হাতে বসিয়ে সেভ করা যাবে।
              </p>
            )}
            {digitalUploadItems.length > 0 && (
              <ul className="mt-3 space-y-2.5">
                {digitalUploadItems.map((it) => (
                  <li key={it.id} className="text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-text-main">{it.name}</span>
                      <span className="shrink-0 text-xs font-medium">
                        {it.status === "done" ? (
                          <span className="text-emerald-700">✅ আপলোড হয়েছে</span>
                        ) : it.status === "error" ? (
                          <span className="text-rose-600">❌ ব্যর্থ</span>
                        ) : (
                          <span className="text-text-muted">আপলোড হচ্ছে… {it.progress}%</span>
                        )}
                      </span>
                    </div>
                    {it.status === "uploading" && (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-card" role="progressbar" aria-valuenow={it.progress} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${it.progress}%` }} />
                      </div>
                    )}
                    {it.status === "error" && it.error && <p className="mt-1 text-xs text-rose-600">{it.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3 space-y-2.5">
            {digitalRows.length === 0 && (
              <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-text-subtle">
                এখনো কোনো ফাইল যোগ হয়নি।
              </p>
            )}
            {digitalRows.map((row) => (
              <div key={row.key} className="grid items-end gap-2 rounded-md border border-border p-2.5 md:grid-cols-[1.3fr_1fr_0.55fr_auto]">
                <label className="block text-xs">
                  Storage key *
                  <input
                    value={row.storageKey}
                    onChange={(e) =>
                      setDigitalRows((prev) => prev.map((p) => (p.key === row.key ? { ...p, storageKey: e.target.value } : p)))
                    }
                    className={`${cellInputCls} font-mono text-xs`}
                    placeholder="products/slug/files/guide.pdf"
                  />
                </label>
                <label className="block text-xs">
                  ফাইলের নাম (ক্রেতা যা দেখবে) *
                  <input
                    value={row.fileName}
                    onChange={(e) =>
                      setDigitalRows((prev) => prev.map((p) => (p.key === row.key ? { ...p, fileName: e.target.value } : p)))
                    }
                    className={cellInputCls}
                    placeholder="guide.pdf"
                  />
                </label>
                <label className="block text-xs">
                  সাইজ (bytes)
                  <input
                    value={row.sizeBytes}
                    onChange={(e) =>
                      setDigitalRows((prev) => prev.map((p) => (p.key === row.key ? { ...p, sizeBytes: e.target.value } : p)))
                    }
                    inputMode="numeric"
                    className={cellInputCls}
                  />
                  <span className="mt-0.5 block text-[11px] text-text-subtle">
                    {formatFileSize(Number(row.sizeBytes) || 0)}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => setDigitalRows((prev) => prev.filter((p) => p.key !== row.key))}
                  className="rounded-md border border-border px-2.5 py-1.5 text-xs text-rose-600"
                >
                  মুছুন
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setDigitalRows((prev) => [...prev, { key: nextKey(), storageKey: "", fileName: "", sizeBytes: "" }])
            }
            className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium transition motion-fast hover:border-brand-300"
          >
            + ফাইল হাতে যোগ করুন
          </button>

          <div className="mt-5 border-t border-border pt-4">
            <h4 className="text-sm font-semibold">লাইসেন্স কী পুল</h4>
            {mode !== "edit" ? (
              <p className="mt-1 text-sm text-text-muted">
                লাইসেন্স কী যোগ করা যায় পণ্যটি তৈরি হওয়ার পর — এডিট পেজে এসে এই অংশেই কী পুল পাবেন।
              </p>
            ) : (
              <>
                {licenseCounts && (
                  <p className="mt-1 text-xs text-text-muted">
                    মোট {licenseCounts.total}টি কী — ফাঁকা আছে {licenseCounts.available}টি, বরাদ্দ হয়ে গেছে {licenseCounts.assigned}টি।
                    {licenseCounts.available === 0 && " পুল খালি হলে নতুন অর্ডারে কী দেওয়া যাবে না — আরও কী যোগ করুন।"}
                  </p>
                )}
                <label className="mt-2 block text-xs">
                  নতুন কী পেস্ট করুন (প্রতি লাইনে একটি)
                  <textarea
                    value={licensePaste}
                    onChange={(e) => setLicensePaste(e.target.value)}
                    rows={4}
                    className={`${cellInputCls} font-mono text-xs`}
                    placeholder={"XXXX-XXXX-XXXX-XXXX\nYYYY-YYYY-YYYY-YYYY"}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleAddLicenseKeys()}
                  disabled={licenseBusy}
                  className="mt-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition motion-fast hover:brightness-105 disabled:opacity-50"
                >
                  {licenseBusy ? "যোগ হচ্ছে…" : "কী যোগ করুন"}
                </button>
                {licenseNotice && (
                  <p role="status" className="mt-2 text-sm text-text-muted">
                    {licenseNotice}
                  </p>
                )}
                {!licenseLoaded ? (
                  <p className="mt-3 text-sm text-text-subtle">লাইসেন্স কী লোড হচ্ছে…</p>
                ) : licenseKeys.length === 0 ? (
                  <p className="mt-3 text-sm text-text-subtle">এখনো কোনো লাইসেন্স কী যোগ হয়নি।</p>
                ) : (
                  <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2.5">
                    {licenseKeys.map((k) => (
                      <li key={k.id} className="flex items-center justify-between gap-3 text-xs">
                        <span className="min-w-0 truncate font-mono">{k.masked}</span>
                        <span className={`shrink-0 font-medium ${k.assigned ? "text-text-subtle" : "text-emerald-700"}`}>
                          {k.assigned ? "বরাদ্দ হয়ে গেছে" : "ফাঁকা"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[11px] text-text-subtle">
                  নিরাপত্তার জন্য কীগুলো এখানে মাস্ক করা দেখায় — পুরো কী এই পেজে কখনো পাঠানো হয় না।
                </p>
              </>
            )}
          </div>
        </section>
      )}

      {tab === "basic" && showTypeUi && productType === "BUNDLE" && (
        <section className="mt-4 rounded-lg border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold">বান্ডল কম্পোনেন্ট — এই পণ্যটি কিনলে যা যা একসাথে মিলবে</h3>
          <p className="mt-1 text-xs leading-relaxed text-text-subtle">
            অন্য পণ্যের ভেরিয়েন্ট খুঁজে যোগ করুন ও পরিমাণ ঠিক করুন। প্রকাশ (ACTIVE) করতে অন্তত ১টি কম্পোনেন্ট লাগবে। এই পণ্যের নিজের ভেরিয়েন্ট কম্পোনেন্ট হিসেবে যোগ করা যায় না।
          </p>
          <label className="mt-3 block text-sm">
            কম্পোনেন্ট খুঁজুন (পণ্যের নাম বা SKU)
            <input
              value={bundleQuery}
              onChange={(e) => setBundleQuery(e.target.value)}
              className={inputCls}
              placeholder="কমপক্ষে ২ অক্ষর লিখুন…"
            />
          </label>
          {bundleSearching && <p className="mt-2 text-xs text-text-subtle">খোঁজা হচ্ছে…</p>}
          {bundleHits.length > 0 && (
            <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-border p-2">
              {bundleHits.map((hit) => {
                const added = bundleRows.some((r) => r.variantId === hit.variantId);
                return (
                  <li key={hit.variantId} className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-2.5 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{hit.productTitle}</span>
                      <span className="block text-xs text-text-subtle">
                        {hit.variantSku} — {hit.variantLabel} • {formatBdt(hit.pricePoisha)} • স্টক: {hit.stock}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => addBundleComponent(hit)}
                      className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold transition motion-fast hover:border-brand-300 disabled:opacity-50"
                    >
                      {added ? "যোগ হয়েছে ✓" : "যোগ করুন"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 space-y-2">
            {bundleRows.length === 0 && (
              <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-text-subtle">
                এখনো কোনো কম্পোনেন্ট যোগ হয়নি — উপরে খুঁজে যোগ করুন।
              </p>
            )}
            {bundleRows.map((r) => (
              <div key={r.key} className="flex flex-wrap items-center gap-2.5 rounded-md border border-border p-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.productTitle || "অজানা পণ্য"}</span>
                  <span className="block text-xs text-text-subtle">
                    {r.variantSku || r.variantId}
                    {r.variantLabel ? ` — ${r.variantLabel}` : ""}
                    {r.unitPricePoisha !== null ? ` • একক দাম ${formatBdt(r.unitPricePoisha)}` : ""}
                  </span>
                </span>
                <label className="flex items-center gap-1.5 text-xs">
                  পরিমাণ
                  <input
                    value={r.quantity}
                    onChange={(e) =>
                      setBundleRows((prev) => prev.map((p) => (p.key === r.key ? { ...p, quantity: e.target.value } : p)))
                    }
                    inputMode="numeric"
                    className="w-20 rounded-md border border-border bg-card px-2 py-1.5 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                </label>
                {r.unitPricePoisha !== null && (
                  <span className="text-xs font-medium text-text-muted">
                    = {formatBdt(r.unitPricePoisha * (Number(r.quantity) || 0))}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setBundleRows((prev) => prev.filter((p) => p.key !== r.key))}
                  className="rounded-md border border-border px-2.5 py-1.5 text-xs text-rose-600"
                >
                  মুছুন
                </button>
              </div>
            ))}
          </div>
          <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm text-text-muted">
            কম্পোনেন্টগুলোর মোট দাম: <strong className="text-text-main">{formatBdt(bundleKnownTotal)}</strong>
            {"  "}— এই পণ্যের ডিফল্ট দাম: <strong className="text-text-main">{formatBdt(basePricePoisha)}</strong>
            {bundleKnownTotal > 0 && basePricePoisha > 0 && (
              <>
                {"  "}— পার্থক্য:{" "}
                <strong className={bundleKnownTotal - basePricePoisha >= 0 ? "text-emerald-700" : "text-rose-600"}>
                  {formatBdt(Math.abs(bundleKnownTotal - basePricePoisha))}{" "}
                  {bundleKnownTotal - basePricePoisha >= 0 ? "সাশ্রয়" : "বেশি"}
                </strong>
              </>
            )}
            {bundleHasUnknownPrice && (
              <span className="mt-1 block text-xs text-amber-700">
                কয়েকটি কম্পোনেন্টের দাম জানা যায়নি — মোটটি অসম্পূর্ণ হতে পারে।
              </span>
            )}
          </p>
        </section>
      )}

      {tab === "basic" && showTypeUi && productType === "PREORDER" && (
        <section className="mt-4 rounded-lg border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold">প্রি-অর্ডার সেটিংস</h3>
          <p className="mt-1 text-xs leading-relaxed text-text-subtle">
            সব ঘরই ঐচ্ছিক — যা বসাবেন, স্টোরে প্রি-অর্ডার ব্যাজের পাশাপাশি ঠিক সেটাই দেখাবে (অগ্রিমের নোট ও সম্ভাব্য তারিখ)।
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              অগ্রিম (%) — বুকিংয়ের সময় যা নেওয়া হবে
              <input
                value={preorderDeposit}
                onChange={(e) => setPreorderDeposit(e.target.value)}
                inputMode="decimal"
                className={inputCls}
                placeholder="যেমন: 30"
              />
            </label>
            <label className="block text-sm">
              সম্ভাব্য ডেলিভারির তারিখ
              <input
                type="date"
                value={preorderExpected}
                onChange={(e) => setPreorderExpected(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="block text-sm">
              সর্বোচ্চ প্রি-অর্ডার সংখ্যা (খালি = সীমা নেই)
              <input
                value={preorderMaxUnits}
                onChange={(e) => setPreorderMaxUnits(e.target.value)}
                inputMode="numeric"
                className={inputCls}
                placeholder="যেমন: 100"
              />
            </label>
          </div>
        </section>
      )}

      {tab === "media" && (
        <div className="mt-4">
          <p className="text-sm text-text-muted">
            নিজের ডিভাইস থেকে ছবি আপলোড করুন, অথবা হোস্ট করা ছবির URL বসান — ক্রম অনুযায়ী প্রথম ছবিটাই প্রধান ছবি হিসেবে স্টোরে দেখাবে।
          </p>
          <div className="mt-3 rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition motion-fast hover:brightness-105"
              >
                ছবি আপলোড করুন
              </button>
              <span className="text-xs text-text-subtle">
                JPEG, PNG, WebP বা AVIF — প্রতিটি ছবি সর্বোচ্চ 5 MB, একবারে সর্বোচ্চ 10টি। আপলোড শেষ হলে ছবিটি নিচের তালিকায় যোগ হয়ে যাবে; সেভ না করা পর্যন্ত পণ্যে যুক্ত হবে না।
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleFilesSelected(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {uploadNotice && (
              <p role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                ⚠️ {uploadNotice}
              </p>
            )}
            {uploadItems.length > 0 && (
              <ul className="mt-3 space-y-2.5">
                {uploadItems.map((it) => (
                  <li key={it.id} className="text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-text-main">{it.name}</span>
                      <span className="shrink-0 text-xs font-medium">
                        {it.status === "done" ? (
                          <span className="text-emerald-700">✅ আপলোড হয়েছে</span>
                        ) : it.status === "error" ? (
                          <span className="text-rose-600">❌ ব্যর্থ</span>
                        ) : (
                          <span className="text-text-muted">আপলোড হচ্ছে… {it.progress}%</span>
                        )}
                      </span>
                    </div>
                    {it.status === "uploading" && (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={it.progress} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${it.progress}%` }} />
                      </div>
                    )}
                    {it.status === "error" && it.error && <p className="mt-1 text-xs text-rose-600">{it.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
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

      {tab === "content" && (
        <div className="mt-4 grid gap-4">
          <label className="block text-sm">
            প্রোডাক্ট ভিডিওর URL (YouTube বা সরাসরি ভিডিও ফাইল — না থাকলে খালি রাখুন)
            <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} className={inputCls} placeholder="https://…" />
          </label>

          <DescriptionField
            label="বিবরণ (বাংলা) *"
            value={descriptionBn}
            onChange={setDescriptionBn}
            placeholder="পণ্যের বাংলা বিবরণ"
          />
          <DescriptionField
            label="Description (English) *"
            value={descriptionEn}
            onChange={setDescriptionEn}
            placeholder="Product description in English"
          />

          <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">সাইজ চার্ট</h3>
              {sizeChart.headers.length === 0 ? (
                <button
                  type="button"
                  onClick={() => setSizeChart({ headers: ["সাইজ", "মাপ"], rows: [["", ""]] })}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium transition motion-fast hover:border-brand-300"
                >
                  + সাইজ চার্ট যোগ করুন
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setSizeChart({ headers: [], rows: [] })}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-rose-600"
                >
                  সাইজ চার্ট সরিয়ে ফেলুন
                </button>
              )}
            </div>
            {sizeChart.headers.length > 0 && (
              <div className="mt-3">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead>
                      <tr>
                        {sizeChart.headers.map((h, ci) => (
                          <th key={ci} className="px-1 py-1">
                            <span className="flex items-center gap-1">
                              <input
                                value={h}
                                onChange={(e) =>
                                  setSizeChart((prev) => ({
                                    ...prev,
                                    headers: prev.headers.map((x, i) => (i === ci ? e.target.value : x)),
                                  }))
                                }
                                className={cellInputCls}
                                placeholder={`কলাম ${ci + 1}`}
                                aria-label={`সাইজ চার্টের কলাম ${ci + 1}-এর শিরোনাম`}
                              />
                              <button
                                type="button"
                                disabled={sizeChart.headers.length <= 1}
                                onClick={() =>
                                  setSizeChart((prev) => ({
                                    headers: prev.headers.filter((_, i) => i !== ci),
                                    rows: prev.rows.map((r) => r.filter((_, j) => j !== ci)),
                                  }))
                                }
                                className="shrink-0 rounded-md border border-border px-2 py-1.5 text-xs text-rose-600 disabled:opacity-40"
                                aria-label={`কলাম ${ci + 1} মুছুন`}
                              >
                                ✕
                              </button>
                            </span>
                          </th>
                        ))}
                        <th className="px-1 py-1">
                          <button
                            type="button"
                            onClick={() =>
                              setSizeChart((prev) => ({
                                headers: [...prev.headers, ""],
                                rows: prev.rows.map((r) => [...r, ""]),
                              }))
                            }
                            className="whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium"
                          >
                            + কলাম
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sizeChart.rows.map((row, ri) => (
                        <tr key={ri}>
                          {sizeChart.headers.map((_, ci) => (
                            <td key={ci} className="px-1 py-1">
                              <input
                                value={row[ci] ?? ""}
                                onChange={(e) =>
                                  setSizeChart((prev) => ({
                                    ...prev,
                                    rows: prev.rows.map((r, i) =>
                                      i === ri ? r.map((c, j) => (j === ci ? e.target.value : c)) : r,
                                    ),
                                  }))
                                }
                                className={cellInputCls}
                                aria-label={`সাইজ চার্টের সারি ${ri + 1}, কলাম ${ci + 1}`}
                              />
                            </td>
                          ))}
                          <td className="px-1 py-1">
                            <button
                              type="button"
                              onClick={() =>
                                setSizeChart((prev) => ({ ...prev, rows: prev.rows.filter((_, i) => i !== ri) }))
                              }
                              className="whitespace-nowrap rounded-md border border-border px-2.5 py-1.5 text-xs text-rose-600"
                            >
                              সারি মুছুন
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setSizeChart((prev) => ({ ...prev, rows: [...prev.rows, prev.headers.map(() => "")] }))
                  }
                  className="mt-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium transition motion-fast hover:border-brand-300"
                >
                  + সারি যোগ করুন
                </button>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <h3 className="text-sm font-semibold">সাধারণ প্রশ্নোত্তর (FAQ)</h3>
            <div className="mt-3 space-y-3">
              {faqRows.length === 0 && (
                <p className="text-sm text-text-subtle">এখনো কোনো প্রশ্নোত্তর যোগ হয়নি।</p>
              )}
              {faqRows.map((row, ri) => (
                <div key={ri} className="grid gap-2 rounded-md border border-border p-2.5 md:grid-cols-[1fr_1fr_auto]">
                  <label className="block text-xs">
                    প্রশ্ন
                    <input
                      value={row.q}
                      onChange={(e) =>
                        setFaqRows((prev) => prev.map((r, i) => (i === ri ? { ...r, q: e.target.value } : r)))
                      }
                      className={cellInputCls}
                      placeholder="যেমন: ডেলিভারি পেতে কত দিন লাগবে?"
                    />
                  </label>
                  <label className="block text-xs">
                    উত্তর
                    <input
                      value={row.a}
                      onChange={(e) =>
                        setFaqRows((prev) => prev.map((r, i) => (i === ri ? { ...r, a: e.target.value } : r)))
                      }
                      className={cellInputCls}
                      placeholder="উত্তর লিখুন"
                    />
                  </label>
                  <span className="flex items-end">
                    <button
                      type="button"
                      onClick={() => setFaqRows((prev) => prev.filter((_, i) => i !== ri))}
                      className="rounded-md border border-border px-2.5 py-1.5 text-xs text-rose-600"
                    >
                      মুছুন
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setFaqRows((prev) => [...prev, { q: "", a: "" }])}
              className="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium transition motion-fast hover:border-brand-300"
            >
              + প্রশ্নোত্তর যোগ করুন
            </button>
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
          <div className="md:col-span-2">
            <label className="block text-sm">
              OG ছবি (সোশ্যাল মিডিয়ায় শেয়ার করলে যে ছবি দেখাবে)
              <input value={ogImage} onChange={(e) => setOgImage(e.target.value)} className={inputCls} placeholder="https://…" />
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {ogImage.trim() !== "" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ogImage} alt="" className="h-16 w-28 shrink-0 rounded-md border border-border object-cover" />
              )}
              <button
                type="button"
                disabled={!imageRows.some((i) => i.url.trim() !== "")}
                onClick={() => {
                  const first = imageRows.find((i) => i.url.trim() !== "");
                  if (first) setOgImage(first.url.trim());
                }}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium transition motion-fast hover:border-brand-300 disabled:opacity-40"
              >
                প্রথম গ্যালারি ছবি ব্যবহার করুন
              </button>
              <span className="text-xs text-text-subtle">খালি রাখলে শেয়ারিংয়ে প্রথম গ্যালারি ছবিটাই যাবে। মিডিয়া ট্যাব থেকে আপলোড করা ছবির URL-ও এখানে বসানো যাবে।</span>
            </div>
          </div>
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

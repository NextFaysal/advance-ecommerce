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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatBdt } from "@advance-ecommerce/validators";
import { generateVariantDrafts, validateVariantDrafts } from "@/catalog/variants";
import { renderDescriptionHtml } from "@/catalog/description";
import { formatFileSize, type ProductTypeValue, type ProductWithTypeFields } from "@/catalog/product-type-contract";
import type { Product, ProductAttribute, ProductStatus } from "@/catalog/types";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick } from "@/i18n/locale";
import { PRODUCTS_STRINGS } from "./strings";

export interface CategoryOption {
  slug: string;
  nameBn: string;
  nameEn: string;
}

/** One attribute-set library entry (Wave 16-1), slimmed by the server
 *  pages from AdminAttributeSet (src/catalog/attributes-admin). The
 *  variant editor uses it ONLY as a suggestion source: the key input
 *  offers these keys and — when the typed key matches a set — the
 *  value input offers the set's values, both via <datalist>. Typing
 *  a brand-new key/value stays fully allowed. */
export interface AttributeSetOption {
  key: string;
  labelBn: string;
  labelEn: string;
  values: string[];
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
function parseNonNegativeInt(value: string, label: string, errors: string[], template: string): number | null {
  const t = value.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0) {
    errors.push(interpolate(template, { label }));
    return null;
  }
  return n;
}

/** One attribute-generator row (Wave 16-1): a key plus its
 *  comma-separated values, edited as two text inputs. The key input
 *  carries a <datalist> of attribute-set library keys and the value
 *  input a <datalist> of the matched set's values — suggestions only,
 *  never a constraint. */
interface AttrLineRow {
  rowId: number;
  name: string;
  valuesText: string;
}

/** Rebuild attribute rows from loaded variants (edit mode): one row
 *  per key, values aggregated in first-seen order — the same
 *  aggregation the old "key: v1, v2" textarea lines used, so loaded
 *  variants keep their existing pairs untouched. */
function attrRowsFromVariants(
  variants: { attributes: Record<string, string> }[],
): Array<{ name: string; valuesText: string }> {
  const byKey = new Map<string, string[]>();
  for (const v of variants) {
    for (const [k, val] of Object.entries(v.attributes)) {
      const arr = byKey.get(k) ?? [];
      if (!arr.includes(val)) arr.push(val);
      byKey.set(k, arr);
    }
  }
  return [...byKey.entries()].map(([k, vals]) => ({ name: k, valuesText: vals.join(", ") }));
}

const inputCls =
  "mt-1.5 min-h-[44px] w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm shadow-xs outline-none transition duration-base ease-smooth focus:border-brand-ink focus:ring-[3px] focus:ring-brand-ink/15 hover:border-brand-200";
const cellInputCls =
  "min-h-[40px] w-full min-w-[84px] rounded-xl border border-border bg-card px-2.5 py-2 text-sm shadow-xs outline-none transition duration-base ease-smooth focus:border-brand-ink focus:ring-[3px] focus:ring-brand-ink/15 hover:border-brand-200";
const toolbarBtnCls =
  "inline-flex min-h-11 items-center rounded-full border border-border bg-card px-3 text-xs font-semibold transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-soft md:min-h-[36px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300";
const labelCls = "block text-sm font-medium text-text-main";
const hintCls = "mt-1.5 block text-xs leading-relaxed text-text-subtle";

/** Wave 17-2 design refresh — section heading for editor cards: an
 *  accent icon chip (StatCard language) + display title + optional
 *  hint. Purely presentational; glyphs are stroke SVGs in the house
 *  icon style (no icon dependency). */
const GLYPHS: Record<string, ReactNode> = {
  tag: (
    <>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8 8a2 2 0 0 0 2.828 0l7.172-7.172a2 2 0 0 0 0-2.828z" />
      <circle cx="7.5" cy="7.5" r="1" fill="currentColor" />
    </>
  ),
  banknote: (
    <>
      <rect width="20" height="12" x="2" y="6" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m11 12 9.5-9.5" />
      <path d="M15.5 7.5 19 11" />
    </>
  ),
  package: (
    <>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </>
  ),
  image: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </>
  ),
  layers: (
    <>
      <path d="m12 2 9 4.9-9 4.9-9-4.9z" />
      <path d="m3 11.9 9 4.9 9-4.9" />
      <path d="m3 16.9 9 4.9 9-4.9" />
    </>
  ),
  file: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M9 13h6M9 17h6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
};

function SectionHeading({
  glyph,
  title,
  hint,
  chipCls = "bg-brand-50 text-brand-600",
  action,
}: {
  glyph: string;
  title: string;
  hint?: string;
  chipCls?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span
        aria-hidden="true"
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] shadow-sm ring-1 ring-inset ring-black/5 ${chipCls}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
          {GLYPHS[glyph]}
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-base font-semibold leading-snug text-text-main">{title}</h3>
        {hint ? <p className="mt-0.5 text-xs leading-relaxed text-text-subtle">{hint}</p> : null}
      </div>
      {action ?? null}
    </div>
  );
}

/**
 * Wave 57: status line under the AI draft buttons. Errors are the
 * SERVER's message verbatim (e.g. the 503 AI_NOT_CONFIGURED text) —
 * never replaced with a generic "failed" label, so an unconfigured
 * provider is honestly visible instead of looking like a bug.
 */
function AiDraftStatus({ error, note }: { error: string | null; note: string | null }) {
  if (error) {
    return (
      <p role="alert" className="mt-3 rounded-lg border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm leading-relaxed text-danger">
        {error}
      </p>
    );
  }
  if (note) {
    return (
      <p role="status" className="mt-3 rounded-lg border border-success-solid/25 bg-success-soft px-3.5 py-2.5 text-sm leading-relaxed text-success-solid">
        {note}
      </p>
    );
  }
  return null;
}

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
  const { locale } = useLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
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
    const url = window.prompt(s.linkPrompt);
    if (!url || url.trim() === "") return;
    applyToSelection((sel) => `[${sel || s.linkDefault}](${url.trim()})`);
  }

  return (
    <div className="block text-sm">
      <span className="font-medium text-text-main">{label}</span>
      <span className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-border/70 bg-surface-2/70 p-1.5">
        <button type="button" className={toolbarBtnCls} onClick={() => applyToSelection((sel) => `**${sel || s.boldDefault}**`)} aria-label={s.mdBoldAria}>
          B
        </button>
        <button type="button" className={`${toolbarBtnCls} italic`} onClick={() => applyToSelection((sel) => `*${sel || s.italicDefault}*`)} aria-label={s.mdItalicAria}>
          I
        </button>
        <button type="button" className={toolbarBtnCls} onClick={() => prefixCurrentLine("## ")} aria-label={s.mdHeadingAria}>
          H
        </button>
        <button type="button" className={toolbarBtnCls} onClick={() => prefixCurrentLine("- ")} aria-label={s.mdBulletAria}>
          {s.bulletBtn}
        </button>
        <button type="button" className={toolbarBtnCls} onClick={addLink} aria-label={s.mdLinkAria}>
          {s.linkBtn}
        </button>
        <button
          type="button"
          className={`${toolbarBtnCls} ml-auto font-medium`}
          onClick={() => setShowPreview((v) => !v)}
          aria-expanded={showPreview}
        >
          {showPreview ? s.previewHide : s.previewShow}
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
      <span className="mt-1.5 block text-xs leading-relaxed text-text-subtle">
        {s.markdownHint}
      </span>
      {showPreview && (
        <div
          className="anim-fade-in mt-2 rounded-lg border border-border/70 bg-surface-2 px-4 py-3 text-sm leading-relaxed shadow-sm [&_a]:font-medium [&_a]:text-brand-700 [&_a]:underline [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:font-semibold [&_h4]:mb-1 [&_h4]:mt-2 [&_h4]:font-semibold [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
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
  attributeSets = [],
  initial,
  productTypesEnabled = false,
}: {
  mode: "create" | "edit";
  productId?: string;
  categories: CategoryOption[];
  brandNames: string[];
  /** Attribute-set library (Wave 16-1) for the variant generator's
   *  key/value datalists. Default empty: no suggestions, free text
   *  behaves exactly as before. */
  attributeSets?: AttributeSetOption[];
  initial: Product | null;
  /** module.product_types flag, read server-side by the pages.
   *  Default false: every other consumer keeps today's behaviour. */
  productTypesEnabled?: boolean;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
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
  // Attribute generator rows (Wave 16-1): one row per key. Edit mode
  // seeds them from the loaded variants' pairs; create mode (and an
  // attribute-less product) starts with a single blank row.
  const [attrRows, setAttrRows] = useState<AttrLineRow[]>(() => {
    const seeded = initial ? attrRowsFromVariants(initial.variants) : [];
    const base = seeded.length > 0 ? seeded : [{ name: "", valuesText: "" }];
    return base.map((r) => ({ rowId: keySeq.current++, name: r.name, valuesText: r.valuesText }));
  });

  function updateAttrRow(rowId: number, patch: Partial<Omit<AttrLineRow, "rowId">>) {
    setAttrRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  }
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

  // --- AI content drafts (wave 57, module.ai_content) -----------------------
  // The buttons call the draft-only AI routes and fill the ORDINARY
  // form state above — nothing auto-persists; saving still goes
  // through the normal product save after human review.
  const [aiBusy, setAiBusy] = useState<"description" | "seo" | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);

  async function requestAiDraft(kind: "description" | "seo") {
    if (aiBusy) return;
    setAiBusy(kind);
    setAiError(null);
    setAiNote(null);
    try {
      const category = categoryOptions.find((c) => c.slug === categorySlug);
      const name = titleBn.trim() || titleEn.trim();
      const res = await fetch(
        kind === "description"
          ? "/api/v1/admin/products/ai-description"
          : "/api/v1/admin/products/ai-seo",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(mode === "edit" && productId ? { productId } : {}),
            ...(name ? { productName: name } : {}),
            ...(titleEn.trim() ? { productNameEn: titleEn.trim() } : {}),
            ...(category ? { categoryName: category.nameBn } : {}),
            ...(brandName.trim() ? { brandName: brandName.trim() } : {}),
            keywords: tagsText
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          }),
        },
      );
      const json = (await res.json().catch(() => null)) as {
        data?: {
          bn?: string;
          en?: string;
          seoTitleBn?: string;
          seoTitleEn?: string;
          seoDescriptionBn?: string;
          seoDescriptionEn?: string;
        };
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.data) {
        // Server message verbatim — the 503 AI_NOT_CONFIGURED text
        // must reach the admin exactly as the API states it.
        setAiError(json?.error?.message ?? interpolate(s.aiRequestFail, { status: res.status }));
        return;
      }
      if (kind === "description") {
        if (json.data.bn) setDescriptionBn(json.data.bn);
        if (json.data.en) setDescriptionEn(json.data.en);
      } else {
        if (json.data.seoTitleBn) setSeoTitleBn(json.data.seoTitleBn);
        if (json.data.seoTitleEn) setSeoTitleEn(json.data.seoTitleEn);
        if (json.data.seoDescriptionBn) setSeoDescriptionBn(json.data.seoDescriptionBn);
        if (json.data.seoDescriptionEn) setSeoDescriptionEn(json.data.seoDescriptionEn);
      }
      setAiNote(s.aiNoteSaved);
    } catch {
      setAiError(s.aiUnreachable);
    } finally {
      setAiBusy(null);
    }
  }

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
  const [priceOnRequest, setPriceOnRequest] = useState(initial?.priceOnRequest ?? false);
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
    return attrRows
      .map((row) => {
        const key = row.name.trim();
        return {
          key,
          label: { bn: key, en: key },
          values: row.valuesText
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
        };
      })
      .filter((a) => a.key && a.values.length > 0);
  }, [attrRows]);

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
    if (titleBn.trim() === "") errors.push(s.errTitleBn);
    if (titleEn.trim() === "") errors.push(s.errTitleEn);
    if (descriptionBn.trim() === "") errors.push(s.errDescBn);
    if (descriptionEn.trim() === "") errors.push(s.errDescEn);
    if (!SLUG_PATTERN.test(slug)) {
      errors.push(s.errSlug);
    }
    if (categorySlug === "") errors.push(s.errCategory);

    const tags = tagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.some((t) => t.length > 64)) errors.push(s.errTagLong);
    if (tags.length > 50) errors.push(s.errTagMany);

    if (rows.length === 0) errors.push(s.errVariantNeeded);
    const variants: VariantPayload[] = [];
    for (const r of rows) {
      const sku = r.sku.trim();
      if (sku === "") {
        errors.push(s.errSkuEmpty);
        continue;
      }
      const price = takaToPoisha(r.priceTaka);
      if (price === null) {
        errors.push(interpolate(s.errPriceInvalidSku, { sku }));
        continue;
      }
      if (r.compareAtTaka.trim() !== "" && takaToPoisha(r.compareAtTaka) === null) {
        errors.push(interpolate(s.errCompareInvalidSku, { sku }));
        continue;
      }
      if (r.costTaka.trim() !== "" && takaToPoisha(r.costTaka) === null) {
        errors.push(interpolate(s.errCostInvalidSku, { sku }));
        continue;
      }
      const stockNum = Number(r.stock);
      if (r.stock.trim() === "" || !Number.isInteger(stockNum) || stockNum < 0) {
        errors.push(interpolate(s.errStockInvalidSku, { sku }));
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
        errors.push(interpolate(s.errVariantPrefix, { msg: e }));
      }
    }

    const images = imageRows
      .filter((i) => i.url.trim() !== "")
      .map((i, idx) => ({ url: i.url.trim(), altBn: i.altBn, altEn: i.altEn, sortOrder: idx }));
    if (images.length > 20) errors.push(s.errImagesMany);

    // --- Wave 14 fields -------------------------------------------------
    const weightGramsValue = parseNonNegativeInt(weightGrams, s.lblWeight, errors, s.errNonNegInt);
    const lengthMmValue = parseNonNegativeInt(lengthMm, s.lblLength, errors, s.errNonNegInt);
    const widthMmValue = parseNonNegativeInt(widthMm, s.lblWidth, errors, s.errNonNegInt);
    const heightMmValue = parseNonNegativeInt(heightMm, s.lblHeight, errors, s.errNonNegInt);
    const lowStockThresholdValue = parseNonNegativeInt(lowStockThreshold, s.lblLowStock, errors, s.errNonNegInt);

    const videoUrlValue = emptyToNull(videoUrl);
    if (videoUrlValue !== null) {
      try {
        new URL(videoUrlValue);
      } catch {
        errors.push(s.errVideoUrl);
      }
    }

    if (publishAt.trim() !== "" && localInputToIso(publishAt) === null) {
      errors.push(s.errPublishTime);
    }
    if (saleStartsAt.trim() !== "" && localInputToIso(saleStartsAt) === null) {
      errors.push(s.errSaleStart);
    }
    if (saleEndsAt.trim() !== "" && localInputToIso(saleEndsAt) === null) {
      errors.push(s.errSaleEnd);
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
      errors.push(s.errSizeChartHeaders);
    }

    // FAQ: fully-blank rows drop out; a half-filled row is an error.
    const faqItemsValue: { q: string; a: string }[] = [];
    for (const row of faqRows) {
      const q = row.q.trim();
      const a = row.a.trim();
      if (q === "" && a === "") continue;
      if (q === "" || a === "") {
        errors.push(s.errFaqPair);
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
          errors.push(s.errDigitalRow);
          break;
        }
        const size = Number(sizeText);
        if (sizeText === "" || !Number.isInteger(size) || size < 0) {
          errors.push(interpolate(s.errDigitalSize, { name: fileName }));
          continue;
        }
        digitalFilesValue.push({ storageKey, fileName, sizeBytes: size });
      }
      if (effectiveStatus === "ACTIVE" && digitalFilesValue.length === 0) {
        errors.push(s.errDigitalActive);
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
          errors.push(interpolate(s.errBundleQty, { ref: row.variantSku || row.variantId }));
          continue;
        }
        bundleComponentsValue.push({ variantId: row.variantId, quantity: qty });
      }
      if (effectiveStatus === "ACTIVE" && bundleComponentsValue.length === 0) {
        errors.push(s.errBundleActive);
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
          errors.push(s.errPreorderDeposit);
        } else {
          deposit = n;
        }
      }
      const maxUnits = parseNonNegativeInt(preorderMaxUnits, s.lblMaxPreorder, errors, s.errNonNegInt);
      if (maxUnits !== null && maxUnits < 1) {
        errors.push(s.errPreorderMax);
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
      priceOnRequest,
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
        return { errors: [s.errPriceReasonSave] };
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
      setSaveMessage(s.saveFixHeading);
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
        setSaveMessage(data.error?.message ?? s.saveFailedDefault);
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
        setSaveMessage(s.productCreated);
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
          ? s.savedLedger
          : s.savedChanges,
      );
      router.refresh();
    } catch {
      setSaveStatus("error");
      setSaveMessage(s.saveNetworkError);
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
          fail(interpolate(s.uploadStorageFail, { status: xhr.status }));
        }
      };
      xhr.onerror = () => fail(s.uploadNetworkFail);
      xhr.onabort = () => fail(s.uploadAborted);
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
        const message = data.error?.message ?? s.uploadStartFail;
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
      markAllError(s.uploadServerUnreachable);
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
          fail(interpolate(s.uploadStorageFail, { status: xhr.status }));
        }
      };
      xhr.onerror = () => fail(s.uploadNetworkFail);
      xhr.onabort = () => fail(s.uploadAborted);
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
        const message = data.error?.message ?? s.uploadStartFail;
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
            markAllError(s.digitalKeyMissing);
            return Promise.resolve();
          }
          return putDigitalFileWithProgress(file, { uploadUrl: ticket.uploadUrl, storageKey }, item.id);
        }),
      );
    } catch {
      markAllError(s.uploadServerUnreachable);
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
        setLicenseNotice(json.error?.message ?? s.licenseLoadFail);
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
      setLicenseNotice(s.licenseLoadNetwork);
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
      setLicenseNotice(s.licensePasteFirst);
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
        setLicenseNotice(json.error?.message ?? s.licenseAddFail);
        return;
      }
      const added = json.data?.added ?? json.data?.inserted ?? keys.length;
      const dup = json.data?.duplicates ?? json.data?.skippedDuplicates ?? json.data?.skipped ?? 0;
      setLicensePaste("");
      setLicenseNotice(
        interpolate(s.licenseAdded, {
          added,
          dupPart: dup > 0 ? interpolate(s.licenseAddedDupPart, { dup }) : "",
        }),
      );
      // Reload the masked list + counts from the server (source of truth).
      setLicenseLoaded(false);
    } catch {
      setLicenseNotice(s.licenseAddNetwork);
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
              variantLabel: Object.values(v.attributes ?? {}).join(" / ") || s.variantStandard,
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
              variantLabel: Object.values(v.attributes ?? {}).join(" / ") || s.variantStandard,
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
    { key: "title", label: s.qualityTitleItem },
    { key: "image", label: s.qualityImageItem },
    { key: "description", label: s.qualityDescItem },
    { key: "price", label: s.qualityPriceItem },
    { key: "seo", label: s.qualitySeoItem },
  ] as const;

  // Live schedule status (wave 14) — derived from the CURRENT form
  // state, so the merchant sees the effect before saving. Mirrors the
  // server rules: publishAt gates public visibility (read-time), the
  // sale window only drives the public saleActive flag.
  const fmtWhen = (d: Date) => d.toLocaleString(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
  const publishDate = publishAt.trim() !== "" ? new Date(publishAt) : null;
  const publishLine =
    status !== "ACTIVE"
      ? interpolate(s.publishLineDraft, { status })
      : publishDate !== null && !Number.isNaN(publishDate.getTime()) && publishDate.getTime() > Date.now()
        ? interpolate(s.publishLineScheduled, { when: fmtWhen(publishDate) })
        : s.publishLineLive;
  const saleStartDate = saleStartsAt.trim() !== "" ? new Date(saleStartsAt) : null;
  const saleEndDate = saleEndsAt.trim() !== "" ? new Date(saleEndsAt) : null;
  const saleLine =
    saleStartDate === null && saleEndDate === null
      ? s.saleLineNone
      : (() => {
          const now = Date.now();
          if (saleStartDate !== null && !Number.isNaN(saleStartDate.getTime()) && now < saleStartDate.getTime()) {
            return interpolate(s.saleLineStarts, { when: fmtWhen(saleStartDate) });
          }
          if (saleEndDate !== null && !Number.isNaN(saleEndDate.getTime()) && now > saleEndDate.getTime()) {
            return interpolate(s.saleLineEnded, { when: fmtWhen(saleEndDate) });
          }
          return saleEndDate !== null && !Number.isNaN(saleEndDate.getTime())
            ? interpolate(s.saleLineRunningUntil, { when: fmtWhen(saleEndDate) })
            : s.saleLineRunning;
        })();

  return (
    <div>
      {/* Tab rail (v3 pattern): scrollable on mobile, gradient
       *  underline marks the active tab, counts ride as chips. */}
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto border-b border-border" role="tablist">
          {(["basic", "media", "variants", "content", "seo"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`relative flex min-h-[44px] shrink-0 items-center gap-2 px-3.5 text-sm font-medium transition duration-fast ease-smooth sm:px-4 ${
                tab === t ? "text-brand-700" : "text-text-muted hover:text-text-main"
              }`}
            >
              {t === "basic"
                ? s.tabBasic
                : t === "media"
                  ? s.tabMedia
                  : t === "variants"
                    ? s.tabVariants
                    : t === "content"
                      ? s.tabContent
                      : "SEO"}
              {t === "variants" ? (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums ${
                    tab === t ? "bg-brand-100 text-brand-700" : "bg-surface-2 text-text-muted"
                  }`}
                >
                  {rows.length}
                </span>
              ) : null}
              <span
                aria-hidden="true"
                className={`bg-brand-600 absolute inset-x-3 -bottom-px h-[2.5px] rounded-full transition duration-base ease-smooth ${
                  tab === t ? "opacity-100" : "opacity-0"
                }`}
              />
            </button>
          ))}
        </div>
        {mode === "edit" && status === "ACTIVE" && (
          <Link
            href={`/product/${slug}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-border bg-card px-4 text-sm font-medium text-brand-700 shadow-sm transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            {s.viewStorefront}
          </Link>
        )}
      </div>

      {tab === "basic" && (
        <div className="mt-5 space-y-4">
          <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
            <SectionHeading glyph="tag" title={s.basicInfo} />
            <div className="grid gap-4 md:grid-cols-2">
          <label className={labelCls}>
            {s.titleBnLabel}
            <input value={titleBn} onChange={(e) => handleTitleBnChange(e.target.value)} className={inputCls} placeholder={s.titleBnPh} />
          </label>
          <label className={labelCls}>
            {s.titleEnLabel}
            <input value={titleEn} onChange={(e) => handleTitleEnChange(e.target.value)} className={inputCls} placeholder={s.titleEnPh} />
          </label>
          <label className={labelCls}>
            {s.slugLabel}
            <span className="mt-1.5 flex gap-2">
              <input
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugTouched(true);
                }}
                className="min-h-[44px] w-full rounded-md border border-border bg-card px-3.5 py-2.5 font-mono text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 hover:border-brand-200"
                placeholder={s.slugPh}
              />
              <button
                type="button"
                onClick={regenerateSlug}
                className="inline-flex min-h-[44px] shrink-0 items-center rounded-md border border-border bg-card px-3.5 text-sm font-medium shadow-sm transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                {s.slugFromTitle}
              </button>
            </span>
            <span className={hintCls}>
              {interpolate(s.slugHint, { slug: slug || "…" })}
            </span>
          </label>
          <label className={labelCls}>
            {s.statusLabel}
            <select value={status} onChange={(e) => setStatus(e.target.value as ProductStatus)} className={inputCls}>
              <option value="DRAFT">{s.statusDraftOpt}</option>
              <option value="ACTIVE">{s.statusActiveOpt}</option>
              <option value="ARCHIVED">{s.statusArchivedOpt}</option>
            </select>
          </label>
          {showTypeUi && (
            <label className={labelCls}>
              {s.typeLabel}
              <select
                value={productType}
                onChange={(e) => setProductType(e.target.value as ProductTypeValue)}
                className={inputCls}
              >
                <option value="SIMPLE">{s.typeSimple}</option>
                <option value="DIGITAL">{s.typeDigital}</option>
                <option value="BUNDLE">{s.typeBundle}</option>
                <option value="PREORDER">{s.typePreorder}</option>
              </select>
              <span className={hintCls}>
                {s.typeHint}
              </span>
            </label>
          )}
          <label className={labelCls}>
            {s.categoryLabel}
            <select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className={inputCls}>
              {categoryOptions.length === 0 && <option value="">{s.categoryNone}</option>}
              {categoryOptions.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.nameBn} ({c.nameEn})
                </option>
              ))}
            </select>
            {categoryOptions.length === 0 && (
              <span className="mt-1 block text-xs text-danger">
                {s.categoryEmptyWarn}
              </span>
            )}
          </label>
          <label className={labelCls}>
            {s.brandLabel}
            <input
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className={inputCls}
              placeholder={s.brandPh}
              list="product-editor-brand-names"
            />
            <datalist id="product-editor-brand-names">
              {brandNames.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
            <span className={hintCls}>{s.brandHint}</span>
          </label>
          <label className={`${labelCls} md:col-span-2`}>
            {s.tagsLabel}
            <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} className={inputCls} placeholder={s.tagsPh} />
          </label>
            </div>
          </section>
          <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
            <SectionHeading glyph="banknote" title={s.priceSection} />
            <div className="grid gap-4 md:grid-cols-2">
          <label className={labelCls}>
            {s.defaultPriceLabel}
            <input value={basePriceTaka} onChange={(e) => setBasePriceTaka(e.target.value)} inputMode="decimal" className={inputCls} placeholder={s.defaultPricePh} />
            <span className={hintCls}>
              {interpolate(s.defaultPriceHint, { poisha: basePricePoisha, formatted: formatBdt(basePricePoisha) })}
            </span>
          </label>
          <label className={labelCls}>
            {s.defaultCompareLabel}
            <input value={baseCompareAtTaka} onChange={(e) => setBaseCompareAtTaka(e.target.value)} inputMode="decimal" className={inputCls} placeholder={s.defaultComparePh} />
          </label>
          <label className={labelCls}>
            {s.defaultCostLabel}
            <input value={baseCostTaka} onChange={(e) => setBaseCostTaka(e.target.value)} inputMode="decimal" className={inputCls} placeholder={s.defaultCostPh} />
          </label>
          <label className={labelCls}>
            {s.weightLabel}
            <input value={weightGrams} onChange={(e) => setWeightGrams(e.target.value)} inputMode="numeric" className={inputCls} placeholder={s.weightPh} />
          </label>
          <label className={labelCls}>
            {s.lowStockLabel}
            <input value={lowStockThreshold} onChange={(e) => setLowStockThreshold(e.target.value)} inputMode="numeric" className={inputCls} placeholder={s.lowStockPh} />
          </label>
          <label className="flex items-start gap-2.5 self-center rounded-lg border border-border/70 bg-surface-2/60 p-3.5 text-sm text-text-main md:col-span-2">
            <input
              type="checkbox"
              checked={priceOnRequest}
              onChange={(e) => setPriceOnRequest(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
            />
            <span>
              <span className="font-medium">{s.priceOnRequestTitle}</span>
              <span className="block text-xs leading-5 text-text-muted">
                {s.priceOnRequestDesc}
              </span>
            </span>
          </label>
          <div className="rounded-lg border border-border/70 bg-surface-2/60 p-3.5 md:col-span-2">
            <span className="text-sm font-medium text-text-main">{s.packageSize}</span>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <label className="block text-xs font-medium text-text-muted">
                {s.lengthLabel}
                <input value={lengthMm} onChange={(e) => setLengthMm(e.target.value)} inputMode="numeric" className={`${cellInputCls} mt-1.5`} placeholder="300" />
              </label>
              <label className="block text-xs font-medium text-text-muted">
                {s.widthLabel}
                <input value={widthMm} onChange={(e) => setWidthMm(e.target.value)} inputMode="numeric" className={`${cellInputCls} mt-1.5`} placeholder="200" />
              </label>
              <label className="block text-xs font-medium text-text-muted">
                {s.heightLabel}
                <input value={heightMm} onChange={(e) => setHeightMm(e.target.value)} inputMode="numeric" className={`${cellInputCls} mt-1.5`} placeholder="50" />
              </label>
            </div>
          </div>
            </div>
          </section>
          <section className="brand-soft-gradient rounded-2xl border border-brand-100 p-4 shadow-xs sm:p-5">
            <SectionHeading glyph="clock" title={s.scheduleTitle} chipCls="bg-card text-brand-600" />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-xs font-medium text-text-muted">
                {s.publishAtLabel}
                <input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} className={`${cellInputCls} mt-1.5 bg-card`} />
              </label>
              <label className="block text-xs font-medium text-text-muted">
                {s.saleStartLabel}
                <input type="datetime-local" value={saleStartsAt} onChange={(e) => setSaleStartsAt(e.target.value)} className={`${cellInputCls} mt-1.5 bg-card`} />
              </label>
              <label className="block text-xs font-medium text-text-muted">
                {s.saleEndLabel}
                <input type="datetime-local" value={saleEndsAt} onChange={(e) => setSaleEndsAt(e.target.value)} className={`${cellInputCls} mt-1.5 bg-card`} />
              </label>
            </div>
            <div role="status" className="mt-3.5 rounded-md border border-brand-200/70 bg-card/80 px-3.5 py-2.5 text-small font-medium leading-relaxed text-text-main shadow-sm">
              {publishLine} {saleLine}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-text-subtle">
              {s.scheduleNote}
            </p>
          </section>
        </div>
      )}

      {tab === "basic" && showTypeUi && productType === "DIGITAL" && (
        <section className="mt-4 rounded-2xl border border-brand-ink/20 bg-card p-4 shadow-xs sm:p-5">
          <SectionHeading
            glyph="download"
            chipCls="bg-brand-soft text-brand-ink"
            title={s.digitalTitle}
            hint={s.digitalHint}
          />
          <div className="rounded-lg border border-dashed border-brand-ink/30 bg-brand-soft/60 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => digitalFileInputRef.current?.click()}
                className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-md transition duration-fast ease-smooth hover:brightness-105"
              >
                {s.digitalUploadBtn}
              </button>
              <span className="text-xs text-text-subtle">
                {s.digitalUploadNote}
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
              <p role="status" className="mt-3 rounded-md border border-warning-solid/40 bg-warning-soft px-3 py-2 text-sm text-warning-solid">
                ⚠️ {digitalUploadNotice}{s.digitalNoticeSuffix}
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
                          <span className="text-success-solid">{s.uploadDone}</span>
                        ) : it.status === "error" ? (
                          <span className="text-danger">{s.uploadFailed}</span>
                        ) : (
                          <span className="text-text-muted">{interpolate(s.uploadingPct, { pct: it.progress })}</span>
                        )}
                      </span>
                    </div>
                    {it.status === "uploading" && (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-card" role="progressbar" aria-valuenow={it.progress} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${it.progress}%` }} />
                      </div>
                    )}
                    {it.status === "error" && it.error && <p className="mt-1 text-xs text-danger">{it.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-3 space-y-2.5">
            {digitalRows.length === 0 && (
              <p className="rounded-lg border border-dashed border-brand-ink/20 bg-brand-soft/40 px-4 py-6 text-center text-sm text-text-subtle">
                {s.digitalEmpty}
              </p>
            )}
            {digitalRows.map((row) => (
              <div key={row.key} className="grid items-end gap-2.5 rounded-lg border border-border/70 bg-surface-2/50 p-3 md:grid-cols-[1.3fr_1fr_0.55fr_auto]">
                <label className="block text-xs">
                  {s.storageKeyLabel}
                  <input
                    value={row.storageKey}
                    onChange={(e) =>
                      setDigitalRows((prev) => prev.map((p) => (p.key === row.key ? { ...p, storageKey: e.target.value } : p)))
                    }
                    className={`${cellInputCls} mt-1 font-mono text-xs`}
                    placeholder="products/slug/files/guide.pdf"
                  />
                </label>
                <label className="block text-xs">
                  {s.digitalFileNameLabel}
                  <input
                    value={row.fileName}
                    onChange={(e) =>
                      setDigitalRows((prev) => prev.map((p) => (p.key === row.key ? { ...p, fileName: e.target.value } : p)))
                    }
                    className={`${cellInputCls} mt-1`}
                    placeholder={s.digitalFileNamePh}
                  />
                </label>
                <label className="block text-xs">
                  {s.sizeBytesLabel}
                  <input
                    value={row.sizeBytes}
                    onChange={(e) =>
                      setDigitalRows((prev) => prev.map((p) => (p.key === row.key ? { ...p, sizeBytes: e.target.value } : p)))
                    }
                    inputMode="numeric"
                    className={`${cellInputCls} mt-1`}
                  />
                  <span className="mt-0.5 block text-[11px] text-text-subtle">
                    {formatFileSize(Number(row.sizeBytes) || 0)}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => setDigitalRows((prev) => prev.filter((p) => p.key !== row.key))}
                  className="inline-flex min-h-[40px] items-center justify-center rounded-md border border-border bg-card px-3 text-xs font-semibold text-danger transition duration-fast ease-smooth hover:border-danger/25 hover:bg-danger-soft"
                >
                  {s.deleteBtn}
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              setDigitalRows((prev) => [...prev, { key: nextKey(), storageKey: "", fileName: "", sizeBytes: "" }])
            }
            className="mt-3 inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium shadow-sm transition duration-fast ease-smooth hover:border-brand-ink/30 hover:bg-brand-soft"
          >
            {s.addFileManual}
          </button>

          <div className="mt-6 rounded-lg border border-brand-ink/10 bg-brand-soft/40 p-4">
            <div className="flex items-center gap-2.5">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand-ink shadow-sm ring-1 ring-inset ring-black/5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  {GLYPHS.key}
                </svg>
              </span>
              <h4 className="font-display text-sm font-semibold text-text-main">{s.licenseTitle}</h4>
            </div>
            {mode !== "edit" ? (
              <p className="mt-2 text-sm leading-relaxed text-text-muted">
                {s.licenseCreateNote}
              </p>
            ) : (
              <>
                {licenseCounts && (
                  <>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs font-semibold text-text-main shadow-sm ring-1 ring-inset ring-brand-ink/10">
                        {interpolate(s.licenseTotal, { count: licenseCounts.total })}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1.5 text-xs font-semibold text-success-solid ring-1 ring-inset ring-success-solid/20">
                        {interpolate(s.licenseAvailable, { count: licenseCounts.available })}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-muted ring-1 ring-inset ring-black/5">
                        {interpolate(s.licenseAssigned, { count: licenseCounts.assigned })}
                      </span>
                    </div>
                    {licenseCounts.available === 0 && (
                      <p className="mt-2 text-xs leading-relaxed text-warning-solid">
                        {s.licenseEmptyWarn}
                      </p>
                    )}
                  </>
                )}
                <label className="mt-3 block text-xs font-medium text-text-muted">
                  {s.licensePasteLabel}
                  <textarea
                    value={licensePaste}
                    onChange={(e) => setLicensePaste(e.target.value)}
                    rows={4}
                    className={`${cellInputCls} mt-1.5 bg-card font-mono text-xs`}
                    placeholder={"XXXX-XXXX-XXXX-XXXX\nYYYY-YYYY-YYYY-YYYY"}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleAddLicenseKeys()}
                  disabled={licenseBusy}
                  className="mt-2.5 inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-md transition duration-fast ease-smooth hover:brightness-105 disabled:opacity-50"
                >
                  {licenseBusy ? s.licenseAdding : s.licenseAddBtn}
                </button>
                {licenseNotice && (
                  <p role="status" className="mt-2 text-sm text-text-muted">
                    {licenseNotice}
                  </p>
                )}
                {!licenseLoaded ? (
                  <p className="mt-3 text-sm text-text-subtle">{s.licenseLoading}</p>
                ) : licenseKeys.length === 0 ? (
                  <p className="mt-3 text-sm text-text-subtle">{s.licenseEmpty}</p>
                ) : (
                  <ul className="mt-3 max-h-56 divide-y divide-border/70 overflow-y-auto rounded-lg border border-border/70 bg-card px-3 shadow-sm">
                    {licenseKeys.map((k) => (
                      <li key={k.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                        <span className="min-w-0 truncate font-mono">{k.masked}</span>
                        <span
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset ring-black/5 ${
                            k.assigned ? "bg-surface-2 text-text-subtle" : "bg-success-soft text-success-solid"
                          }`}
                        >
                          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${k.assigned ? "bg-text-subtle" : "bg-success-soft0"}`} />
                          {k.assigned ? s.licenseAssignedChip : s.licenseAvailableChip}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[11px] text-text-subtle">
                  {s.licenseMaskNote}
                </p>
              </>
            )}
          </div>
        </section>
      )}

      {tab === "basic" && showTypeUi && productType === "BUNDLE" && (
        <section className="mt-4 rounded-2xl border border-warning-solid/25 bg-card p-4 shadow-xs sm:p-5">
          <SectionHeading
            glyph="layers"
            chipCls="bg-warning-soft text-warning-solid"
            title={s.bundleTitle}
            hint={s.bundleHint}
          />
          <label className={labelCls}>
            {s.bundleSearchLabel}
            <input
              value={bundleQuery}
              onChange={(e) => setBundleQuery(e.target.value)}
              className={inputCls}
              placeholder={s.bundleSearchPh}
            />
          </label>
          {bundleSearching && <p className="mt-2 text-xs text-text-subtle">{s.searching}</p>}
          {bundleHits.length > 0 && (
            <ul className="anim-fade-in mt-2 max-h-64 space-y-1.5 overflow-y-auto rounded-lg border border-border/70 bg-surface-2/50 p-2">
              {bundleHits.map((hit) => {
                const added = bundleRows.some((r) => r.variantId === hit.variantId);
                return (
                  <li key={hit.variantId} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-card px-3 py-2.5 text-sm shadow-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{hit.productTitle}</span>
                      <span className="block text-xs text-text-subtle">
                        {interpolate(s.bundleHitMeta, { sku: hit.variantSku, label: hit.variantLabel, price: formatBdt(hit.pricePoisha), stock: hit.stock })}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => addBundleComponent(hit)}
                      className="inline-flex min-h-[40px] items-center rounded-md border border-border bg-card px-3 text-xs font-semibold transition duration-fast ease-smooth hover:border-warning-solid/40 hover:bg-warning-soft disabled:opacity-50"
                    >
                      {added ? s.bundleAdded : s.bundleAdd}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 space-y-2.5">
            {bundleRows.length === 0 && (
              <p className="rounded-lg border border-dashed border-warning-solid/25 bg-warning-soft/40 px-4 py-6 text-center text-sm text-text-subtle">
                {s.bundleEmpty}
              </p>
            )}
            {bundleRows.map((r) => (
              <div key={r.key} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border/70 bg-surface-2/50 p-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.productTitle || s.unknownProduct}</span>
                  <span className="block text-xs text-text-subtle">
                    {r.variantSku || r.variantId}
                    {r.variantLabel ? ` — ${r.variantLabel}` : ""}
                    {r.unitPricePoisha !== null ? interpolate(s.bundleUnitPricePart, { price: formatBdt(r.unitPricePoisha) }) : ""}
                  </span>
                </span>
                <label className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
                  {s.bundleQtyLabel}
                  <input
                    value={r.quantity}
                    onChange={(e) =>
                      setBundleRows((prev) => prev.map((p) => (p.key === r.key ? { ...p, quantity: e.target.value } : p)))
                    }
                    inputMode="numeric"
                    className="min-h-[40px] w-20 rounded-md border border-border bg-card px-2.5 py-2 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
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
                  className="inline-flex min-h-[40px] items-center rounded-md border border-border bg-card px-3 text-xs font-semibold text-danger transition duration-fast ease-smooth hover:border-danger/25 hover:bg-danger-soft"
                >
                  {s.deleteBtn}
                </button>
              </div>
            ))}
          </div>
          <p className="brand-soft-gradient mt-4 rounded-lg border border-brand-100 px-4 py-3 text-small text-text-muted shadow-sm">
            {s.bundleComponentsTotal} <strong className="text-text-main">{formatBdt(bundleKnownTotal)}</strong>
            {"  "}{s.bundleOwnPrice} <strong className="text-text-main">{formatBdt(basePricePoisha)}</strong>
            {bundleKnownTotal > 0 && basePricePoisha > 0 && (
              <>
                {"  "}{s.bundleDiffPart}{" "}
                <strong className={bundleKnownTotal - basePricePoisha >= 0 ? "text-success-solid" : "text-danger"}>
                  {formatBdt(Math.abs(bundleKnownTotal - basePricePoisha))}{" "}
                  {bundleKnownTotal - basePricePoisha >= 0 ? s.bundleSavings : s.bundleExtra}
                </strong>
              </>
            )}
            {bundleHasUnknownPrice && (
              <span className="mt-1 block text-xs text-warning-solid">
                {s.bundleUnknownNote}
              </span>
            )}
          </p>
        </section>
      )}

      {tab === "basic" && showTypeUi && productType === "PREORDER" && (
        <section className="mt-4 rounded-2xl border border-info-solid/25 bg-card p-4 shadow-xs sm:p-5">
          <SectionHeading
            glyph="clock"
            chipCls="bg-info-soft text-info-solid"
            title={s.preorderTitle}
            hint={s.preorderHint}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <label className={labelCls}>
              {s.preorderDepositLabel}
              <input
                value={preorderDeposit}
                onChange={(e) => setPreorderDeposit(e.target.value)}
                inputMode="decimal"
                className={inputCls}
                placeholder={s.preorderDepositPh}
              />
            </label>
            <label className={labelCls}>
              {s.preorderDateLabel}
              <input
                type="date"
                value={preorderExpected}
                onChange={(e) => setPreorderExpected(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className={labelCls}>
              {s.preorderMaxLabel}
              <input
                value={preorderMaxUnits}
                onChange={(e) => setPreorderMaxUnits(e.target.value)}
                inputMode="numeric"
                className={inputCls}
                placeholder={s.preorderMaxPh}
              />
            </label>
          </div>
        </section>
      )}

      {tab === "media" && (
        <section className="mt-5 rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
          <SectionHeading
            glyph="image"
            title={s.mediaTitle}
            hint={s.mediaHint}
          />
          <div className="rounded-lg border-2 border-dashed border-brand-200 bg-brand-50/40 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-md transition duration-fast ease-smooth hover:brightness-105"
              >
                {s.mediaUploadBtn}
              </button>
              <span className="max-w-xl text-xs leading-relaxed text-text-subtle">
                {s.mediaUploadNote}
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
              <p role="status" className="mt-3 rounded-md border border-warning-solid/40 bg-warning-soft px-3 py-2 text-sm text-warning-solid">
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
                          <span className="text-success-solid">{s.uploadDone}</span>
                        ) : it.status === "error" ? (
                          <span className="text-danger">{s.uploadFailed}</span>
                        ) : (
                          <span className="text-text-muted">{interpolate(s.uploadingPct, { pct: it.progress })}</span>
                        )}
                      </span>
                    </div>
                    {it.status === "uploading" && (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={it.progress} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${it.progress}%` }} />
                      </div>
                    )}
                    {it.status === "error" && it.error && <p className="mt-1 text-xs text-danger">{it.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-4 grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {imageRows.length === 0 && (
              <p className="rounded-lg border border-dashed border-brand-200 bg-brand-50/40 px-4 py-8 text-center text-sm text-text-subtle sm:col-span-2 xl:col-span-3">
                {s.mediaEmpty}
              </p>
            )}
            {imageRows.map((img, idx) => (
              <div key={img.key} className="flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xs">
                <div className="relative">
                  {img.url.trim() !== "" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img.url} alt={img.altEn || img.altBn} className="aspect-[4/3] w-full object-cover" />
                  ) : (
                    <span className="flex aspect-[4/3] w-full items-center justify-center border-b border-dashed border-border bg-surface-2/60 text-xs text-text-subtle">{s.mediaNoImage}</span>
                  )}
                  {idx === 0 && (
                    <span className="bg-brand-600 absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none text-white shadow-md">
                      {s.mediaPrimary}
                    </span>
                  )}
                  <span aria-hidden="true" title={s.mediaDragTitle} className="absolute right-2.5 top-2.5 flex h-7 w-7 cursor-grab items-center justify-center rounded-md bg-card/85 text-text-muted shadow-sm backdrop-blur">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
                      <circle cx="9" cy="5" r="1.6" />
                      <circle cx="15" cy="5" r="1.6" />
                      <circle cx="9" cy="12" r="1.6" />
                      <circle cx="15" cy="12" r="1.6" />
                      <circle cx="9" cy="19" r="1.6" />
                      <circle cx="15" cy="19" r="1.6" />
                    </svg>
                  </span>
                </div>
                <div className="grid flex-1 gap-2.5 p-3">
                  <label className="block text-xs font-medium text-text-muted">
                    {s.imageUrlLabel}
                    <input
                      value={img.url}
                      onChange={(e) =>
                        setImageRows((prev) => prev.map((p) => (p.key === img.key ? { ...p, url: e.target.value } : p)))
                      }
                      className={`${cellInputCls} mt-1`}
                      placeholder="https://…"
                    />
                  </label>
                  <label className="block text-xs font-medium text-text-muted">
                    {s.altBnLabel}
                    <input
                      value={img.altBn}
                      onChange={(e) =>
                        setImageRows((prev) => prev.map((p) => (p.key === img.key ? { ...p, altBn: e.target.value } : p)))
                      }
                      className={`${cellInputCls} mt-1`}
                    />
                  </label>
                  <label className="block text-xs font-medium text-text-muted">
                    {s.altEnLabel}
                    <input
                      value={img.altEn}
                      onChange={(e) =>
                        setImageRows((prev) => prev.map((p) => (p.key === img.key ? { ...p, altEn: e.target.value } : p)))
                      }
                      className={`${cellInputCls} mt-1`}
                    />
                  </label>
                  <span className="mt-auto flex items-center gap-1.5 border-t border-border/60 pt-2.5">
                    <button
                      type="button"
                      aria-label={s.imageUpAria}
                      disabled={idx === 0}
                      onClick={() =>
                        setImageRows((prev) => {
                          const copy = [...prev];
                          [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                          return copy;
                        })
                      }
                      className="inline-flex min-h-[40px] min-w-[44px] items-center justify-center rounded-md border border-border bg-card text-sm transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-50 disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={s.imageDownAria}
                      disabled={idx === imageRows.length - 1}
                      onClick={() =>
                        setImageRows((prev) => {
                          const copy = [...prev];
                          [copy[idx + 1], copy[idx]] = [copy[idx], copy[idx + 1]];
                          return copy;
                        })
                      }
                      className="inline-flex min-h-[40px] min-w-[44px] items-center justify-center rounded-md border border-border bg-card text-sm transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-50 disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => setImageRows((prev) => prev.filter((p) => p.key !== img.key))}
                      className="ml-auto inline-flex min-h-[40px] items-center rounded-md border border-border bg-card px-3.5 text-sm font-semibold text-danger transition duration-fast ease-smooth hover:border-danger/25 hover:bg-danger-soft"
                    >
                      {s.deleteBtn}
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setImageRows((prev) => [...prev, { key: nextKey(), url: "", altBn: "", altEn: "" }])}
            className="mt-4 inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium shadow-sm transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            {s.addImageBtn}
          </button>
        </section>
      )}

      {tab === "variants" && (
        <div className="mt-5 space-y-4">
          <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
            <SectionHeading
              glyph="layers"
              title={s.attrTitle}
              hint={s.attrHint}
            />
            <div className="space-y-2.5">
              {attrRows.map((row) => {
                // Library match is by exact key (trimmed): only then
                // does the value input get the set's value datalist.
                const matchedSet = attributeSets.find((s) => s.key === row.name.trim());
                const valuesListId = `pe-attr-values-${row.rowId}`;
                return (
                  <div key={row.rowId} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-surface-2/50 p-2.5">
                    <input
                      value={row.name}
                      onChange={(e) => updateAttrRow(row.rowId, { name: e.target.value })}
                      list={attributeSets.length > 0 ? "pe-attr-keys" : undefined}
                      placeholder={s.attrKeyPh}
                      aria-label={s.attrKeyAria}
                      className="min-h-[44px] w-44 rounded-md border border-border bg-card px-3 py-2 font-mono text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    />
                    <input
                      value={row.valuesText}
                      onChange={(e) => updateAttrRow(row.rowId, { valuesText: e.target.value })}
                      list={matchedSet ? valuesListId : undefined}
                      placeholder={s.attrValuesPh}
                      aria-label={s.attrValuesAria}
                      className="min-h-[44px] min-w-[220px] flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    />
                    {matchedSet ? (
                      <datalist id={valuesListId}>
                        {matchedSet.values.map((v) => (
                          <option key={v} value={v} />
                        ))}
                      </datalist>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setAttrRows((prev) => prev.filter((r) => r.rowId !== row.rowId))}
                      className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-3 text-sm font-semibold text-danger transition duration-fast ease-smooth hover:border-danger/25 hover:bg-danger-soft"
                    >
                      {s.deleteBtn}
                    </button>
                    {matchedSet ? (
                      <span className="w-full text-[11px] leading-relaxed text-text-subtle">
                        {interpolate(s.librarySetNote, { label: matchedSet.labelBn })}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {attributeSets.length > 0 ? (
              <datalist id="pe-attr-keys">
                {attributeSets.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.labelBn}
                  </option>
                ))}
              </datalist>
            ) : null}
            <button
              type="button"
              onClick={() =>
                setAttrRows((prev) => [...prev, { rowId: nextKey(), name: "", valuesText: "" }])
              }
              className="mt-3 inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium shadow-sm transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              {s.addAttrBtn}
            </button>
            {attributeSets.length > 0 ? (
              <p className="mt-2 text-xs leading-relaxed text-text-subtle">
                {s.attrLibraryPre}{" "}
                <Link href="/admin/attributes" className="font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                  {s.attrLibraryLink}
                </Link>{" "}
                {s.attrLibraryPost}
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2 border-t border-border/60 pt-4">
              <button
                type="button"
                onClick={handleGenerate}
                className="brand-gradient inline-flex min-h-[44px] items-center rounded-md px-4 text-sm font-semibold text-white shadow-md transition duration-fast ease-smooth hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                {s.generateBtn}
              </button>
              <button
                type="button"
                onClick={handleAddManualRow}
                className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium shadow-sm transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                {s.addVariantManual}
              </button>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-text-subtle">
              {s.generateNote}
              {mode === "edit" && s.generateNoteEditSuffix}
            </p>
          </section>
          <div className="hidden overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-xs md:block">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr className="bg-surface-2 [&>th]:border-b [&>th]:border-border [&>th]:px-3 [&>th]:py-2 [&>th]:text-caption [&>th]:font-semibold [&>th]:text-text-muted">
                  <th>{s.colSku}</th>
                  <th>{s.colAttr}</th>
                  <th>{s.colVariantPrice}</th>
                  <th>{s.colCompare}</th>
                  <th>{s.colCost}</th>
                  <th>{s.colVariantStock}</th>
                  <th>{s.colBarcode}</th>
                  <th>{s.colImageUrl}</th>
                  <th>{s.colActiveCol}</th>
                  <th aria-label={s.colActions} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-border align-top transition duration-fast ease-smooth hover:bg-brand-50/40">
                    <td className="px-3 py-2">
                      <input value={r.sku} onChange={(e) => updateRow(r.key, { sku: e.target.value })} className={`${cellInputCls} font-mono text-xs`} />
                      {r.originalSku !== null && r.sku.trim() !== r.originalSku && (
                        <span className="mt-1 block text-[11px] text-warning-solid">{s.skuChangeNote}</span>
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
                        <span className="mt-1 block text-[11px] text-text-subtle">{interpolate(s.prevStock, { n: r.originalStock })}</span>
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
                        aria-label={interpolate(s.activeAria, { sku: r.sku || s.wordNew })}
                        className="h-4 w-4 accent-brand-600"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setRows((prev) => prev.filter((p) => p.key !== r.key))}
                        className="inline-flex min-h-[36px] items-center rounded-md border border-border bg-card px-3 text-xs font-semibold text-danger transition duration-fast ease-smooth hover:border-danger/25 hover:bg-danger-soft"
                      >
                        {s.deleteBtn}
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-sm text-text-subtle">
                      {s.variantsEmpty}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile: the same variant rows as stacked cards (the wide
           *  table above is desktop-only) — identical fields/handlers. */}
          <div className="space-y-3 md:hidden">
            {rows.length === 0 && (
              <p className="rounded-2xl border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-text-subtle shadow-xs">
                {s.variantsEmpty}
              </p>
            )}
            {rows.map((r) => (
              <article key={r.key} className="rounded-2xl border border-border/60 bg-card p-3.5 shadow-xs">
                <div className="flex items-start gap-3">
                  <label className="block min-w-0 flex-1 text-xs font-medium text-text-muted">
                    {s.colSku}
                    <input value={r.sku} onChange={(e) => updateRow(r.key, { sku: e.target.value })} className={`${cellInputCls} mt-1 font-mono text-xs`} />
                  </label>
                  <label className="flex shrink-0 cursor-pointer items-center gap-2 pt-5 text-xs font-medium text-text-muted">
                    <input
                      type="checkbox"
                      checked={r.isActive}
                      onChange={(e) => updateRow(r.key, { isActive: e.target.checked })}
                      aria-label={interpolate(s.activeAria, { sku: r.sku || s.wordNew })}
                      className="h-5 w-5 accent-brand-600"
                    />
                    {s.colActiveCol}
                  </label>
                </div>
                {r.originalSku !== null && r.sku.trim() !== r.originalSku && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-warning-solid">{s.skuChangeNote}</p>
                )}
                <p className="mt-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-xs leading-relaxed text-text-muted">
                  <span className="font-semibold text-text-main">{s.colAttr}:</span>{" "}
                  {Object.entries(r.attributes).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <label className="block text-xs font-medium text-text-muted">
                    {s.colVariantPrice}
                    <input value={r.priceTaka} onChange={(e) => updateRow(r.key, { priceTaka: e.target.value })} inputMode="decimal" className={`${cellInputCls} mt-1`} />
                    <span className="mt-1 block text-[11px] text-text-subtle">{formatBdt(takaToPoisha(r.priceTaka) ?? 0)}</span>
                  </label>
                  <label className="block text-xs font-medium text-text-muted">
                    {s.colCompare}
                    <input value={r.compareAtTaka} onChange={(e) => updateRow(r.key, { compareAtTaka: e.target.value })} inputMode="decimal" className={`${cellInputCls} mt-1`} />
                  </label>
                  <label className="block text-xs font-medium text-text-muted">
                    {s.colCost}
                    <input value={r.costTaka} onChange={(e) => updateRow(r.key, { costTaka: e.target.value })} inputMode="decimal" className={`${cellInputCls} mt-1`} />
                  </label>
                  <label className="block text-xs font-medium text-text-muted">
                    {s.colVariantStock}
                    <input value={r.stock} onChange={(e) => updateRow(r.key, { stock: e.target.value })} inputMode="numeric" className={`${cellInputCls} mt-1`} />
                    {r.originalStock !== null && Number(r.stock) !== r.originalStock && (
                      <span className="mt-1 block text-[11px] text-text-subtle">{interpolate(s.prevStock, { n: r.originalStock })}</span>
                    )}
                  </label>
                  <label className="block text-xs font-medium text-text-muted">
                    {s.colBarcode}
                    <input value={r.barcode} onChange={(e) => updateRow(r.key, { barcode: e.target.value })} className={`${cellInputCls} mt-1 font-mono text-xs`} />
                  </label>
                  <label className="block text-xs font-medium text-text-muted">
                    {s.colImageUrl}
                    <input value={r.imageUrl} onChange={(e) => updateRow(r.key, { imageUrl: e.target.value })} className={`${cellInputCls} mt-1`} placeholder="https://…" />
                  </label>
                </div>
                <div className="mt-3 flex justify-end border-t border-border/60 pt-2.5">
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((p) => p.key !== r.key))}
                    className="inline-flex min-h-[40px] items-center rounded-md border border-border bg-card px-3.5 text-xs font-semibold text-danger transition duration-fast ease-smooth hover:border-danger/25 hover:bg-danger-soft"
                  >
                    {s.deleteBtn}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {tab === "content" && (
        <div className="mt-5 grid gap-4">
          <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
            <label className={labelCls}>
              {s.videoUrlLabel}
              <input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} className={inputCls} placeholder="https://…" />
            </label>
          </section>

          <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={aiBusy !== null}
                onClick={() => requestAiDraft("description")}
                className="inline-flex min-h-[40px] items-center rounded-md border border-border bg-card px-3.5 text-sm font-medium shadow-sm transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {aiBusy === "description" ? s.aiDescBusy : s.aiDescBtn}
              </button>
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-text-subtle">
                {s.aiDescNote}
              </p>
            </div>
            <AiDraftStatus error={aiError} note={aiNote} />
          </section>

          <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
            <DescriptionField
              label={s.descBnLabel}
              value={descriptionBn}
              onChange={setDescriptionBn}
              placeholder={s.descBnPh}
            />
          </section>
          <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
            <DescriptionField
              label={s.descEnLabel}
              value={descriptionEn}
              onChange={setDescriptionEn}
              placeholder={s.descEnPh}
            />
          </section>

          <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
            <SectionHeading
              glyph="file"
              title={s.sizeChartTitle}
              action={
                sizeChart.headers.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => setSizeChart({ headers: [s.sizeChartDefaultCol1, s.sizeChartDefaultCol2], rows: [["", ""]] })}
                    className="inline-flex min-h-[40px] items-center rounded-md border border-border bg-card px-3.5 text-sm font-medium shadow-sm transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-50"
                  >
                    {s.sizeChartAdd}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSizeChart({ headers: [], rows: [] })}
                    className="inline-flex min-h-[40px] items-center rounded-md border border-border bg-card px-3.5 text-sm font-semibold text-danger transition duration-fast ease-smooth hover:border-danger/25 hover:bg-danger-soft"
                  >
                    {s.sizeChartRemove}
                  </button>
                )
              }
            />
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
                                placeholder={interpolate(s.sizeChartColPh, { n: ci + 1 })}
                                aria-label={interpolate(s.sizeChartColAria, { n: ci + 1 })}
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
                                className="inline-flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center rounded-md border border-border bg-card text-xs text-danger transition duration-fast ease-smooth hover:border-danger/25 hover:bg-danger-soft disabled:opacity-40"
                                aria-label={interpolate(s.sizeChartColDeleteAria, { n: ci + 1 })}
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
                            className="inline-flex min-h-[40px] items-center whitespace-nowrap rounded-md border border-border bg-card px-3 text-xs font-semibold shadow-sm transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-50"
                          >
                            {s.addColumn}
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
                                aria-label={interpolate(s.sizeChartCellAria, { row: ri + 1, col: ci + 1 })}
                              />
                            </td>
                          ))}
                          <td className="px-1 py-1">
                            <button
                              type="button"
                              onClick={() =>
                                setSizeChart((prev) => ({ ...prev, rows: prev.rows.filter((_, i) => i !== ri) }))
                              }
                              className="inline-flex min-h-[40px] items-center whitespace-nowrap rounded-md border border-border bg-card px-3 text-xs font-semibold text-danger transition duration-fast ease-smooth hover:border-danger/25 hover:bg-danger-soft"
                            >
                              {s.rowDelete}
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
                  className="mt-3 inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium shadow-sm transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                >
                  {s.addRow}
                </button>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
            <SectionHeading glyph="check" title={s.faqTitle} />
            <div className="space-y-3">
              {faqRows.length === 0 && (
                <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-text-subtle">{s.faqEmpty}</p>
              )}
              {faqRows.map((row, ri) => (
                <div key={ri} className="grid gap-2.5 rounded-lg border border-border/60 bg-surface-2/50 p-3 md:grid-cols-[1fr_1fr_auto]">
                  <label className="block text-xs font-medium text-text-muted">
                    {s.faqQuestion}
                    <input
                      value={row.q}
                      onChange={(e) =>
                        setFaqRows((prev) => prev.map((r, i) => (i === ri ? { ...r, q: e.target.value } : r)))
                      }
                      className={`${cellInputCls} mt-1 bg-card`}
                      placeholder={s.faqQuestionPh}
                    />
                  </label>
                  <label className="block text-xs font-medium text-text-muted">
                    {s.faqAnswer}
                    <input
                      value={row.a}
                      onChange={(e) =>
                        setFaqRows((prev) => prev.map((r, i) => (i === ri ? { ...r, a: e.target.value } : r)))
                      }
                      className={`${cellInputCls} mt-1 bg-card`}
                      placeholder={s.faqAnswerPh}
                    />
                  </label>
                  <span className="flex items-end">
                    <button
                      type="button"
                      onClick={() => setFaqRows((prev) => prev.filter((_, i) => i !== ri))}
                      className="inline-flex min-h-[40px] items-center rounded-md border border-border bg-card px-3 text-xs font-semibold text-danger transition duration-fast ease-smooth hover:border-danger/25 hover:bg-danger-soft"
                    >
                      {s.deleteBtn}
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setFaqRows((prev) => [...prev, { q: "", a: "" }])}
              className="mt-3.5 inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium shadow-sm transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              {s.addFaqBtn}
            </button>
          </section>
        </div>
      )}

      {tab === "seo" && (
        <section className="mt-5 rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
          <SectionHeading
            glyph="search"
            title={s.seoHeading}
            action={
              <button
                type="button"
                disabled={aiBusy !== null}
                onClick={() => requestAiDraft("seo")}
                className="inline-flex min-h-[40px] items-center rounded-md border border-border bg-card px-3.5 text-sm font-medium shadow-sm transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {aiBusy === "seo" ? s.aiSeoBusy : s.aiSeoBtn}
              </button>
            }
          />
          <AiDraftStatus error={aiError} note={aiNote} />
          <div className="grid gap-4 md:grid-cols-2">
          <label className={labelCls}>
            {s.seoTitleBnLabel}
            <input value={seoTitleBn} onChange={(e) => setSeoTitleBn(e.target.value)} className={inputCls} placeholder={s.seoTitleBnPh} />
          </label>
          <label className={labelCls}>
            {s.seoTitleEnLabel}
            <input value={seoTitleEn} onChange={(e) => setSeoTitleEn(e.target.value)} className={inputCls} placeholder={s.seoTitleEnPh} />
          </label>
          <label className={labelCls}>
            {s.seoDescBnLabel}
            <textarea value={seoDescriptionBn} onChange={(e) => setSeoDescriptionBn(e.target.value)} rows={3} className={inputCls} />
          </label>
          <label className={labelCls}>
            {s.seoDescEnLabel}
            <textarea value={seoDescriptionEn} onChange={(e) => setSeoDescriptionEn(e.target.value)} rows={3} className={inputCls} />
          </label>
          <div className="md:col-span-2">
            <label className={labelCls}>
              {s.ogLabel}
              <input value={ogImage} onChange={(e) => setOgImage(e.target.value)} className={inputCls} placeholder="https://…" />
            </label>
            <div className="mt-2.5 flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-surface-2/50 p-3">
              {ogImage.trim() !== "" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ogImage} alt="" className="aspect-[1.91/1] w-32 shrink-0 rounded-md border border-border object-cover shadow-sm" />
              )}
              <button
                type="button"
                disabled={!imageRows.some((i) => i.url.trim() !== "")}
                onClick={() => {
                  const first = imageRows.find((i) => i.url.trim() !== "");
                  if (first) setOgImage(first.url.trim());
                }}
                className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium shadow-sm transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-40"
              >
                {s.ogUseFirst}
              </button>
              <span className="max-w-md text-xs leading-relaxed text-text-subtle">{s.ogHint}</span>
            </div>
          </div>
          <p className="text-sm text-text-muted md:col-span-2">
            {s.seoAddressLabel} <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[13px] text-brand-700">/product/{slug || "…"}</span> {s.seoAddressSuffix}
          </p>
          </div>

          {/* Presentational search-result preview — reads the same
           *  state the fields above edit, nothing new is stored. */}
          <div className="mt-5 rounded-lg border border-border/70 bg-surface-2/50 p-4">
            <p className="text-caption font-semibold uppercase tracking-wide text-text-subtle">{s.searchPreview}</p>
            <div className="mt-2.5 max-w-xl rounded-lg border border-border/60 bg-card px-4 py-3 shadow-sm">
              <p className="truncate font-mono text-xs text-text-muted">/product/{slug || "…"}</p>
              <p className="mt-1 truncate text-base font-medium text-brand-700">{seoTitleBn || titleBn || s.previewTitleFallback}</p>
              <p className="mt-0.5 line-clamp-2 text-small leading-relaxed text-text-muted">
                {seoDescriptionBn || descriptionBn || s.previewDescFallback}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Sticky action bar — save/publish stay reachable however far
       *  the form is scrolled, on phone and desktop alike. */}
      <div className="sticky bottom-3 z-20 mt-6 rounded-2xl border border-border/60 bg-card/85 p-4 shadow-lift backdrop-blur">
        {priceChanged && (
          <label className="mb-3 block text-sm">
            {s.priceReasonBarLabel} <span className="text-text-subtle">{s.priceReasonBarNote}</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className={inputCls}
              placeholder={s.reasonPhSupplier}
            />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-muted ring-1 ring-inset ring-black/5">
            {s.statusChipLabel} <span className="font-mono">{status}</span>
            {showTypeUi && (
              <>
                <span aria-hidden="true" className="text-text-subtle">•</span>
                <span className="font-mono">{productType}</span>
              </>
            )}
          </span>
          <span className="flex flex-wrap gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saveStatus === "saving"}
              className="brand-gradient inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition duration-fast ease-smooth hover:brightness-105 disabled:opacity-50"
            >
              {saveStatus === "saving" ? s.saving : mode === "create" ? s.editorCreateBtn : s.editorSaveBtn}
            </button>
            {status === "DRAFT" && (
              <button
                type="button"
                onClick={() => void handleSave("ACTIVE")}
                disabled={saveStatus === "saving"}
                className="inline-flex min-h-[44px] items-center rounded-xl bg-success-solid px-5 text-sm font-semibold text-white shadow-md transition duration-fast ease-smooth hover:brightness-105 disabled:opacity-50"
              >
                {s.publishBtn}
              </button>
            )}
          </span>
        </div>
        {saveMessage && (
          <p
            role="status"
            className={`anim-fade-in mt-3 rounded-md border px-3.5 py-2.5 text-sm font-medium ${
              saveStatus === "error"
                ? "border-danger/25 bg-danger-soft text-danger"
                : "border-success-solid/25 bg-success-soft text-success-solid"
            }`}
          >
            {saveMessage}
          </p>
        )}
        {saveErrors.length > 0 && (
          <ul className="mt-2.5 list-inside list-disc rounded-md border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {saveErrors.map((e, i) => (
              <li key={`${e}-${i}`}>{e}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-text-main">{s.qualityTitle}</h2>
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-brand-700">
            {QUALITY_CHECKLIST.filter((item) => qualityDone[item.key]).length}/{QUALITY_CHECKLIST.length}
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={QUALITY_CHECKLIST.length} aria-valuenow={QUALITY_CHECKLIST.filter((item) => qualityDone[item.key]).length}>
          <div
            className="bg-brand-600 h-full rounded-full transition-all duration-base ease-smooth"
            style={{ width: `${(QUALITY_CHECKLIST.filter((item) => qualityDone[item.key]).length / QUALITY_CHECKLIST.length) * 100}%` }}
          />
        </div>
        <ul className="mt-3.5 grid gap-2 sm:grid-cols-2">
          {QUALITY_CHECKLIST.map((item) => {
            const done = qualityDone[item.key];
            return (
              <li
                key={item.key}
                className={`flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm ${
                  done ? "border-success-solid/20 bg-success-soft/60 text-text-main" : "border-border/60 bg-surface-2/40 text-text-muted"
                }`}
              >
                {done ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5 shrink-0 text-success-solid">
                    <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" opacity="0.15" />
                    {GLYPHS.check}
                  </svg>
                ) : (
                  <span aria-hidden="true" className="h-5 w-5 shrink-0 rounded-full border-2 border-border bg-card" />
                )}
                {item.label}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

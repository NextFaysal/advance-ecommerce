"use client";

/**
 * Landing quick-order form — plan 17 batch O2.
 *
 * The classic BD landing flow: the customer fills name + phone +
 * address right on the campaign page and the order is created in one
 * submit — no cart, no checkout detour. It posts DIRECTLY to the one
 * create funnel (POST /api/v1/public/orders) with paymentMethod "cod",
 * so fraud scoring, coupon/attribution plumbing, stock checks and
 * pricing are exactly the storefront's; the server never trusts the
 * prices shown here and recomputes everything.
 *
 * The ঢাকার ভিতরে/বাইরে toggle only supplies the shippingMethod hint —
 * the server's shipping engine derives the real zone from the address.
 * One idempotency UUID per attempt: after ANY server response the key
 * is rotated, because the orders route claims a key before its checks
 * run — retrying a failed attempt with the same key would 409.
 *
 * Validation reuses the checkout module's own schema
 * (checkoutFormSchema incl. bdAddressSchema + the BD phone rule) so
 * the form can never drift from the contract the API enforces.
 *
 * Locale (doc 34 L1): every label, placeholder, total and message —
 * including the order API's failure copy — comes from the landing
 * dictionary (src/landing/strings.ts) in the visitor's locale, passed
 * down by LandingView. Before L1 this form was Bangla-only.
 */
import { useId, useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { checkoutFormSchema } from "@/checkout/validation";
import { newIdempotencyKey } from "@/checkout/idempotency";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { LANDING_STRINGS, type LandingStrings } from "../strings";
import type { ResolvedOrderProduct } from "../render";

type Zone = "inside_dhaka" | "outside_dhaka";

type Phase =
  | { kind: "editing" }
  | { kind: "submitting" }
  | { kind: "success"; orderNo: string; totalPoisha: number }
  | { kind: "error"; message: string; details: string[] };

/** Order API failure code → landing-dictionary key (per-locale copy). */
const ERROR_KEYS: Record<string, keyof LandingStrings> = {
  VALIDATION_ERROR: "errorValidation",
  INSUFFICIENT_STOCK: "errorInsufficientStock",
  VARIANT_NOT_FOUND: "errorVariantNotFound",
  IDEMPOTENCY_CONFLICT: "errorIdempotencyConflict",
};

const inputCls =
  "min-h-12 w-full rounded-lg border border-border bg-card px-3 py-2 text-base text-text-main outline-none transition placeholder:text-text-muted/70 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";
const labelCls = "mb-1 block text-sm font-semibold text-text-main";

export function QuickOrderForm({ product, locale = "bn" }: { product: ResolvedOrderProduct; locale?: Locale }) {
  const s = pick(locale, LANDING_STRINGS);
  const uid = useId();
  const [variantId, setVariantId] = useState(product.defaultVariantId);
  const [quantity, setQuantity] = useState(1);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [division, setDivision] = useState("");
  const [district, setDistrict] = useState("");
  const [upazila, setUpazila] = useState("");
  const [union, setUnion] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [zone, setZone] = useState<Zone>("outside_dhaka");
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });

  const selected = product.variants.find((v) => v.variantId === variantId) ?? product.variants[0];
  const anyInStock = product.variants.some((v) => v.inStock);
  const maxQty = Math.max(1, selected?.stock ?? 1);
  const clampedQty = Math.min(Math.max(1, quantity), maxQty);
  const subtotalPoisha = (selected?.pricePoisha ?? 0) * clampedQty;
  const productTitle = locale === "en" ? product.productTitleEn || product.productTitleBn : product.productTitleBn;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || phase.kind === "submitting") return;

    const candidate = {
      customerName: customerName.trim(),
      phone: phone.trim(),
      address: {
        division: division.trim(),
        district: district.trim(),
        upazila: upazila.trim(),
        ...(union.trim() ? { union: union.trim() } : {}),
        addressLine: addressLine.trim(),
      },
      shippingMethod: zone,
      paymentMethod: "cod" as const,
      items: [{ variantId: selected.variantId, quantity: clampedQty }],
      idempotencyKey,
    };
    const parsed = checkoutFormSchema.safeParse(candidate);
    if (!parsed.success) {
      setPhase({
        kind: "error",
        message: s.errorValidation,
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      return;
    }

    setPhase({ kind: "submitting" });
    try {
      const res = await fetch("/api/v1/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = (await res.json().catch(() => null)) as {
        data?: {
          order?: { orderNo?: string; totalPoisha?: number };
          pricing?: { grandTotalPoisha?: number } | null;
        };
        error?: { code?: string; message?: string; details?: unknown };
      } | null;
      // The key is consumed server-side either way — the next attempt
      // (if any) must be a fresh attempt with a fresh key.
      setIdempotencyKey(newIdempotencyKey());

      if (res.ok && body?.data?.order?.orderNo) {
        setPhase({
          kind: "success",
          orderNo: body.data.order.orderNo,
          totalPoisha: body.data.order.totalPoisha ?? body.data.pricing?.grandTotalPoisha ?? subtotalPoisha,
        });
        return;
      }
      const code = body?.error?.code ?? "";
      const serverMessage = body?.error?.message;
      const details = Array.isArray(body?.error?.details)
        ? (body.error.details as unknown[]).map((d) => String(d))
        : [];
      const errorKey = ERROR_KEYS[code];
      setPhase({
        kind: "error",
        // FRAUD_BLOCKED already carries the server's own generic
        // bilingual message; other codes get the dictionary copy in
        // the visitor's locale.
        message:
          code === "FRAUD_BLOCKED" && serverMessage
            ? serverMessage
            : errorKey
              ? s[errorKey]
              : (serverMessage ?? s.errorGeneric),
        details: code === "VALIDATION_ERROR" ? details : [],
      });
    } catch {
      setIdempotencyKey(newIdempotencyKey());
      setPhase({ kind: "error", message: s.errorNetwork, details: [] });
    }
  }

  if (phase.kind === "success") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center" role="status">
        <p className="text-3xl" aria-hidden="true">✅</p>
        <h3 className="mt-2 text-xl font-bold text-emerald-900">{s.successTitle}</h3>
        <p className="mt-2 leading-7 text-emerald-900">
          {s.successOrderNo}: <span className="font-bold">{phase.orderNo}</span>
          <br />
          {s.successTotalLabel}: <span className="font-bold">{formatBdt(phase.totalPoisha)}</span> {s.successTotalSuffix}
        </p>
        <p className="mt-2 text-sm leading-6 text-emerald-800">
          {s.successConfirmNote}
        </p>
        <a
          href={`/track?orderNo=${encodeURIComponent(phase.orderNo)}`}
          className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white transition hover:bg-emerald-700"
        >
          {s.trackOrderCta}
        </a>
      </div>
    );
  }

  const submitting = phase.kind === "submitting";

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-5 shadow-sm" noValidate>
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold text-text-main">{productTitle}</span>
        <a href={`/product/${product.productSlug}`} className="text-sm text-brand-600 underline">
          {s.viewDetailsShort}
        </a>
      </p>

      {product.variants.length > 1 ? (
        <fieldset className="mt-4">
          <legend className={labelCls}>{s.variantLegend}</legend>
          <div className="grid gap-2">
            {product.variants.map((v) => (
              <label
                key={v.variantId}
                className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 transition ${
                  v.variantId === selected?.variantId
                    ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600/40"
                    : "border-border hover:border-brand-400"
                } ${v.inStock ? "" : "cursor-not-allowed opacity-60"}`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${uid}-variant`}
                    value={v.variantId}
                    checked={v.variantId === selected?.variantId}
                    disabled={!v.inStock}
                    onChange={() => {
                      setVariantId(v.variantId);
                      setQuantity(1);
                    }}
                    className="h-4 w-4 accent-brand-600"
                  />
                  <span className="font-medium text-text-main">{v.variantLabel || s.standardVariant}</span>
                </span>
                <span className="text-right">
                  <span className="font-bold text-brand-600">{formatBdt(v.pricePoisha)}</span>
                  {v.compareAtPoisha && v.compareAtPoisha > v.pricePoisha ? (
                    <span className="ml-1.5 text-sm text-text-muted line-through">{formatBdt(v.compareAtPoisha)}</span>
                  ) : null}
                  <span className="block text-xs text-text-muted">{v.inStock ? interpolate(s.inStockCount, { count: v.stock }) : s.outOfStock}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : selected ? (
        <p className="mt-3 flex flex-wrap items-baseline gap-2">
          <span className="text-2xl font-bold text-brand-600">{formatBdt(selected.pricePoisha)}</span>
          {selected.compareAtPoisha && selected.compareAtPoisha > selected.pricePoisha ? (
            <span className="text-text-muted line-through">{formatBdt(selected.compareAtPoisha)}</span>
          ) : null}
          <span className="text-sm text-text-muted">{selected.inStock ? interpolate(s.inStockCount, { count: selected.stock }) : s.outOfStock}</span>
        </p>
      ) : null}

      <div className="mt-4">
        <label className={labelCls} htmlFor={`${uid}-qty`}>{s.quantityLabel}</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={s.qtyDecreaseAria}
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={!selected?.inStock}
            className="min-h-12 w-12 rounded-lg border border-border text-xl font-bold text-text-main transition hover:border-brand-400 disabled:opacity-50"
          >
            −
          </button>
          <input
            id={`${uid}-qty`}
            type="number"
            min={1}
            max={maxQty}
            value={clampedQty}
            onChange={(e) => setQuantity(Number(e.target.value) || 1)}
            disabled={!selected?.inStock}
            className={`${inputCls} text-center`}
          />
          <button
            type="button"
            aria-label={s.qtyIncreaseAria}
            onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
            disabled={!selected?.inStock}
            className="min-h-12 w-12 rounded-lg border border-border text-xl font-bold text-text-main transition hover:border-brand-400 disabled:opacity-50"
          >
            +
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <div>
          <label className={labelCls} htmlFor={`${uid}-name`}>{s.nameLabel}</label>
          <input id={`${uid}-name`} className={inputCls} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={s.namePlaceholder} autoComplete="name" />
        </div>
        <div>
          <label className={labelCls} htmlFor={`${uid}-phone`}>{s.phoneLabel}</label>
          <input id={`${uid}-phone`} className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" inputMode="tel" autoComplete="tel" />
        </div>
        <div>
          <span className={labelCls}>{s.zoneLabel}</span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={s.zoneLabel}>
            {(
              [
                { value: "inside_dhaka", label: s.zoneInsideDhaka },
                { value: "outside_dhaka", label: s.zoneOutsideDhaka },
              ] as { value: Zone; label: string }[]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={zone === opt.value}
                onClick={() => setZone(opt.value)}
                className={`min-h-12 rounded-lg border px-3 py-2 font-semibold transition ${
                  zone === opt.value
                    ? "border-brand-600 bg-brand-50 text-brand-700 ring-1 ring-brand-600/40"
                    : "border-border text-text-main hover:border-brand-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor={`${uid}-division`}>{s.divisionLabel}</label>
            <input id={`${uid}-division`} className={inputCls} value={division} onChange={(e) => setDivision(e.target.value)} placeholder={s.divisionPlaceholder} autoComplete="address-level1" />
          </div>
          <div>
            <label className={labelCls} htmlFor={`${uid}-district`}>{s.districtLabel}</label>
            <input id={`${uid}-district`} className={inputCls} value={district} onChange={(e) => setDistrict(e.target.value)} placeholder={s.districtPlaceholder} autoComplete="address-level2" />
          </div>
          <div>
            <label className={labelCls} htmlFor={`${uid}-upazila`}>{s.upazilaLabel}</label>
            <input id={`${uid}-upazila`} className={inputCls} value={upazila} onChange={(e) => setUpazila(e.target.value)} placeholder={s.upazilaPlaceholder} />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor={`${uid}-union`}>{s.unionLabel}</label>
          <input id={`${uid}-union`} className={inputCls} value={union} onChange={(e) => setUnion(e.target.value)} placeholder={s.unionPlaceholder} />
        </div>
        <div>
          <label className={labelCls} htmlFor={`${uid}-address`}>{s.addressLabel}</label>
          <textarea id={`${uid}-address`} className={`${inputCls} min-h-20`} value={addressLine} onChange={(e) => setAddressLine(e.target.value)} placeholder={s.addressPlaceholder} autoComplete="street-address" />
        </div>
      </div>

      {phase.kind === "error" ? (
        <div className="mt-4 rounded-xl bg-red-50 p-3.5 text-sm leading-6 text-red-800" role="alert">
          <p className="font-semibold">{phase.message}</p>
          {phase.details.length > 0 ? (
            <ul className="mt-1 list-inside list-disc">
              {phase.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-4">
        <span className="text-sm text-text-muted">{s.subtotalLabel}</span>
        <span className="text-xl font-bold text-text-main">{formatBdt(subtotalPoisha)}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        {s.deliveryNote}
      </p>

      <button
        type="submit"
        disabled={submitting || !selected?.inStock}
        className="brand-gradient mt-4 min-h-12 w-full rounded-xl px-4 py-3.5 text-lg font-bold text-white shadow-lift transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {!anyInStock || !selected?.inStock ? s.outOfStock : submitting ? s.submitBusy : s.submitLabel}
      </button>
    </form>
  );
}

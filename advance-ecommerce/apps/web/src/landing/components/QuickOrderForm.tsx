"use client";

/**
 * Landing quick-order form — plan 17 batch O2, v2 by doc 34 L5.
 *
 * The classic BD landing flow: the customer fills name + phone +
 * address right on the campaign page and the order is created in one
 * submit — no cart, no checkout detour. It posts DIRECTLY to the one
 * create funnel (POST /api/v1/public/orders) with paymentMethod "cod",
 * so fraud scoring, coupon/attribution plumbing, stock checks and
 * pricing are exactly the storefront's; the server never trusts the
 * prices shown here and recomputes everything.
 *
 * Validation reuses the checkout module's own schema
 * (checkoutFormSchema incl. bdAddressSchema + the BD phone rule) so
 * the form can never drift from the contract the API enforces.
 * One idempotency UUID per attempt: after ANY server response the key
 * is rotated, because the orders route claims a key before its checks
 * run — retrying a failed attempt with the same key would 409.
 *
 * Locale (doc 34 L1): every label, placeholder, total and message —
 * including the order API's failure copy — comes from the landing
 * dictionary (src/landing/strings.ts) in the visitor's locale, passed
 * down by LandingView. Before L1 this form was Bangla-only.
 *
 * ── Doc 34 L5 upgrades ─────────────────────────────────────────────
 * GEO CASCADE: division/district/upazila are no longer free text.
 * The form fetches the SAME tree the storefront checkout uses
 * (GET /api/v1/public/geo → src/checkout/geo-tree lookups) and
 * renders the same three-select cascade, so submitted values are
 * canonical geo-dataset nameEn strings by construction. If the geo
 * fetch fails, the form falls back to free-text inputs — the exact
 * degradation the checkout itself implements. The old ঢাকার
 * ভিতরে/বাইরে toggle is GONE: the shipping engine derives the zone
 * from the district (shipping-core zone rule), so the submitted
 * shippingMethod is now zoneForDistrict(district), exactly what the
 * checkout submits; a customer pick can no longer contradict the
 * address (the pre-O2 bug the engine replaced).
 *
 * DELIVERY PREVIEW: the totals block runs the shipping engine's own
 * pure calculator — calculateShipping(DEFAULT_SHIPPING_RATES, …)
 * from src/checkout/shipping-core — with the same inputs the
 * checkout page previews with (district-derived zone, weight 0: the
 * form carries no weight data, same as the cart). That is the very
 * function the orders route runs at create time via
 * computeOrderShipping() (src/checkout/shipping.ts) over the same
 * inputs, except that the server swaps DEFAULT_SHIPPING_RATES for
 * the merchant's live Settings rates — whose fallbacks ARE those
 * defaults — and passes the order's true total weight where this
 * preview (like the checkout page's) has none. So at default rates
 * with no weight slabs in play the preview equals the charged
 * delivery charge taka-for-taka; where a merchant has overridden
 * rates or configured weight slabs the block is labelled an
 * estimate (আনুমানিক) and the create-time totals stay
 * authoritative, exactly as the checkout's own summary labels its
 * preview. No new quote endpoint and no client-side price math of
 * our own: this IS the checkout's preview mechanism, reused. The
 * preview appears once a district is picked (the moment the zone
 * resolves).
 *
 * FIELD CONFIG (docs 28/29, plan §3.6 — one merchant config, both
 * forms): the form reads GET /api/v1/public/checkout-config through
 * the same coercion the checkout page uses, starting from
 * DEFAULT_CHECKOUT_FIELDS_CONFIG (= the original hardcoded checkout,
 * so a pending/failed fetch renders labels and rules equivalent to
 * the pre-L5 form). Where the config overlaps this form it governs:
 * labels + placeholders (locale-picked from the def), visibility,
 * doc-29 conditions (visibleWhen/requiredWhen) and answer
 * validation for email / union / note and the merchant's extra
 * fields; extras render at the end of the address group and their
 * answers ride the create body as `fieldAnswers`, collected only
 * when effectively visible — the checkout's own submit rule, and
 * the same rules the orders route re-enforces server-side on this
 * very route (a config-required field can no longer fail a landing
 * order by being absent from this form). customerName / phone /
 * the cascade / addressLine are locked visible+required by the
 * config's own coercion, so they always render. Free text remains
 * only where the checkout keeps it: union + the address line.
 */
import { Fragment, useEffect, useId, useMemo, useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { checkoutFormSchema } from "@/checkout/validation";
import { newIdempotencyKey } from "@/checkout/idempotency";
import {
  calculateShipping,
  DEFAULT_SHIPPING_RATES,
  zoneForDistrict,
  type ShippingZone,
} from "@/checkout/shipping-core";
import {
  districtsOf,
  upazilasOf,
  type GeoTree,
} from "@/checkout/geo-tree";
import {
  coerceCheckoutFieldsConfig,
  DEFAULT_CHECKOUT_FIELDS_CONFIG,
  effectiveRequired,
  effectiveVisible,
  fieldByKey,
  validateAnswer,
  visibleFieldsForGroup,
  type CheckoutConditionContext,
  type CheckoutFieldDef,
  type CheckoutFieldsConfig,
} from "@/checkout/fields";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { LANDING_STRINGS, type LandingStrings } from "../strings";
import type { ResolvedOrderProduct } from "../render";

type Phase =
  | { kind: "editing" }
  | { kind: "submitting" }
  | { kind: "success"; orderNo: string; totalPoisha: number }
  | { kind: "error"; message: string; details: string[] };

/** Order API failure code → landing-dictionary key (per-locale copy).
 *  The doc-29 CHECKOUT_FIELD_* codes are deliberately NOT mapped:
 *  their server messages are already bilingual and name the field,
 *  so they pass through like FRAUD_BLOCKED's message does. */
const ERROR_KEYS: Record<string, keyof LandingStrings> = {
  VALIDATION_ERROR: "errorValidation",
  INSUFFICIENT_STOCK: "errorInsufficientStock",
  VARIANT_NOT_FOUND: "errorVariantNotFound",
  IDEMPOTENCY_CONFLICT: "errorIdempotencyConflict",
};

const inputCls =
  "min-h-12 w-full rounded-lg border border-border bg-card px-3 py-2 text-base text-text-main outline-none transition placeholder:text-text-muted/70 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";
const labelCls = "mb-1 block text-sm font-semibold text-text-main";

/** Native validation attributes from a def's doc-29 rules — the
 *  checkout's own helper (lengths on free-text inputs; the HTML
 *  pattern only for the digits preset). */
function validationAttrs(def: CheckoutFieldDef) {
  return {
    minLength: def.validation?.minLength,
    maxLength: def.validation?.maxLength,
    ...(def.validation?.pattern === "digits" ? { pattern: "[0-9]+" } : {}),
  };
}

export function QuickOrderForm({ product, locale = "bn" }: { product: ResolvedOrderProduct; locale?: Locale }) {
  const s = pick(locale, LANDING_STRINGS);
  const isBn = locale === "bn";
  const uid = useId();
  const [variantId, setVariantId] = useState(product.defaultVariantId);
  const [quantity, setQuantity] = useState(1);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [division, setDivision] = useState("");
  const [district, setDistrict] = useState("");
  const [upazila, setUpazila] = useState("");
  const [union, setUnion] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [note, setNote] = useState("");
  const [extraAnswers, setExtraAnswers] = useState<Record<string, string>>({});
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });

  // Geo cascade tree — the checkout's fetch, verbatim pattern.
  const [geoTree, setGeoTree] = useState<GeoTree | null>(null);
  const [geoFailed, setGeoFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/public/geo")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("geo fetch failed"))))
      .then((json: { data?: GeoTree }) => {
        if (cancelled) return;
        if (Array.isArray(json.data)) setGeoTree(json.data);
        else setGeoFailed(true);
      })
      .catch(() => {
        if (!cancelled) setGeoFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Checkout field config (docs 28/29) — the checkout page's fetch +
  // coercion, verbatim pattern; defaults render the pre-L5 form.
  const [fieldsConfig, setFieldsConfig] = useState<CheckoutFieldsConfig>(
    DEFAULT_CHECKOUT_FIELDS_CONFIG,
  );
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/public/checkout-config")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("checkout config fetch failed"))))
      .then((json: { data?: unknown }) => {
        if (cancelled) return;
        if (json.data) setFieldsConfig(coerceCheckoutFieldsConfig(json.data));
      })
      .catch(() => {
        // The default config stays — the form is the pre-L5 one.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = product.variants.find((v) => v.variantId === variantId) ?? product.variants[0];
  const anyInStock = product.variants.some((v) => v.inStock);
  const maxQty = Math.max(1, selected?.stock ?? 1);
  const clampedQty = Math.min(Math.max(1, quantity), maxQty);
  const subtotalPoisha = (selected?.pricePoisha ?? 0) * clampedQty;
  const productTitle = locale === "en" ? product.productTitleEn || product.productTitleBn : product.productTitleBn;

  // The zone the submit sends — derived from the district alone,
  // exactly like the checkout (before any district is picked the
  // Dhaka assumption applies; it only feeds condition contexts and
  // the preview until then, and district is required at submit).
  const submittedZone: ShippingZone = zoneForDistrict(district || "Dhaka");

  // Doc-29 condition context — the checkout's composition, with the
  // merchandise subtotal this form displays (the server recomputes
  // from DB prices whenever a cart-total condition exists).
  const conditionCtx: CheckoutConditionContext = useMemo(
    () => ({
      paymentMethod: "cod",
      shippingMethod: submittedZone,
      division: division || undefined,
      cartTotalPoisha: subtotalPoisha,
    }),
    [submittedZone, division, subtotalPoisha],
  );

  const infoFieldDefs = visibleFieldsForGroup(fieldsConfig, "info").filter((def) =>
    effectiveVisible(def, conditionCtx),
  );
  const addressFieldDefs = visibleFieldsForGroup(fieldsConfig, "address").filter((def) =>
    effectiveVisible(def, conditionCtx),
  );

  /** Dictionary fallback label per built-in key (pre-L5 copy, used
   *  only if a config def somehow carries no label at all). */
  const FALLBACK_LABEL: Partial<Record<string, string>> = {
    customerName: s.nameLabel,
    phone: s.phoneLabel,
    email: s.emailLabel,
    division: s.divisionLabel,
    district: s.districtLabel,
    upazila: s.upazilaLabel,
    union: s.unionLabel,
    addressLine: s.addressLabel,
  };
  /** Display label — the checkout's rule: the merchant-configured
   *  label in the visitor's locale (falling back to the other
   *  locale, then to the landing dictionary), plus the " *" marker
   *  for effectively-required fields that don't carry one. */
  const fieldLabel = (def?: CheckoutFieldDef): string => {
    if (!def) return "";
    const label =
      (isBn ? def.labelBn || def.labelEn : def.labelEn || def.labelBn) ||
      FALLBACK_LABEL[def.key] ||
      "";
    const bare = label.replace(/\s*\*\s*$/, "");
    return effectiveRequired(def, conditionCtx) && !label.includes("*") ? `${bare} *` : label;
  };
  const placeholderFor = (def: CheckoutFieldDef, fallback: string): string =>
    def.placeholder || fallback;

  // Delivery preview — the checkout page's own mechanism (see the
  // header): the shipping engine's pure calculator at the built-in
  // default rates, district-derived zone, no weight data. Shown
  // once a district resolves the zone.
  const shippingPreview = useMemo(
    () =>
      district.trim()
        ? calculateShipping(DEFAULT_SHIPPING_RATES, {
            district,
            shippingMethod: submittedZone,
            totalWeightGrams: 0,
            subtotalPoisha,
          })
        : null,
    [district, submittedZone, subtotalPoisha],
  );

  function onDivisionChange(value: string) {
    setDivision(value);
    setDistrict("");
    setUpazila("");
  }
  function onDistrictChange(value: string) {
    setDistrict(value);
    setUpazila("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || phase.kind === "submitting") return;

    // Submit-time condition context, read from the submitted values
    // themselves — the same sources the server gate evaluates (the
    // checkout's submitConditionCtx pattern).
    const submitCtx: CheckoutConditionContext = {
      paymentMethod: "cod",
      shippingMethod: submittedZone,
      division: division || undefined,
      cartTotalPoisha: subtotalPoisha,
    };
    const visAtSubmit = (def: CheckoutFieldDef) => effectiveVisible(def, submitCtx);
    const emailDef = fieldByKey(fieldsConfig, "email");
    const unionDef = fieldByKey(fieldsConfig, "union");
    const noteDef = fieldByKey(fieldsConfig, "note");
    const addressLineDef = fieldByKey(fieldsConfig, "addressLine");
    // A field that is not effectively visible at submit is treated
    // as absent — the server gate's rule, applied client-side too,
    // so a value typed before a condition flipped can never ride.
    const emailValue = emailDef && visAtSubmit(emailDef) ? email.trim() : "";
    const unionValue = unionDef && visAtSubmit(unionDef) ? union.trim() : "";
    const noteValue = noteDef && visAtSubmit(noteDef) ? note.trim() : "";

    // Client mirror of the orders route's field gate (docs 28/29):
    // effectively-required toggleable fields + extras must be
    // non-empty; present answers must satisfy the defs' validation
    // rules. The server re-enforces all of it regardless — this only
    // keeps the failure inside the form's own error panel.
    const fieldProblems: string[] = [];
    const checkField = (def: CheckoutFieldDef | undefined, value: string) => {
      if (!def || !visAtSubmit(def)) return;
      if (effectiveRequired(def, submitCtx) && value === "") {
        fieldProblems.push(`${fieldLabel(def)}: ${s.errorFieldInvalid}`);
        return;
      }
      if (value !== "" && validateAnswer(def, value)) {
        fieldProblems.push(`${fieldLabel(def)}: ${s.errorFieldInvalid}`);
      }
    };
    checkField(emailDef, emailValue);
    checkField(unionDef, unionValue);
    checkField(noteDef, noteValue);
    if (addressLineDef && validateAnswer(addressLineDef, addressLine.trim())) {
      fieldProblems.push(`${fieldLabel(addressLineDef)}: ${s.errorFieldInvalid}`);
    }
    // Extra fields: answers ride as fieldAnswers, collected ONLY
    // when effectively visible — the checkout's submit rule verbatim.
    const fieldAnswers: Record<string, string> = {};
    for (const def of visibleFieldsForGroup(fieldsConfig, "address")) {
      if (!def.extra || !visAtSubmit(def)) continue;
      const value = (extraAnswers[def.key] ?? "").trim();
      checkField(def, value);
      if (value) fieldAnswers[def.key] = value;
    }
    if (fieldProblems.length > 0) {
      setPhase({ kind: "error", message: s.errorValidation, details: fieldProblems });
      return;
    }

    const candidate = {
      customerName: customerName.trim(),
      phone: phone.trim(),
      email: emailValue,
      address: {
        division: division.trim(),
        district: district.trim(),
        upazila: upazila.trim(),
        ...(unionValue ? { union: unionValue } : {}),
        addressLine: addressLine.trim(),
      },
      ...(noteValue ? { note: noteValue } : {}),
      shippingMethod: submittedZone,
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
        // fieldAnswers rides alongside the schema body — the
        // checkout page's exact construction (the form schema does
        // not carry it; the orders route's own schema accepts it).
        body: JSON.stringify(
          Object.keys(fieldAnswers).length > 0
            ? { ...parsed.data, fieldAnswers }
            : parsed.data,
        ),
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
        // FRAUD_BLOCKED (and the doc-29 CHECKOUT_FIELD_* refusals)
        // already carry the server's own generic bilingual message;
        // other codes get the dictionary copy in the visitor's locale.
        message:
          (code === "FRAUD_BLOCKED" || code.startsWith("CHECKOUT_FIELD_")) && serverMessage
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

  /** The address cascade as ONE block (the checkout's structure):
   *  three selects from the fetched geo tree, free-text inputs when
   *  the fetch failed, a disabled loading placeholder until then.
   *  Labels + required come from the field defs. */
  function renderCascade() {
    const divisionDef = fieldByKey(fieldsConfig, "division");
    const districtDef = fieldByKey(fieldsConfig, "district");
    const upazilaDef = fieldByKey(fieldsConfig, "upazila");
    const divisionLabel = fieldLabel(divisionDef) || s.divisionLabel;
    const districtLabel = fieldLabel(districtDef) || s.districtLabel;
    const upazilaLabel = fieldLabel(upazilaDef) || s.upazilaLabel;
    if (geoTree) {
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor={`${uid}-division`}>{divisionLabel}</label>
            <select
              id={`${uid}-division`}
              className={inputCls}
              value={division}
              required={divisionDef?.required ?? true}
              onChange={(e) => onDivisionChange(e.target.value)}
            >
              <option value="">{s.chooseDivision}</option>
              {geoTree.map((d) => (
                <option key={d.nameEn} value={d.nameEn}>
                  {isBn ? d.nameBn : d.nameEn}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor={`${uid}-district`}>{districtLabel}</label>
            <select
              id={`${uid}-district`}
              className={inputCls}
              value={district}
              required={districtDef?.required ?? true}
              disabled={!division}
              onChange={(e) => onDistrictChange(e.target.value)}
            >
              <option value="">{s.chooseDistrict}</option>
              {districtsOf(geoTree, division).map((d) => (
                <option key={d.nameEn} value={d.nameEn}>
                  {isBn ? d.nameBn : d.nameEn}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor={`${uid}-upazila`}>{upazilaLabel}</label>
            <select
              id={`${uid}-upazila`}
              className={inputCls}
              value={upazila}
              required={upazilaDef?.required ?? true}
              disabled={!district}
              onChange={(e) => setUpazila(e.target.value)}
            >
              <option value="">{s.chooseUpazila}</option>
              {upazilasOf(geoTree, division, district).map((u) => (
                <option key={u.nameEn} value={u.nameEn}>
                  {isBn ? u.nameBn : u.nameEn}
                </option>
              ))}
            </select>
          </div>
        </div>
      );
    }
    if (geoFailed) {
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor={`${uid}-division`}>{divisionLabel}</label>
            <input id={`${uid}-division`} className={inputCls} value={division} onChange={(e) => setDivision(e.target.value)} placeholder={s.divisionPlaceholder} autoComplete="address-level1" />
          </div>
          <div>
            <label className={labelCls} htmlFor={`${uid}-district`}>{districtLabel}</label>
            <input id={`${uid}-district`} className={inputCls} value={district} onChange={(e) => setDistrict(e.target.value)} placeholder={s.districtPlaceholder} autoComplete="address-level2" />
          </div>
          <div>
            <label className={labelCls} htmlFor={`${uid}-upazila`}>{upazilaLabel}</label>
            <input id={`${uid}-upazila`} className={inputCls} value={upazila} onChange={(e) => setUpazila(e.target.value)} placeholder={s.upazilaPlaceholder} />
          </div>
        </div>
      );
    }
    return (
      <div>
        <span className={labelCls}>
          {divisionLabel} / {districtLabel} / {upazilaLabel}
        </span>
        <select disabled className={inputCls}>
          <option>{s.geoLoading}</option>
        </select>
      </div>
    );
  }

  function renderInfoField(def: CheckoutFieldDef) {
    if (def.key === "customerName") {
      return (
        <div key={def.key}>
          <label className={labelCls} htmlFor={`${uid}-name`}>{fieldLabel(def)}</label>
          <input id={`${uid}-name`} className={inputCls} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={placeholderFor(def, s.namePlaceholder)} autoComplete="name" />
        </div>
      );
    }
    if (def.key === "phone") {
      return (
        <div key={def.key}>
          <label className={labelCls} htmlFor={`${uid}-phone`}>{fieldLabel(def)}</label>
          <input id={`${uid}-phone`} className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={placeholderFor(def, "01XXXXXXXXX")} inputMode="tel" autoComplete="tel" />
        </div>
      );
    }
    if (def.key === "email") {
      return (
        <div key={def.key}>
          <label className={labelCls} htmlFor={`${uid}-email`}>{fieldLabel(def)}</label>
          <input id={`${uid}-email`} type="email" inputMode="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={placeholderFor(def, s.emailPlaceholder)} autoComplete="email" {...validationAttrs(def)} />
        </div>
      );
    }
    return null;
  }

  function renderAddressField(def: CheckoutFieldDef) {
    if (def.key === "union") {
      return (
        <div key={def.key}>
          <label className={labelCls} htmlFor={`${uid}-union`}>{fieldLabel(def)}</label>
          <input id={`${uid}-union`} className={inputCls} value={union} onChange={(e) => setUnion(e.target.value)} placeholder={placeholderFor(def, s.unionPlaceholder)} {...validationAttrs(def)} />
        </div>
      );
    }
    if (def.key === "addressLine") {
      return (
        <div key={def.key}>
          <label className={labelCls} htmlFor={`${uid}-address`}>{fieldLabel(def)}</label>
          <textarea id={`${uid}-address`} className={`${inputCls} min-h-20`} value={addressLine} onChange={(e) => setAddressLine(e.target.value)} placeholder={placeholderFor(def, s.addressPlaceholder)} autoComplete="street-address" {...validationAttrs(def)} />
        </div>
      );
    }
    if (def.key === "note") {
      return (
        <div key={def.key}>
          <label className={labelCls} htmlFor={`${uid}-note`}>{fieldLabel(def)}</label>
          <input id={`${uid}-note`} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={def.placeholder || undefined} {...validationAttrs(def)} />
        </div>
      );
    }
    if (def.extra) {
      return (
        <div key={def.key}>
          <label className={labelCls} htmlFor={`${uid}-${def.key}`}>{fieldLabel(def)}</label>
          <input
            id={`${uid}-${def.key}`}
            className={inputCls}
            value={extraAnswers[def.key] ?? ""}
            onChange={(e) => setExtraAnswers((prev) => ({ ...prev, [def.key]: e.target.value }))}
            placeholder={def.placeholder || undefined}
            {...validationAttrs(def)}
          />
        </div>
      );
    }
    return null;
  }

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
        {infoFieldDefs.map((def) => renderInfoField(def))}
      </div>

      <div className="mt-3 grid gap-3">
        {(() => {
          // The cascade renders once, as a unit, at the position of
          // its first key in the address group's config order — the
          // checkout's renderAddressFields pattern.
          let cascadeRendered = false;
          return addressFieldDefs.map((def) => {
            if (def.key === "division" || def.key === "district" || def.key === "upazila") {
              if (cascadeRendered) return null;
              cascadeRendered = true;
              return <Fragment key="address-cascade">{renderCascade()}</Fragment>;
            }
            return renderAddressField(def);
          });
        })()}
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

      <div className="mt-4 border-t border-border pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm text-text-muted">{s.subtotalLabel}</span>
          <span className="font-semibold text-text-main">{formatBdt(subtotalPoisha)}</span>
        </div>
        {shippingPreview ? (
          <>
            <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm text-text-muted">{s.deliveryChargeLabel}</span>
              <span className="font-semibold text-text-main">
                {shippingPreview.freeShippingApplied ? s.deliveryFree : formatBdt(shippingPreview.shippingPoisha)}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-text-main">{s.grandTotalLabel}</span>
              <span className="text-xl font-bold text-text-main">
                {formatBdt(subtotalPoisha + shippingPreview.shippingPoisha)}
              </span>
            </div>
          </>
        ) : null}
      </div>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        {shippingPreview ? `${s.estimateNote} ` : ""}{s.deliveryNote}
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

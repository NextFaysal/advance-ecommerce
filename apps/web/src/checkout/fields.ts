/**
 * Checkout field configuration — PURE module (doc 28).
 *
 * The merchant can edit the storefront checkout's fields from
 * Admin → Settings → Checkout Fields: labels (Bn/En), placeholders,
 * visibility, required flags and order (within each step group),
 * plus up to 5 custom text fields. The saved document lives in the
 * Setting doc `checkout.fields`; this module owns the shape, the
 * DEFAULT config (which mirrors the original hardcoded form
 * exactly) and the coercion every reader/writer must pass through.
 *
 * Honesty rails (enforced here, not just in the UI):
 * - customerName / phone: visible + required are LOCKED on — they
 *   are the order's identity (phone is the OTP/identity key).
 * - division / district / upazila: LOCKED on — shipping and courier
 *   pricing keys off the address cascade.
 * - addressLine: required LOCKED on.
 * - email / union / note: fully editable.
 * - Extra fields: keys extra_1..extra_5 only, text only.
 *
 * Client-safe: no imports beyond types. The checkout page imports
 * the defaults + helpers from here; the server reader lives in
 * fields-server.ts.
 */

export type CheckoutFieldKey =
  | "customerName"
  | "phone"
  | "email"
  | "division"
  | "district"
  | "upazila"
  | "union"
  | "addressLine"
  | "note";

/**
 * A display/requirement condition (doc 29). Matched against the live
 * checkout context; `values` conditions match when the context value
 * (trimmed, case-insensitive) is one of the listed values, `cartTotal`
 * matches when the merchandise subtotal reaches `minPoisha`.
 */
export type CheckoutFieldCondition =
  | { source: "paymentMethod" | "shippingMethod" | "division"; values: string[] }
  | { source: "cartTotal"; minPoisha: number };

/** The live checkout state conditions are matched against. */
export interface CheckoutConditionContext {
  paymentMethod?: string;
  shippingMethod?: string;
  division?: string;
  /** Merchandise subtotal in poisha (before shipping/coupons/gift cards). */
  cartTotalPoisha?: number;
}

/** Answer format presets (doc 29) — deliberately no raw regex from admin. */
export type CheckoutAnswerPattern = "digits" | "bd_phone" | "email";

export const CHECKOUT_ANSWER_PATTERNS: CheckoutAnswerPattern[] = ["digits", "bd_phone", "email"];

/** Admin-settable answer validation (doc 29), checked when a value is present. */
export interface CheckoutFieldValidation {
  minLength?: number;
  maxLength?: number;
  pattern?: CheckoutAnswerPattern;
}

export type CheckoutFieldDef = {
  /** Built-in key, or extra_1..extra_5 for merchant-added fields. */
  key: string;
  labelBn: string;
  labelEn: string;
  placeholder?: string;
  visible: boolean;
  required: boolean;
  /** Merchant-added custom text field (answers land on the order note). */
  extra?: boolean;
  /** Doc 29: render/enforce this field only when the condition matches. */
  visibleWhen?: CheckoutFieldCondition;
  /** Doc 29: this field is required when the condition matches (OR-ed with `required`). */
  requiredWhen?: CheckoutFieldCondition;
  /** Doc 29: answer validation, applied when a value is present. */
  validation?: CheckoutFieldValidation;
};

export type CheckoutFieldsConfig = {
  version: 1;
  fields: CheckoutFieldDef[];
};

/** Step groups: field keys in render order belong to one of these. */
export const CHECKOUT_FIELD_GROUPS: Record<"info" | "address", string[]> = {
  info: ["customerName", "phone", "email"],
  address: ["division", "district", "upazila", "union", "addressLine", "note"],
};

const GROUP_OF: Record<string, "info" | "address"> = {
  customerName: "info",
  phone: "info",
  email: "info",
  division: "address",
  district: "address",
  upazila: "address",
  union: "address",
  addressLine: "address",
  note: "address",
};

/** Keys whose visibility can never be turned off. */
export const LOCKED_VISIBLE: ReadonlySet<string> = new Set([
  "customerName",
  "phone",
  "division",
  "district",
  "upazila",
  "addressLine",
]);

/** Keys that can never be made optional. */
export const LOCKED_REQUIRED: ReadonlySet<string> = new Set([
  "customerName",
  "phone",
  "division",
  "district",
  "upazila",
  "addressLine",
]);

export const MAX_EXTRA_FIELDS = 5;
export const MAX_LABEL_LENGTH = 80;
export const MAX_PLACEHOLDER_LENGTH = 120;
export const MAX_ANSWER_LENGTH = 200;

/** Doc 29 bounds. */
export const MAX_CONDITION_VALUES = 10;
export const MAX_CONDITION_VALUE_LENGTH = 60;
export const MAX_CART_TOTAL_POISHA = 1_000_000_000;
export const MAX_VALIDATION_LENGTH = 200;

/** Keys that may carry conditions (doc 29): the fully editable fields + extras. */
const CONDITION_KEYS: ReadonlySet<string> = new Set(["email", "union", "note"]);

/** Keys that may carry answer validation (doc 29). */
const VALIDATION_KEYS: ReadonlySet<string> = new Set(["email", "union", "addressLine", "note"]);

function coerceCondition(raw: unknown): CheckoutFieldCondition | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.source === "cartTotal") {
    const min = typeof raw.minPoisha === "number" ? Math.floor(raw.minPoisha) : NaN;
    if (!Number.isFinite(min) || min < 0 || min > MAX_CART_TOTAL_POISHA) return undefined;
    return { source: "cartTotal", minPoisha: min };
  }
  if (raw.source === "paymentMethod" || raw.source === "shippingMethod" || raw.source === "division") {
    if (!Array.isArray(raw.values)) return undefined;
    const values: string[] = [];
    for (const v of raw.values) {
      const s = cleanText(v, MAX_CONDITION_VALUE_LENGTH);
      if (s && !values.some((x) => x.toLowerCase() === s.toLowerCase())) values.push(s);
      if (values.length >= MAX_CONDITION_VALUES) break;
    }
    if (values.length === 0) return undefined;
    return { source: raw.source, values };
  }
  return undefined;
}

function coerceValidation(raw: unknown): CheckoutFieldValidation | undefined {
  if (!isRecord(raw)) return undefined;
  const out: CheckoutFieldValidation = {};
  const len = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.min(MAX_VALIDATION_LENGTH, Math.max(1, Math.floor(v)))
      : undefined;
  const minLength = len(raw.minLength);
  const maxLength = len(raw.maxLength);
  if (minLength !== undefined) out.minLength = minLength;
  if (maxLength !== undefined && (minLength === undefined || maxLength >= minLength)) out.maxLength = maxLength;
  if (raw.pattern === "digits" || raw.pattern === "bd_phone" || raw.pattern === "email") out.pattern = raw.pattern;
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Default form = SIMPLE checkout (Nazmul, 2026-10-30): the customer
 * is asked only for what delivery needs — name, phone, the address
 * cascade and the detailed address. Email / union / note ship HIDDEN;
 * the merchant can switch any of them on (or back off) from
 * Admin → Settings → Checkout Fields, where a one-click preset
 * mirrors these two shapes. This default applies wherever no
 * `checkout.fields` Setting has been saved; a saved config wins.
 */
const BUILTIN_DEFAULTS: CheckoutFieldDef[] = [
  { key: "customerName", labelBn: "আপনার নাম", labelEn: "Your name", visible: true, required: true },
  { key: "phone", labelBn: "মোবাইল নম্বর", labelEn: "Mobile number", placeholder: "01XXXXXXXXX", visible: true, required: true },
  { key: "email", labelBn: "ইমেইল (ঐচ্ছিক)", labelEn: "Email (optional)", visible: false, required: false },
  { key: "division", labelBn: "বিভাগ", labelEn: "Division", visible: true, required: true },
  { key: "district", labelBn: "জেলা", labelEn: "District", visible: true, required: true },
  { key: "upazila", labelBn: "উপজেলা", labelEn: "Upazila", visible: true, required: true },
  { key: "union", labelBn: "ইউনিয়ন (ঐচ্ছিক)", labelEn: "Union (optional)", visible: false, required: false },
  { key: "addressLine", labelBn: "বিস্তারিত ঠিকানা", labelEn: "Detailed address", visible: true, required: true },
  { key: "note", labelBn: "নোট (ঐচ্ছিক)", labelEn: "Note (optional)", visible: false, required: false },
];

/** The default config = the original hardcoded checkout form, exactly. */
export const DEFAULT_CHECKOUT_FIELDS_CONFIG: CheckoutFieldsConfig = {
  version: 1,
  fields: BUILTIN_DEFAULTS.map((f) => ({ ...f })),
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function coerceField(raw: unknown, fallback: CheckoutFieldDef): CheckoutFieldDef | null {
  if (!isRecord(raw)) return null;
  const key = typeof raw.key === "string" ? raw.key : "";
  if (key !== fallback.key) return null;
  const labelBn = cleanText(raw.labelBn, MAX_LABEL_LENGTH) || fallback.labelBn;
  const labelEn = cleanText(raw.labelEn, MAX_LABEL_LENGTH) || fallback.labelEn;
  const placeholder = cleanText(raw.placeholder, MAX_PLACEHOLDER_LENGTH);
  let visible = typeof raw.visible === "boolean" ? raw.visible : fallback.visible;
  let required = typeof raw.required === "boolean" ? raw.required : fallback.required;
  if (LOCKED_VISIBLE.has(key)) visible = true;
  if (LOCKED_REQUIRED.has(key)) required = true;
  // Doc 29: conditions live only on the fully editable fields + extras;
  // validation only on the free-text fields + extras. Everywhere else
  // they are stripped here, so no reader can ever honour them there.
  const mayCondition = fallback.extra === true || CONDITION_KEYS.has(key);
  const mayValidate = fallback.extra === true || VALIDATION_KEYS.has(key);
  const visibleWhen = mayCondition ? coerceCondition(raw.visibleWhen) : undefined;
  const requiredWhen = mayCondition ? coerceCondition(raw.requiredWhen) : undefined;
  const validation = mayValidate ? coerceValidation(raw.validation) : undefined;
  return {
    key,
    labelBn,
    labelEn,
    ...(placeholder ? { placeholder } : fallback.placeholder ? { placeholder: fallback.placeholder } : {}),
    visible,
    required,
    ...(fallback.extra ? { extra: true } : {}),
    ...(visibleWhen ? { visibleWhen } : {}),
    ...(requiredWhen ? { requiredWhen } : {}),
    ...(validation ? { validation } : {}),
  };
}

/**
 * Coerce ANY stored value into a valid config. Built-ins are always
 * present (missing/invalid entries fall back to their defaults, in
 * the merchant's saved order when given); extra fields survive only
 * with valid extra_N keys and non-empty labels. Never throws.
 */
export function coerceCheckoutFieldsConfig(raw: unknown): CheckoutFieldsConfig {
  const rawFields: unknown[] = isRecord(raw) && Array.isArray(raw.fields) ? raw.fields : [];
  const out: CheckoutFieldDef[] = [];
  // Built-ins first, in the merchant's saved relative order per group:
  // walk the raw array to honour ordering, then append any missing.
  const seen = new Set<string>();
  for (const f of rawFields) {
    if (!isRecord(f) || typeof f.key !== "string") continue;
    const fb = BUILTIN_DEFAULTS.find((d) => d.key === f.key);
    if (!fb || seen.has(fb.key)) continue;
    const coerced = coerceField(f, fb);
    if (coerced) {
      out.push(coerced);
      seen.add(fb.key);
    }
  }
  for (const fb of BUILTIN_DEFAULTS) {
    if (!seen.has(fb.key)) out.push({ ...fb });
  }
  // Extras (in raw order, max MAX_EXTRA_FIELDS, keys normalised).
  let extraCount = 0;
  for (const f of rawFields) {
    if (!isRecord(f) || typeof f.key !== "string") continue;
    if (!/^extra_[1-5]$/.test(f.key) || seen.has(f.key)) continue;
    if (extraCount >= MAX_EXTRA_FIELDS) break;
    const fb: CheckoutFieldDef = {
      key: f.key,
      labelBn: "",
      labelEn: "",
      visible: true,
      required: false,
      extra: true,
    };
    const coerced = coerceField(f, fb);
    if (coerced && (coerced.labelBn || coerced.labelEn)) {
      out.push(coerced);
      seen.add(f.key);
      extraCount += 1;
    }
  }
  return { version: 1, fields: out };
}

/** Visible fields of one step group, in config order. Extra fields render at the end of the address group. */
export function visibleFieldsForGroup(
  config: CheckoutFieldsConfig,
  group: "info" | "address",
): CheckoutFieldDef[] {
  return config.fields.filter((f) => {
    if (!f.visible) return false;
    if (f.extra) return group === "address";
    return GROUP_OF[f.key] === group;
  });
}

/** The field def for a key (built-in or extra), or undefined. */
export function fieldByKey(config: CheckoutFieldsConfig, key: string): CheckoutFieldDef | undefined {
  return config.fields.find((f) => f.key === key);
}

/** Doc 29: does a condition match the live checkout context? */
export function conditionMatches(
  cond: CheckoutFieldCondition | undefined,
  ctx: CheckoutConditionContext,
): boolean {
  if (!cond) return false;
  if (cond.source === "cartTotal") {
    return typeof ctx.cartTotalPoisha === "number" && ctx.cartTotalPoisha >= cond.minPoisha;
  }
  const actual =
    cond.source === "paymentMethod"
      ? ctx.paymentMethod
      : cond.source === "shippingMethod"
        ? ctx.shippingMethod
        : ctx.division;
  if (typeof actual !== "string" || actual.trim() === "") return false;
  const a = actual.trim().toLowerCase();
  return cond.values.some((v) => v.toLowerCase() === a);
}

/** Doc 29: is the field in play at all under the current context? */
export function effectiveVisible(def: CheckoutFieldDef, ctx: CheckoutConditionContext): boolean {
  if (!def.visible) return false;
  if (def.visibleWhen && !conditionMatches(def.visibleWhen, ctx)) return false;
  return true;
}

/** Doc 29: is the field required under the current context? */
export function effectiveRequired(def: CheckoutFieldDef, ctx: CheckoutConditionContext): boolean {
  if (def.required) return true;
  if (def.requiredWhen && conditionMatches(def.requiredWhen, ctx)) return true;
  return false;
}

const ANSWER_PATTERNS: Record<CheckoutAnswerPattern, RegExp> = {
  digits: /^[0-9]+$/,
  bd_phone: /^(\+?880|0)1[3-9]\d{8}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
};

/**
 * Doc 29: validate a present (non-empty) answer against the field's
 * validation rules. Returns the failure kind, or null when valid.
 * The caller handles absence (required checks) and the hard
 * MAX_ANSWER_LENGTH cap for extras.
 */
export function validateAnswer(
  def: CheckoutFieldDef,
  value: string,
): "TOO_SHORT" | "TOO_LONG" | "INVALID_FORMAT" | null {
  const v = def.validation;
  if (!v) return null;
  const trimmed = value.trim();
  if (v.minLength !== undefined && trimmed.length < v.minLength) return "TOO_SHORT";
  if (v.maxLength !== undefined && trimmed.length > v.maxLength) return "TOO_LONG";
  if (v.pattern) {
    const probe = v.pattern === "bd_phone" ? trimmed.replace(/[\s-]/g, "") : trimmed;
    if (!ANSWER_PATTERNS[v.pattern].test(probe)) return "INVALID_FORMAT";
  }
  return null;
}

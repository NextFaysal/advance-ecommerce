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

const BUILTIN_DEFAULTS: CheckoutFieldDef[] = [
  { key: "customerName", labelBn: "আপনার নাম", labelEn: "Your name", visible: true, required: true },
  { key: "phone", labelBn: "মোবাইল নম্বর", labelEn: "Mobile number", placeholder: "01XXXXXXXXX", visible: true, required: true },
  { key: "email", labelBn: "ইমেইল (ঐচ্ছিক)", labelEn: "Email (optional)", visible: true, required: false },
  { key: "division", labelBn: "বিভাগ", labelEn: "Division", visible: true, required: true },
  { key: "district", labelBn: "জেলা", labelEn: "District", visible: true, required: true },
  { key: "upazila", labelBn: "উপজেলা", labelEn: "Upazila", visible: true, required: true },
  { key: "union", labelBn: "ইউনিয়ন (ঐচ্ছিক)", labelEn: "Union (optional)", visible: true, required: false },
  { key: "addressLine", labelBn: "বিস্তারিত ঠিকানা", labelEn: "Detailed address", visible: true, required: true },
  { key: "note", labelBn: "নোট (ঐচ্ছিক)", labelEn: "Note (optional)", visible: true, required: false },
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
  return {
    key,
    labelBn,
    labelEn,
    ...(placeholder ? { placeholder } : fallback.placeholder ? { placeholder: fallback.placeholder } : {}),
    visible,
    required,
    ...(fallback.extra ? { extra: true } : {}),
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

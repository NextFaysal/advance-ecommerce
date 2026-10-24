/**
 * First-run setup wizard — pure state logic (Agent 37).
 *
 * The wizard collects store basics and integration ENABLEMENT only.
 * API keys / secrets are NEVER collected here — they belong in
 * Admin > Settings, stored encrypted (see src/lib/settings.ts). The
 * wizard's finish step sends this payload to POST /api/v1/admin/setup,
 * which writes every entry through setSetting() (src/lib/settings.ts)
 * into the Setting table and answers `persisted: true`.
 *
 * BD defaults are locked by product decision (Bangla default, BDT,
 * Asia/Dhaka) — the wizard displays them, it cannot change them.
 * Money is not handled here at all; enablement values are booleans,
 * serialised as "true"/"false" strings in the settings payload,
 * matching the settings contract shape { key, value, category }.
 */
import { normalizeBdPhone, BD_PHONE_REGEX } from "@advance-ecommerce/validators";

/**
 * Provider lists mirror PAYMENT_PROVIDERS / COURIER_PROVIDERS in
 * src/lib/settings.ts. They are re-declared here (not imported) because
 * settings.ts is server-only (Prisma-coupled) and this module is imported
 * by the client wizard. Keep the two lists in sync.
 */
export const PAYMENT_PROVIDERS = [
  "cod", "bkash", "nagad", "rocket", "upay", "sslcommerz", "aamarpay", "shurjopay", "stripe", "paypal",
] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const COURIER_PROVIDERS = ["steadfast", "pathao", "redx", "paperfly", "ecourier"] as const;
export type CourierProvider = (typeof COURIER_PROVIDERS)[number];

export const BD_LOCKED_DEFAULTS = {
  locale: "bn",
  currency: "BDT",
  timezone: "Asia/Dhaka",
} as const;

export type SetupStepId = "store" | "defaults" | "payments" | "couriers" | "integrations" | "finish";

export interface SetupStep {
  id: SetupStepId;
  labelBn: string;
  labelEn: string;
}

export const SETUP_STEPS: readonly SetupStep[] = [
  { id: "store", labelBn: "দোকানের তথ্য", labelEn: "Store info" },
  { id: "defaults", labelBn: "ভাষা ও মুদ্রা", labelEn: "Language & currency" },
  { id: "payments", labelBn: "পেমেন্ট পদ্ধতি", labelEn: "Payment methods" },
  { id: "couriers", labelBn: "কুরিয়ার", labelEn: "Couriers" },
  { id: "integrations", labelBn: "ইন্টিগ্রেশন", labelEn: "Integrations" },
  { id: "finish", labelBn: "সারসংক্ষেপ", labelEn: "Finish" },
];

export interface SetupState {
  storeName: string;
  storePhone: string;
  storeAddress: string;
  /** Enablement only. COD is on by default; keys are set later in Settings. */
  paymentMethods: Record<PaymentProvider, boolean>;
  courierProviders: Record<CourierProvider, boolean>;
}

export function initialSetupState(): SetupState {
  return {
    storeName: "",
    storePhone: "",
    storeAddress: "",
    paymentMethods: Object.fromEntries(
      PAYMENT_PROVIDERS.map((p) => [p, p === "cod"]),
    ) as Record<PaymentProvider, boolean>,
    courierProviders: Object.fromEntries(
      COURIER_PROVIDERS.map((c) => [c, false]),
    ) as Record<CourierProvider, boolean>,
  };
}

/* ------------------------------------------------------------------ */
/* Validation — pure functions, Bangla error messages                  */
/* ------------------------------------------------------------------ */

export function validateStoreInfo(state: SetupState): string[] {
  const errors: string[] = [];
  if (state.storeName.trim().length < 2) errors.push("দোকানের নাম কমপক্ষে ২ অক্ষরের হতে হবে।");
  const phone = state.storePhone.trim();
  if (!BD_PHONE_REGEX.test(phone) || normalizeBdPhone(phone) === null) {
    errors.push("সঠিক বাংলাদেশি মোবাইল নম্বর দিন (যেমন 01XXXXXXXXX)।");
  }
  if (state.storeAddress.trim().length < 8) errors.push("দোকানের ঠিকানা কমপক্ষে ৮ অক্ষরের হতে হবে।");
  return errors;
}

export function validatePayments(state: SetupState): string[] {
  return Object.values(state.paymentMethods).some(Boolean)
    ? []
    : ["কমপক্ষে একটি পেমেন্ট পদ্ধতি চালু করুন।"];
}

export function validateCouriers(state: SetupState): string[] {
  return Object.values(state.courierProviders).some(Boolean)
    ? []
    : ["কমপক্ষে একটি কুরিয়ার চালু করুন।"];
}

/** Errors for one step; steps not listed here have no input to validate. */
export function validateSetupStep(state: SetupState, step: SetupStepId): string[] {
  switch (step) {
    case "store":
      return validateStoreInfo(state);
    case "payments":
      return validatePayments(state);
    case "couriers":
      return validateCouriers(state);
    default:
      return [];
  }
}

export function isSetupComplete(state: SetupState): boolean {
  return SETUP_STEPS.every((s) => validateSetupStep(state, s.id).length === 0);
}

export function enabledPaymentMethods(state: SetupState): PaymentProvider[] {
  return PAYMENT_PROVIDERS.filter((p) => state.paymentMethods[p]);
}

export function enabledCourierProviders(state: SetupState): CourierProvider[] {
  return COURIER_PROVIDERS.filter((c) => state.courierProviders[c]);
}

/* ------------------------------------------------------------------ */
/* Settings payload — the { key, value, category } contract shape      */
/* ------------------------------------------------------------------ */

export interface SettingEntry {
  key: string;
  value: string;
  category: string;
}

/**
 * Build the settings entries the finish step submits. Keys follow the
 * settings contract: `general.store_name` is a built-in default key;
 * the rest match the `<category>.<provider>.<field>` pattern that
 * `isKnownSettingKey()` accepts. Values are strings, as in the contract.
 */
export function buildSetupSettingsPayload(state: SetupState): SettingEntry[] {
  const entries: SettingEntry[] = [
    { key: "general.store_name", value: state.storeName.trim(), category: "general" },
    { key: "general.store.phone", value: normalizeBdPhone(state.storePhone.trim()) ?? state.storePhone.trim(), category: "general" },
    { key: "general.store.address", value: state.storeAddress.trim(), category: "general" },
    { key: "general.locale", value: BD_LOCKED_DEFAULTS.locale, category: "general" },
    { key: "general.currency", value: BD_LOCKED_DEFAULTS.currency, category: "general" },
    { key: "general.timezone", value: BD_LOCKED_DEFAULTS.timezone, category: "general" },
  ];
  for (const p of PAYMENT_PROVIDERS) {
    entries.push({ key: `payment.${p}.enabled`, value: String(state.paymentMethods[p]), category: "payment" });
  }
  for (const c of COURIER_PROVIDERS) {
    entries.push({ key: `courier.${c}.enabled`, value: String(state.courierProviders[c]), category: "courier" });
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/* Progress persistence — localStorage ONLY (demo)                     */
/* ------------------------------------------------------------------ */

export const SETUP_STORAGE_KEY = "advance-ecommerce:setup-wizard:v1";

export interface SetupProgress {
  state: SetupState;
  stepIndex: number;
}

export function loadSetupProgress(): SetupProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SETUP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SetupProgress>;
    if (!parsed.state || typeof parsed.stepIndex !== "number") return null;
    // Merge over the initial state so new provider keys default safely.
    const base = initialSetupState();
    return {
      state: {
        ...base,
        ...parsed.state,
        paymentMethods: { ...base.paymentMethods, ...parsed.state.paymentMethods },
        courierProviders: { ...base.courierProviders, ...parsed.state.courierProviders },
      },
      stepIndex: Math.min(Math.max(parsed.stepIndex, 0), SETUP_STEPS.length - 1),
    };
  } catch {
    return null;
  }
}

export function saveSetupProgress(progress: SetupProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SETUP_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Storage full/blocked — the wizard still works in-memory.
  }
}

export function clearSetupProgress(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SETUP_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* Submission — persisted via setSetting()                             */
/* ------------------------------------------------------------------ */

/**
 * Submissions persist through the setup API route, which writes each
 * payload entry via setSetting() (src/lib/settings.ts) into the
 * Setting table with a settings.update audit entry. There is no
 * submission store in this module anymore — the payload shape above
 * (buildSetupSettingsPayload) is the contract.
 */

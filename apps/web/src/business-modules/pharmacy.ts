/**
 * Pharmacy pack — Agent 17, Step 49 (Part C).
 * Prescription-required enforcement and expiry warnings. Pure rules:
 * an Rx-required item can never be validated for checkout without an
 * uploaded prescription reference; expiry is computed from dates only.
 * This pack stores NO medical data — only a prescription image ref id.
 */
import { z } from "zod";
import type { BusinessModulePack, PackValidation } from "./types";

export const pharmacyConfigSchema = z.object({
  /** Warn in admin + block sale when a batch expires within this many days. */
  expiryWarningDays: z.number().int().min(0).max(365).default(90),
  /** Never sell a batch expiring within this many days (0 = sell until expiry date). */
  expiryBlockDays: z.number().int().min(0).max(90).default(0),
  /** Pharmacist must approve every Rx order before confirmation. */
  pharmacistReviewRequired: z.boolean().default(true),
});

export type PharmacyConfig = z.infer<typeof pharmacyConfigSchema>;

export const pharmacyPack: BusinessModulePack<PharmacyConfig> = {
  id: "pharmacy",
  flagKey: "module.pharmacy",
  nameEn: "Pharmacy",
  nameBn: "ফার্মেসি",
  description: "Prescription-required rules and batch expiry warnings for pharmacies.",
  defaultConfig: { expiryWarningDays: 90, expiryBlockDays: 0, pharmacistReviewRequired: true },
  configSchema: pharmacyConfigSchema,
};

export interface PharmacyProductFlags {
  requiresPrescription: boolean;
}

export interface PharmacyCartItemInput {
  variantId: string;
  requiresPrescription: boolean;
}

/**
 * Checkout gate: if ANY item needs a prescription, a prescription ref
 * (uploaded image id) is mandatory. There is no bypass flag.
 */
export function validatePharmacyCheckout(
  items: PharmacyCartItemInput[],
  prescriptionRef: string | null,
): PackValidation {
  const needsRx = items.some((i) => i.requiresPrescription);
  if (needsRx && (prescriptionRef === null || prescriptionRef.trim() === "")) {
    return {
      ok: false,
      errors: [{ field: "prescriptionRef", message: "A prescription upload is required for this order." }],
    };
  }
  return { ok: true };
}

export type ExpiryStatus = "ok" | "warning" | "blocked" | "expired";

export function expiryStatus(config: PharmacyConfig, expiryDate: string, now: Date): ExpiryStatus {
  const expiry = new Date(`${expiryDate}T23:59:59`);
  if (Number.isNaN(expiry.getTime())) throw new Error("Invalid expiry date.");
  const daysLeft = Math.floor((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (daysLeft < 0) return "expired";
  // expiryBlockDays = 0 means "sell until the expiry date itself", so the
  // block band only applies when a positive block window is configured.
  if (config.expiryBlockDays > 0 && daysLeft <= config.expiryBlockDays) return "blocked";
  if (daysLeft <= config.expiryWarningDays) return "warning";
  return "ok";
}

/** True when a batch may be sold under the pack's rules. */
export function canSellBatch(config: PharmacyConfig, expiryDate: string, now: Date): boolean {
  const status = expiryStatus(config, expiryDate, now);
  return status === "ok" || status === "warning";
}

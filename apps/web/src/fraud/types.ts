/**
 * Fraud / risk scoring types — Agent 13, Execution Plan Step 43 (A2).
 *
 * Pure types + Zod schema. All money is integer poisha. The customer phone
 * is an input for matching only: assessments, signal details and logs carry
 * the MASKED phone, never the full number (see scoring.ts).
 */
import { z } from "zod";
import type { RiskLevel } from "../orders/customer";

export type { RiskLevel };

/* ------------------------------------------------------------------ */
/* Blacklist / whitelist                                               */
/* ------------------------------------------------------------------ */

export type FraudListKind = "phone" | "address" | "ip";

export interface FraudListEntry {
  id: string;
  kind: FraudListKind;
  /** Phone: normalized +8801XXXXXXXXX. Address: district key (lowercase) — see lists.ts matching rules. */
  value: string;
  /** District for address entries; kept structured so matching is not free-text guessing. */
  district?: string;
  reason: string;
  createdBy?: string;
  createdAt: string;
}

export interface FraudLists {
  blacklist: FraudListEntry[];
  whitelist: FraudListEntry[];
}

/* ------------------------------------------------------------------ */
/* Scoring input — everything the scorer needs, nothing it fetches.    */
/* Callers (order service) assemble this from DB rows; the scorer      */
/* itself is pure and deterministic for a given input.                 */
/* ------------------------------------------------------------------ */

export interface RecentOrderRef {
  id: string;
  /** Item identity keys (variantId or SKU) on that order. */
  itemKeys: string[];
  createdAt: string;
  status: string;
}

export interface CourierHistory {
  totalBookings: number;
  delivered: number;
  failedOrReturned: number;
}

export interface ReturnHistory {
  totalOrders: number;
  returnedOrders: number;
}

export interface AddressRef {
  division: string;
  district: string;
  upazila: string;
}

export interface FraudScoreInput {
  /** Normalized +8801XXXXXXXXX (caller normalizes with validators). */
  phone: string;
  /** Shipping address of the order being scored. */
  shippingAddress: AddressRef;
  /** The customer's saved / previous address, when one exists — mismatch is a signal, absence is not. */
  accountAddress?: AddressRef;
  paymentMethod: string;
  /** Order grand total, integer poisha. */
  totalPoisha: number;
  /** Item identity keys (variantId or SKU) on the order being scored. */
  itemKeys: string[];
  /** Same customer's recent orders, newest first. */
  recentOrders: RecentOrderRef[];
  /** Window for the duplicate check, minutes. Default 60. */
  duplicateWindowMinutes?: number;
  /** Courier delivery history for this phone, when known. */
  courierHistory?: CourierHistory;
  returnHistory?: ReturnHistory;
  lists: FraudLists;
  /** Client IP address, when available. */
  ip?: string;
  /** ISO timestamp injected by the caller (deterministic tests). */
  now: string;
}

/* ------------------------------------------------------------------ */
/* Assessment                                                          */
/* ------------------------------------------------------------------ */

export type FraudSignalKey =
  | "blacklist_hit"
  | "whitelist"
  | "duplicate_order"
  | "courier_success_rate"
  | "high_cod_amount"
  | "address_mismatch"
  | "return_history";

export interface SignalResult {
  key: FraudSignalKey;
  /** Points contributed, after clamping the total. Negative only for whitelist. */
  points: number;
  triggered: boolean;
  /** Human-readable, phone-masked. Safe to store / display. */
  detail: string;
}

export type SuggestedAction =
  | "auto_confirm"
  | "manual_review"
  | "require_advance"
  | "block";

export interface FraudAssessment {
  /** 0-100, clamped. Higher is riskier. Bands match orders/customer riskLevel: Low <40, Medium 40-69, High >=70. */
  score: number;
  level: RiskLevel;
  suggestedAction: SuggestedAction;
  /** High-risk orders must complete an OTP challenge before confirm. */
  requiresOtp: boolean;
  signals: SignalResult[];
  phoneMasked: string;
  assessedAt: string;
}

/* ------------------------------------------------------------------ */
/* Zod schema for the score API route                                  */
/* ------------------------------------------------------------------ */

const addressRefSchema = z.object({
  division: z.string().min(1),
  district: z.string().min(1),
  upazila: z.string().min(1),
});

const fraudListEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["phone", "address", "ip"]),
  value: z.string().min(1),
  district: z.string().optional(),
  reason: z.string().min(1),
  createdBy: z.string().optional(),
  createdAt: z.string().datetime(),
});

export const fraudScoreRequestSchema: z.ZodType<FraudScoreInput> = z.lazy(() =>
  z.object({
    phone: z.string().min(11).max(15),
    shippingAddress: addressRefSchema,
    accountAddress: addressRefSchema.optional(),
    paymentMethod: z.string().min(1),
    totalPoisha: z.number().int().nonnegative(),
    itemKeys: z.array(z.string().min(1)).min(1),
    recentOrders: z.array(
      z.object({
        id: z.string().min(1),
        itemKeys: z.array(z.string().min(1)),
        createdAt: z.string().datetime(),
        status: z.string().min(1),
      }),
    ),
    duplicateWindowMinutes: z.number().int().positive().max(7 * 24 * 60).optional(),
    courierHistory: z
      .object({
        totalBookings: z.number().int().nonnegative(),
        delivered: z.number().int().nonnegative(),
        failedOrReturned: z.number().int().nonnegative(),
      })
      .optional(),
    returnHistory: z
      .object({
        totalOrders: z.number().int().nonnegative(),
        returnedOrders: z.number().int().nonnegative(),
      })
      .optional(),
    lists: z.object({
      blacklist: z.array(fraudListEntrySchema),
      whitelist: z.array(fraudListEntrySchema),
    }),
    now: z.string().datetime(),
  }),
);

export const createListEntrySchema = z.object({
  list: z.enum(["blacklist", "whitelist"]),
  kind: z.enum(["phone", "address"]),
  value: z.string().min(1).max(200),
  district: z.string().min(1).max(100).optional(),
  reason: z.string().min(3).max(500),
});

export type CreateListEntryInput = z.infer<typeof createListEntrySchema>;

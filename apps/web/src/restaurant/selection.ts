/**
 * Restaurant selection — ADV-23 vertical 1 (doc 23, wave 56).
 *
 * PURE module (zod + types only, no prisma/settings imports) so the
 * checkout form schema can embed the selection shape client-side,
 * exactly like the prescription / age-attestation fields in
 * src/checkout/validation.ts. The server-side config + persistence
 * live in src/restaurant/config.ts and src/restaurant/tickets.ts.
 *
 * The selection is what a create payload carries:
 *   restaurant: { fulfilmentType: "DINE_IN" | "TAKEAWAY", tableLabel? }
 * It is validated AGAIN server-side against the merchant's effective
 * restaurant.config at create time (validateRestaurantSelection) —
 * the client's copy of the table list is never trusted, mirroring
 * the delivery-slot / pickup-point contract.
 */
import { z } from "zod";

export const restaurantSelectionSchema = z.object({
  fulfilmentType: z.enum(["DINE_IN", "TAKEAWAY"]),
  /** One of the merchant's configured table labels (restaurant.config
   *  `tables`). Required for DINE_IN, ignored for TAKEAWAY. */
  tableLabel: z.string().trim().min(1).max(40).optional(),
});

export type RestaurantSelection = z.infer<typeof restaurantSelectionSchema>;

export type RestaurantFulfilmentType = RestaurantSelection["fulfilmentType"];

/** The validated ticket spec both create seams hand to
 *  createOrderRecord (which writes the KitchenTicket row inside the
 *  create transaction). tableLabel is null for TAKEAWAY, always. */
export interface KitchenTicketSpec {
  fulfilmentType: RestaurantFulfilmentType;
  tableLabel: string | null;
}

export const KITCHEN_TICKET_STATUSES = [
  "QUEUED",
  "PREPARING",
  "READY",
  "SERVED",
  "CANCELLED",
] as const;

export type KitchenTicketStatus = (typeof KITCHEN_TICKET_STATUSES)[number];

export const KITCHEN_STATUS_LABELS_BN: Record<KitchenTicketStatus, string> = {
  QUEUED: "অপেক্ষমাণ",
  PREPARING: "তৈরি হচ্ছে",
  READY: "প্রস্তুত",
  SERVED: "পরিবেশন হয়েছে",
  CANCELLED: "বাতিল",
};

export const KITCHEN_STATUS_LABELS_EN: Record<KitchenTicketStatus, string> = {
  QUEUED: "Queued",
  PREPARING: "Preparing",
  READY: "Ready",
  SERVED: "Served",
  CANCELLED: "Cancelled",
};

/** Forward-only KDS transitions (the board's advance button walks
 *  this map). CANCELLED is NOT reachable from the board — it is set
 *  only by the order-cancellation seam in applyOrderTransition. */
export const KITCHEN_NEXT_STATUS: Partial<Record<KitchenTicketStatus, KitchenTicketStatus>> = {
  QUEUED: "PREPARING",
  PREPARING: "READY",
  READY: "SERVED",
};

/**
 * The merchant's effective restaurant config as the validator needs
 * it (src/restaurant/config.ts resolves the stored doc into this —
 * dineInEnabled here is already EFFECTIVE: false whenever no tables
 * are configured, whatever the stored toggle says).
 */
export interface EffectiveRestaurantConfig {
  tables: string[];
  takeawayEnabled: boolean;
  dineInEnabled: boolean;
}

export type RestaurantSelectionValidation =
  | { ok: true; ticket: KitchenTicketSpec }
  | { ok: false; code: string; message: string };

/**
 * Validate a submitted selection against the effective config.
 * Violations are 400-class with a bilingual message (the create
 * seams map them onto their own error contracts). Rules:
 *   TAKEAWAY — requires takeawayEnabled; any tableLabel is dropped.
 *   DINE_IN  — requires dineInEnabled (effective: toggle ON and at
 *              least one configured table) AND a tableLabel that is
 *              one of the configured tables.
 */
export function validateRestaurantSelection(
  selection: RestaurantSelection,
  config: EffectiveRestaurantConfig,
): RestaurantSelectionValidation {
  if (selection.fulfilmentType === "TAKEAWAY") {
    if (!config.takeawayEnabled) {
      return {
        ok: false,
        code: "RESTAURANT_TAKEAWAY_DISABLED",
        message:
          "এই দোকানে টেকঅওয়ে সুবিধা বন্ধ আছে। / Takeaway is not available at this store.",
      };
    }
    return { ok: true, ticket: { fulfilmentType: "TAKEAWAY", tableLabel: null } };
  }
  // DINE_IN
  if (!config.dineInEnabled || config.tables.length === 0) {
    return {
      ok: false,
      code: "RESTAURANT_DINE_IN_DISABLED",
      message:
        "এই দোকানে ডাইন-ইন সুবিধা এখন চালু নেই। / Dine-in is not available at this store right now.",
    };
  }
  const tableLabel = selection.tableLabel?.trim() ?? "";
  if (tableLabel === "") {
    return {
      ok: false,
      code: "RESTAURANT_TABLE_REQUIRED",
      message: "ডাইন-ইন অর্ডারের জন্য একটি টেবিল বেছে নিন। / Please choose a table for your dine-in order.",
    };
  }
  if (!config.tables.includes(tableLabel)) {
    return {
      ok: false,
      code: "RESTAURANT_TABLE_UNKNOWN",
      message:
        "বেছে নেওয়া টেবিলটি পাওয়া যায়নি — অনুগ্রহ করে আবার বেছে নিন। / The selected table is not available — please choose again.",
    };
  }
  return { ok: true, ticket: { fulfilmentType: "DINE_IN", tableLabel } };
}

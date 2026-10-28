// Tracking-event intake validation — SERVER ONLY (perf wave, zod diet).
//
// The trackingEventInputSchema used to live in ./events next to the
// shared event builder + dedup helpers. The browser pixel client
// (./client/pixel-client, mounted by TrackingProvider on every route)
// imports buildTrackingEvent/generateEventId from ./events, which
// dragged the zod runtime into the browser bundle. The schema now
// lives here; ./events stays schema-free so client components can
// import it safely.
//
// Server validation is unchanged: the public track-events API route
// imports the exact same schema object from this module instead.
import { z } from "zod";
import { isValidQtyNumber } from "../lib/quantity";
import {
  STANDARD_EVENT_NAMES,
  type StandardEventName,
} from "./types";

export const trackingEventInputSchema = z.object({
  eventName: z.enum(STANDARD_EVENT_NAMES as unknown as [StandardEventName, ...StandardEventName[]]),
  eventId: z.string().min(8).max(80).optional(),
  orderId: z.string().max(64).nullable().optional(),
  valuePoisha: z.number().int().min(0).nullable().optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        variantId: z.string().max(64).nullable(),
        // Wave 59: analytics items may carry fractional quantities
        // (weighted goods) — still bounded, max 3 decimals.
        quantity: z.number().refine((n) => isValidQtyNumber(n) && n <= 999, "quantity must be positive (max 3 decimals), at most 999"),
        itemPricePoisha: z.number().int().min(0),
      }),
    )
    .max(100)
    .optional(),
  eventSourceUrl: z.string().url().max(2000).nullable().optional(),
  occurredAt: z.string().datetime().optional(),
  strictlyNecessary: z.boolean().optional(),
});

// Flash sale admin write validation — SERVER ONLY (perf wave, zod diet).
//
// These zod schemas used to live in ./flash-sale next to the shared
// types + pure helpers. The admin flash-sale manager (a client
// component) imports those helpers, which dragged the zod runtime
// into the browser bundle. The schemas now live here; ./flash-sale
// stays schema-free so client components can import it safely.
//
// Server validation is unchanged: the API routes import the exact
// same schema objects from this module instead.
import { z } from "zod";

const isoInstant = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Invalid datetime." });

export const flashSaleItemInputSchema = z.object({
  variantId: z.string().min(1),
  /** Optional on input: the repository derives it from the variant
   *  and rejects the write when a supplied value disagrees. */
  productId: z.string().min(1).optional(),
  salePricePoisha: z.number().int().min(0),
  stockCap: z.number().int().min(1),
});
export type FlashSaleItemInput = z.infer<typeof flashSaleItemInputSchema>;

export const flashSaleInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    startsAt: isoInstant,
    endsAt: isoInstant,
    isActive: z.boolean().default(true),
    items: z.array(flashSaleItemInputSchema).min(1),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: "endsAt must be after startsAt.",
    path: ["endsAt"],
  })
  .refine((v) => new Set(v.items.map((i) => i.variantId)).size === v.items.length, {
    message: "Each variant may appear only once per flash sale.",
    path: ["items"],
  });
export type FlashSaleInput = z.infer<typeof flashSaleInputSchema>;

/** Full-replace update — same contract as create. */
export const createFlashSaleSchema = flashSaleInputSchema;
export const updateFlashSaleSchema = flashSaleInputSchema;

export const flashSaleActiveSchema = z.object({ isActive: z.boolean() });

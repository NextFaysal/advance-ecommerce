// Manual order — phone/Facebook/WhatsApp/call orders entered by staff.
// Target: <= 30 seconds (customer lookup by phone -> add items -> address ->
// payment -> confirm). Defaults are prefilled so the form is mostly taps.
// Zod reuses the checkout address/phone rules; this is a staff-side shortcut,
// not a second checkout implementation.
import { z } from "zod";
import { bdAddressSchema, BD_PHONE_REGEX } from "../checkout/validation";

export const manualOrderSchema = z.object({
  phone: z.string().refine((v) => BD_PHONE_REGEX.test(v.replace(/[\s-]/g, "")), {
    message: "Sothik Bangladesh mobile number din",
  }),
  customerName: z.string().min(2, "Nam dite hobe"),
  address: bdAddressSchema,
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().positive(),
        /** Staff may set a custom price/discount; recorded in order history. */
        unitPricePoisha: z.number().int().nonnegative(),
      }),
    )
    .min(1, "Ontoto ekti item add korun"),
  paymentMethod: z.enum(["cod", "bkash", "nagad"]),
  note: z.string().max(500).optional(),
});

export type ManualOrderInput = z.infer<typeof manualOrderSchema>;

/** The five taps/steps of the manual-order flow, in order. */
export const MANUAL_ORDER_STEPS = [
  "Customer lookup (phone)",
  "Add items",
  "Address (Bangla parser in v2)",
  "Payment method",
  "Confirm",
] as const;

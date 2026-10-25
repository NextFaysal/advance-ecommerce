import { z } from "zod";
import { BD_PHONE_REGEX, normalizeBdPhone } from "@/checkout/validation";

/**
 * Public review submission (POST /api/v1/public/products/[slug]/reviews).
 *
 * The phone is validated as a BD mobile and normalized to
 * +8801XXXXXXXXX — the same contract checkout uses. It is stored for
 * verification only and NEVER returned on public reads (see store.ts).
 * Rating is a JSON number, an integer 1–5 — validated here at the API
 * boundary, per the Review model contract.
 */
export const createReviewSchema = z.object({
  authorName: z.string().trim().min(2, "নাম দিন").max(80),
  phone: z
    .string()
    .refine((v) => BD_PHONE_REGEX.test(v.replace(/[\s-]/g, "")), {
      message: "সঠিক বাংলাদেশি মোবাইল নম্বর দিন",
    })
    .transform((v) => normalizeBdPhone(v) as string),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(3, "রিভিউ লিখুন").max(2000),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const setReviewStatusSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
});

/**
 * Contact form — Zod schema. Agent 47.
 *
 * Phone validation/normalization is REUSED from
 * @advance-ecommerce/validators (normalizeBdPhone), never re-implemented.
 * All user-facing issue messages are Bangla-first.
 *
 * The `website` field is a HONEYPOT: it is rendered off-screen, real
 * users never see or fill it, and bots that fill every field trip it.
 * The route checks it on the RAW body before validation — see
 * policy.ts (isHoneypotTripped) and the route handler. The field name
 * must never be revealed in any response.
 */
import { z } from "zod";
import { normalizeBdPhone } from "@advance-ecommerce/validators";

/** Name of the honeypot field in the submitted body. */
export const CONTACT_HONEYPOT_FIELD = "website";

export const contactSubmissionSchema = z.object({
  name: z
    .string({ required_error: "আপনার নাম লিখুন।" })
    .trim()
    .min(2, "নাম অন্তত ২ অক্ষরের হতে হবে।")
    .max(80, "নাম সর্বোচ্চ ৮০ অক্ষরের হতে পারে।"),
  phone: z
    .string({ required_error: "মোবাইল নম্বর দিন।" })
    .trim()
    .refine((v) => normalizeBdPhone(v) !== null, {
      message: "সঠিক বাংলাদেশি মোবাইল নম্বর দিন (যেমন 01XXXXXXXXX)।",
    })
    // Safe: the refine above guarantees normalizeBdPhone succeeds.
    .transform((v) => normalizeBdPhone(v) as string),
  email: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .email("সঠিক ইমেইল ঠিকানা দিন, অথবা ঘরটি খালি রাখুন।")
        .max(200, "ইমেইল সর্বোচ্চ ২০০ অক্ষরের হতে পারে।"),
    ])
    .optional()
    .transform((v) => (v ? v : null)),
  subject: z
    .string({ required_error: "বার্তার বিষয় লিখুন।" })
    .trim()
    .min(3, "বিষয় অন্তত ৩ অক্ষরের হতে হবে।")
    .max(120, "বিষয় সর্বোচ্চ ১২০ অক্ষরের হতে পারে।"),
  message: z
    .string({ required_error: "আপনার বার্তা লিখুন।" })
    .trim()
    .min(10, "বার্তা অন্তত ১০ অক্ষরের হতে হবে।")
    .max(2000, "বার্তা সর্বোচ্চ ২০০০ অক্ষরের হতে পারে।"),
  // Honeypot — accepted by the schema so a tripped bot that otherwise
  // validates still flows to the same response shape; the route checks
  // it before this schema runs and stores nothing.
  website: z.string().max(200).optional(),
});

/** Raw body shape (pre-validation), used for the honeypot pre-check. */
export interface ContactRawBody {
  [CONTACT_HONEYPOT_FIELD]?: unknown;
  [key: string]: unknown;
}

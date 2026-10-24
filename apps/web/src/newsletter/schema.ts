/**
 * Newsletter subscribe — validation + shared types (pure, client-safe).
 *
 * The DB-backed store lives in store-db.ts (server-only, Prisma) and
 * the in-memory store for tests/preview in store.ts — this module is
 * imported by the client form component, so it must never pull Prisma.
 *
 * Email is the only identity: normalized (trim + lowercase) before
 * storage, and subscribing is IDEMPOTENT — an already-subscribed
 * address is a no-op success, never a duplicate row and never an
 * error the visitor has to decode.
 */
import { z } from "zod";

export const newsletterSubscribeSchema = z.object({
  /** Any case/whitespace the visitor types; normalized before storage. */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "সঠিক ইমেইল ঠিকানা দিন।")
    .max(254, "সঠিক ইমেইল ঠিকানা দিন।")
    .email("সঠিক ইমেইল ঠিকানা দিন।"),
  /** Which surface collected the address ("homepage" today). */
  source: z.string().trim().min(1).max(40).optional(),
});

export type NewsletterSubscribeInput = z.infer<typeof newsletterSubscribeSchema>;

/** Full record — server-side only (carries the row id + timestamps). */
export interface NewsletterSubscriber {
  id: string;
  email: string;
  source: string;
  status: "subscribed" | "unsubscribed";
  createdAt: string;
  updatedAt: string;
  unsubscribedAt: string | null;
}

/** What the public API may return: no row id, no internal timestamps. */
export interface NewsletterSubscriberPublic {
  email: string;
  status: "subscribed";
  subscribedAt: string;
}

export type SubscribeResult =
  | { ok: true; subscriber: NewsletterSubscriberPublic; duplicate: boolean }
  | { ok: false; error: string };

export function toPublicSubscriber(row: NewsletterSubscriber): NewsletterSubscriberPublic {
  return { email: row.email, status: "subscribed", subscribedAt: row.createdAt };
}

/** The source stored when the caller does not name one. */
export const DEFAULT_NEWSLETTER_SOURCE = "homepage";

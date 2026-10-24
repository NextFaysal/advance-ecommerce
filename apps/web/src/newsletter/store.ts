/**
 * Newsletter subscribe — store contract + in-memory implementation.
 *
 * The public route talks to the NewsletterStore interface only. The
 * production implementation is PrismaNewsletterStore (store-db.ts);
 * this in-memory one serves tests and preview, with IDENTICAL
 * idempotency semantics:
 *
 * - new address            → stored, duplicate: false
 * - already subscribed     → no-op success, duplicate: true
 * - previously unsubscribed → reactivated (status + timestamps
 *   updated), duplicate: false — it is a fresh subscription again
 */
import {
  DEFAULT_NEWSLETTER_SOURCE,
  newsletterSubscribeSchema,
  toPublicSubscriber,
  type NewsletterSubscribeInput,
  type NewsletterSubscriber,
  type SubscribeResult,
} from "./schema";

/**
 * Thrown by the Prisma store when the NewsletterSubscriber model is
 * not in the generated client yet (schema + migration pending — the
 * route maps this to an honest 503, never a fake success).
 */
export class NewsletterStoreUnavailableError extends Error {
  constructor(message = "NewsletterSubscriber model is not available in the Prisma client yet.") {
    super(message);
    this.name = "NewsletterStoreUnavailableError";
  }
}

export interface NewsletterStore {
  subscribe(input: NewsletterSubscribeInput): Promise<SubscribeResult>;
}

export class InMemoryNewsletterStore implements NewsletterStore {
  private readonly rows: NewsletterSubscriber[] = [];
  private sequence = 0;

  async subscribe(input: NewsletterSubscribeInput): Promise<SubscribeResult> {
    const parsed = newsletterSubscribeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "সঠিক ইমেইল ঠিকানা দিন।" };
    const email = parsed.data.email;
    const source = parsed.data.source ?? DEFAULT_NEWSLETTER_SOURCE;
    const now = new Date().toISOString();

    const existing = this.rows.find((r) => r.email === email);
    if (existing) {
      if (existing.status === "subscribed") {
        return { ok: true, subscriber: toPublicSubscriber(existing), duplicate: true };
      }
      // Reactivate an unsubscribed address.
      existing.status = "subscribed";
      existing.unsubscribedAt = null;
      existing.updatedAt = now;
      existing.source = source;
      return { ok: true, subscriber: toPublicSubscriber(existing), duplicate: false };
    }

    this.sequence += 1;
    const row: NewsletterSubscriber = {
      id: `mem_${this.sequence}`,
      email,
      source,
      status: "subscribed",
      createdAt: now,
      updatedAt: now,
      unsubscribedAt: null,
    };
    this.rows.push(row);
    return { ok: true, subscriber: toPublicSubscriber(row), duplicate: false };
  }

  /** Test/support helper — number of stored rows. */
  count(): number {
    return this.rows.length;
  }
}

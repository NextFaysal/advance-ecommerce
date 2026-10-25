/**
 * Newsletter subscribe — DB store (server-only, Prisma).
 *
 * ⚠️ MODEL PENDING — the one blocker for this feature. There is NO
 * newsletter/subscriber model in packages/db/prisma/schema.prisma yet,
 * so the generated Prisma client has no `newsletterSubscriber`
 * delegate and this store throws NewsletterStoreUnavailableError at
 * runtime (the public route maps that to an honest 503 — subscribing
 * NEVER fake-succeeds).
 *
 * The adapter is otherwise READY: it is written against a structural
 * view of the delegate and starts working unchanged the moment the
 * parent adds this model + a migration (no code change needed here):
 *
 *   model NewsletterSubscriber {
 *     id             String    @id @default(cuid())
 *     email          String    @unique
 *     source         String    @default("homepage")
 *     status         String    @default("subscribed") // subscribed | unsubscribed
 *     createdAt      DateTime  @default(now())
 *     updatedAt      DateTime  @updatedAt
 *     unsubscribedAt DateTime?
 *   }
 *
 * Idempotency: email is unique; an existing subscribed row is a no-op
 * success, an unsubscribed row is reactivated, and a P2002 race on
 * create resolves to the winning row as a duplicate.
 */
import { prisma } from "@advance-ecommerce/db";
import {
  DEFAULT_NEWSLETTER_SOURCE,
  newsletterSubscribeSchema,
  toPublicSubscriber,
  type NewsletterSubscribeInput,
  type NewsletterSubscriber,
  type SubscribeResult,
} from "./schema";
import { NewsletterStoreUnavailableError, type NewsletterStore } from "./store";

interface NewsletterSubscriberRow {
  id: string;
  email: string;
  source: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  unsubscribedAt: Date | null;
}

/** Structural view of the delegate the model above will generate. */
interface NewsletterSubscriberDelegate {
  findUnique(args: { where: { email: string } }): Promise<NewsletterSubscriberRow | null>;
  create(args: {
    data: { email: string; source: string; status: string };
  }): Promise<NewsletterSubscriberRow>;
  update(args: {
    where: { email: string };
    data: { status: string; unsubscribedAt: null; source: string };
  }): Promise<NewsletterSubscriberRow>;
  findMany(args: {
    orderBy: { createdAt: "desc" };
    take: number;
  }): Promise<NewsletterSubscriberRow[]>;
  count(args?: { where?: { status: string } }): Promise<number>;
}

function delegate(): NewsletterSubscriberDelegate {
  const d = (
    prisma as unknown as { newsletterSubscriber?: NewsletterSubscriberDelegate }
  ).newsletterSubscriber;
  if (!d) throw new NewsletterStoreUnavailableError();
  return d;
}

function rowToSubscriber(row: NewsletterSubscriberRow): NewsletterSubscriber {
  return {
    id: row.id,
    email: row.email,
    source: row.source,
    status: row.status === "unsubscribed" ? "unsubscribed" : "subscribed",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    unsubscribedAt: row.unsubscribedAt ? row.unsubscribedAt.toISOString() : null,
  };
}

export class PrismaNewsletterStore implements NewsletterStore {
  async subscribe(input: NewsletterSubscribeInput): Promise<SubscribeResult> {
    const parsed = newsletterSubscribeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "সঠিক ইমেইল ঠিকানা দিন।" };
    const email = parsed.data.email;
    const source = parsed.data.source ?? DEFAULT_NEWSLETTER_SOURCE;
    const store = delegate();

    const existing = await store.findUnique({ where: { email } });
    if (existing) {
      if (existing.status !== "unsubscribed") {
        return { ok: true, subscriber: toPublicSubscriber(rowToSubscriber(existing)), duplicate: true };
      }
      const reactivated = await store.update({
        where: { email },
        data: { status: "subscribed", unsubscribedAt: null, source },
      });
      return { ok: true, subscriber: toPublicSubscriber(rowToSubscriber(reactivated)), duplicate: false };
    }

    try {
      const created = await store.create({ data: { email, source, status: "subscribed" } });
      return { ok: true, subscriber: toPublicSubscriber(rowToSubscriber(created)), duplicate: false };
    } catch (e) {
      if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
        const winner = await store.findUnique({ where: { email } });
        if (winner) {
          return { ok: true, subscriber: toPublicSubscriber(rowToSubscriber(winner)), duplicate: true };
        }
      }
      throw e;
    }
  }
}

/** The store the public route uses. */
export const newsletterStore: NewsletterStore = new PrismaNewsletterStore();

export interface NewsletterSubscriberList {
  subscribers: NewsletterSubscriber[];
  /** Every subscriber row, regardless of the page size below. */
  total: number;
  /** Rows whose status is "subscribed" (the rest are unsubscribed —
   * those are the only two statuses the module writes). */
  subscribedTotal: number;
}

/**
 * Admin list read (wave 7): newest subscribers first, with the true
 * totals for the admin page/API stats. Same delegate pattern as the
 * subscribe path — throws NewsletterStoreUnavailableError when the
 * generated delegate is absent, never returns invented rows.
 */
export async function listNewsletterSubscribers(take = 50): Promise<NewsletterSubscriberList> {
  const store = delegate();
  const [rows, total, subscribedTotal] = await Promise.all([
    store.findMany({ orderBy: { createdAt: "desc" }, take }),
    store.count(),
    store.count({ where: { status: "subscribed" } }),
  ]);
  return { subscribers: rows.map(rowToSubscriber), total, subscribedTotal };
}

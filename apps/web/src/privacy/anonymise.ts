/**
 * Account deletion = ANONYMISATION — ADV-29 (doc 22 acceptance:
 * "the deletion is audited and the account anonymised, orders
 * retained for accounting").
 *
 * Nothing financial is hard-deleted. Per-table decisions (audited
 * against the schema, FK by FK):
 *
 *   Customer            ANONYMISED in place: name → "মুছে ফেলা
 *                       গ্রাহক", phone → tombstone `deleted:<id>`
 *                       (unique, non-dialable — the row keeps its id
 *                       so every retained record below still joins),
 *                       email/googleId/birthDate → null, passwordHash
 *                       → null, tags cleared, deletedAt stamped.
 *   CustomerSession     DELETED (all rows — every device signed out).
 *   Address             DELETED (pure personal data, no other use).
 *   Cart / CartItem     DELETED (no accounting value).
 *   PushSubscription    DELETED (device endpoints are personal data;
 *                       a deleted account must stop receiving pushes).
 *   OtpCode             DELETED for the old phone (credential hygiene
 *                       — a live login code must not outlive the
 *                       account it could sign into).
 *   AbandonedCheckout   DELETED by old phone (marketing snapshot —
 *                       name/address JSON — with no accounting role).
 *   Review              KEPT, display identity scrubbed: authorName →
 *                       tombstone label, phone → tombstone value.
 *                       The rating/text are product history, and the
 *                       row's customerId now points at an anonymised
 *                       customer.
 *   ProductQuestion     KEPT, authorName scrubbed the same way.
 *   Order + items +     RETAINED UNTOUCHED. LIMIT (documented, by
 *   payments + history  design): Order rows carry their own PII
 *                       snapshots (customerName, customerPhone, full
 *                       delivery address, giftMessage). Those are
 *                       part of the financial/delivery record the
 *                       business must retain (accounting, VAT,
 *                       courier disputes), so anonymising the
 *                       Customer row does NOT scrub order history.
 *                       Amounts and snapshots stay exactly as
 *                       recorded — this service never rewrites them.
 *   SupportTicket(+msg) RETAINED under the anonymised customer (the
 *                       support/dispute record, same retention class
 *                       as orders; the display name resolves through
 *                       the now-anonymised Customer row).
 *   PointsLedgerEntry   RETAINED (financial-style ledger; integrity
 *                       of balances depends on history).
 *   CouponUsage         RETAINED (order-linked).
 *   DownloadReissueReq. RETAINED (staff workflow record on a grant).
 *   Reseller / B2bCust. NOT touched: separate business records keyed
 *                       by phone with their own logins and money owed
 *                       (wallet balances / credit dues). A customer
 *                       self-service deletion does not close a
 *                       business account — that is a staff process.
 *   NewsletterSubscriber If the account email was subscribed, the
 *                       row is flipped to unsubscribed (+timestamp)
 *                       and a consent "withdrawn" entry is logged —
 *                       a deleted account must not keep receiving
 *                       marketing.
 *
 * Proof of control is verified by the ROUTE before calling this
 * (password re-entry, OTP challenge, or email confirmation for
 * Google-placeholder accounts); this service trusts that gate and
 * records which proof was used.
 */
import { prisma } from "@advance-ecommerce/db";
import { writeAudit } from "@/lib/audit";
import {
  recordAccountDeletion,
  recordMarketingConsent,
  type DeletionLedgerEntry,
} from "./ledger";

export const TOMBSTONE_NAME = "মুছে ফেলা গ্রাহক";

export function tombstonePhone(customerId: string): string {
  return `deleted:${customerId}`;
}

export type DeletionProof = "password" | "otp" | "email-confirm";

export interface AnonymiseResult extends Omit<DeletionLedgerEntry, "at" | "auditLogWritten"> {
  auditLogWritten: boolean;
}

export async function anonymiseCustomerAccount(
  customerId: string,
  input: { proof: DeletionProof; ip?: string; userAgent?: string },
): Promise<AnonymiseResult | null> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (customer === null || customer.deletedAt !== null) return null;

  const oldPhone = customer.phone;
  const oldEmail = customer.email;
  const now = new Date();

  const counts = await prisma.$transaction(async (tx) => {
    const ordersRetained = await tx.order.count({ where: { customerId } });

    const reviews = await tx.review.updateMany({
      where: { customerId },
      data: { authorName: TOMBSTONE_NAME, phone: tombstonePhone(customerId) },
    });
    const questions = await tx.productQuestion.updateMany({
      where: { customerId },
      data: { authorName: TOMBSTONE_NAME },
    });

    const addresses = await tx.address.deleteMany({ where: { customerId } });
    const sessions = await tx.customerSession.deleteMany({ where: { customerId } });

    const carts = await tx.cart.findMany({
      where: { customerId },
      select: { id: true },
    });
    if (carts.length > 0) {
      await tx.cartItem.deleteMany({ where: { cartId: { in: carts.map((c) => c.id) } } });
      await tx.cart.deleteMany({ where: { id: { in: carts.map((c) => c.id) } } });
    }

    const pushes = await tx.pushSubscription.deleteMany({ where: { customerId } });
    const abandoned = await tx.abandonedCheckout.deleteMany({
      where: { customerPhone: oldPhone },
    });
    // Credential hygiene (uncounted in the summary): any outstanding
    // login OTP for the old phone dies with the account.
    await tx.otpCode.deleteMany({ where: { phone: oldPhone } });

    let newsletterUnsubscribed = false;
    if (oldEmail !== null) {
      const flipped = await tx.newsletterSubscriber.updateMany({
        where: { email: oldEmail, status: "subscribed" },
        data: { status: "unsubscribed", unsubscribedAt: now },
      });
      newsletterUnsubscribed = flipped.count > 0;
    }

    await tx.customer.update({
      where: { id: customerId },
      data: {
        name: TOMBSTONE_NAME,
        phone: tombstonePhone(customerId),
        email: null,
        passwordHash: null,
        googleId: null,
        birthDate: null,
        tags: [],
        blacklistReason: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
        deletedAt: now,
      },
    });

    return {
      ordersRetained,
      reviewsAnonymised: reviews.count,
      questionsAnonymised: questions.count,
      addressesDeleted: addresses.count,
      sessionsDeleted: sessions.count,
      cartsDeleted: carts.length,
      pushSubscriptionsDeleted: pushes.count,
      abandonedCheckoutsDeleted: abandoned.count,
      newsletterUnsubscribed,
    };
  });

  // Durable recording, after the transaction commits: AuditLog
  // attempt (actor null — the actor FK is staff-only, see ledger.ts)
  // + the privacy.deletions ledger (the guaranteed record) + the
  // consent withdrawal when marketing consent actually flipped.
  const auditId = await writeAudit({
    actorId: null,
    action: "customers.account_delete",
    entityType: "Customer",
    entityId: customerId,
    afterJson: { ...counts, proof: input.proof, anonymised: true },
    ip: input.ip,
    userAgent: input.userAgent,
  });

  const entry: DeletionLedgerEntry = {
    at: now.toISOString(),
    customerId,
    proof: input.proof,
    ...counts,
    auditLogWritten: auditId !== null,
  };
  try {
    await recordAccountDeletion(entry);
  } catch (error) {
    console.error("privacy.deletions ledger write failed:", error);
  }
  if (counts.newsletterUnsubscribed) {
    try {
      await recordMarketingConsent({
        action: "withdrawn",
        source: "account-deletion",
        email: oldEmail,
        phone: oldPhone,
        customerId,
      });
    } catch (error) {
      console.error("privacy.consent_log write failed (deletion):", error);
    }
  }

  return { ...entry, auditLogWritten: entry.auditLogWritten };
}

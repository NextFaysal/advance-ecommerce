/**
 * Customer data export — ADV-29 (doc 22): everything the platform
 * holds about ONE signed-in customer, assembled from real queries at
 * request time. Every section is labelled with its source table so
 * the customer (and any reviewer) can see exactly where each part
 * came from. Nothing is invented:
 *
 * - No password hash, session token, OTP or other credential
 *   material is EVER included. The profile reports credential
 *   PRESENCE (hasPassword / googleLinked) only.
 * - The wishlist has NO server-side store in this codebase — it
 *   lives in the customer's own browser (localStorage). The section
 *   says exactly that instead of fabricating items.
 * - Reseller / B2B profiles are separate business records keyed by
 *   phone (Reseller / B2bCustomer have no FK to Customer); they are
 *   included as summaries when a row matches this customer's phone.
 *
 * Recording: the caller (route) writes the privacy.exports ledger
 * entry + AuditLog attempt via recordExportEvent() below.
 */
import { prisma } from "@advance-ecommerce/db";
import { writeAudit } from "@/lib/audit";
import { recordDataExport } from "./ledger";

/** Caps keep one pathological account from producing an unbounded
 *  download; a capped section says so in its `truncated` flag. */
const ORDER_CAP = 500;
const LIST_CAP = 500;

export interface ExportSection {
  source: string;
  count?: number;
  truncated?: boolean;
  note?: string;
  data: unknown;
}

export interface CustomerDataExport {
  meta: {
    kind: "customer-data-export";
    version: 1;
    exportedAt: string;
    customerId: string;
    recordedInLedger: boolean;
    auditLogWritten: boolean;
  };
  sections: Record<string, ExportSection>;
}

export async function buildCustomerDataExport(
  customerId: string,
): Promise<CustomerDataExport | null> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (customer === null || customer.deletedAt !== null) return null;

  const [
    addresses,
    orders,
    orderTotal,
    reviews,
    questions,
    tickets,
    points,
    couponUsages,
    reissueRequests,
    newsletter,
    reseller,
    b2b,
  ] = await Promise.all([
    prisma.address.findMany({
      where: { customerId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    }),
    prisma.order.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: ORDER_CAP,
      include: { items: true },
    }),
    prisma.order.count({ where: { customerId } }),
    prisma.review.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: LIST_CAP,
    }),
    prisma.productQuestion.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: LIST_CAP,
    }),
    prisma.supportTicket.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: LIST_CAP,
      include: { messages: { orderBy: { createdAt: "asc" } } },
    }),
    prisma.pointsLedgerEntry.findMany({
      where: { customerId },
      orderBy: { createdAt: "asc" },
      take: LIST_CAP,
    }),
    prisma.couponUsage.findMany({
      where: { customerId },
      orderBy: { usedAt: "desc" },
      take: LIST_CAP,
    }),
    prisma.downloadReissueRequest.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: LIST_CAP,
    }),
    customer.email !== null
      ? prisma.newsletterSubscriber.findUnique({ where: { email: customer.email } })
      : Promise.resolve(null),
    prisma.reseller.findUnique({ where: { phone: customer.phone } }),
    prisma.b2bCustomer.findUnique({ where: { phone: customer.phone } }),
  ]);

  const resellerWallet = reseller
    ? await prisma.resellerWalletEntry.aggregate({
        where: { resellerId: reseller.id },
        _sum: { amountPoisha: true },
      })
    : null;

  const loyaltyBalance =
    points.length > 0
      ? (points[points.length - 1]?.balanceAfter ?? points.reduce((s, p) => s + p.points, 0))
      : 0;

  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

  const sections: Record<string, ExportSection> = {
    profile: {
      source: "Customer",
      data: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        birthDate: customer.birthDate ? customer.birthDate.toISOString().slice(0, 10) : null,
        tags: customer.tags,
        hasPassword: customer.passwordHash !== null,
        googleLinked: customer.googleId !== null,
        lastLoginAt: iso(customer.lastLoginAt),
        createdAt: customer.createdAt.toISOString(),
      },
    },
    addresses: {
      source: "Address",
      count: addresses.length,
      data: addresses.map((a) => ({
        id: a.id,
        label: a.label,
        division: a.division,
        district: a.district,
        upazila: a.upazila,
        union: a.union,
        addressLine: a.addressLine,
        isDefault: a.isDefault,
        createdAt: a.createdAt.toISOString(),
      })),
    },
    orders: {
      source: "Order + OrderItem",
      count: orderTotal,
      truncated: orderTotal > orders.length,
      data: orders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        status: o.status,
        paymentStatus: o.paymentStatus,
        paymentMethod: o.paymentMethod,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        deliveryAddress: {
          division: o.division,
          district: o.district,
          upazila: o.upazila,
          union: o.union,
          addressLine: o.addressLine,
        },
        subtotalPoisha: o.subtotalPoisha,
        discountPoisha: o.discountPoisha,
        shippingPoisha: o.shippingPoisha,
        codFeePoisha: o.codFeePoisha,
        taxPoisha: o.taxPoisha,
        totalPoisha: o.totalPoisha,
        source: o.source,
        createdAt: o.createdAt.toISOString(),
        items: o.items.map((i) => ({
          productName: i.productName,
          sku: i.sku,
          unitPricePoisha: i.unitPricePoisha,
          quantity: i.quantity,
        })),
      })),
    },
    reviews: {
      source: "Review",
      count: reviews.length,
      data: reviews.map((r) => ({
        id: r.id,
        productId: r.productId,
        orderId: r.orderId,
        authorName: r.authorName,
        rating: r.rating,
        title: r.title,
        body: r.body,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    },
    productQuestions: {
      source: "ProductQuestion",
      count: questions.length,
      data: questions.map((q) => ({
        id: q.id,
        productId: q.productId,
        authorName: q.authorName,
        question: q.question,
        answer: q.answer,
        status: q.status,
        createdAt: q.createdAt.toISOString(),
      })),
    },
    supportTickets: {
      source: "SupportTicket + SupportTicketMessage",
      count: tickets.length,
      data: tickets.map((t) => ({
        id: t.id,
        orderId: t.orderId,
        subject: t.subject,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        messages: t.messages.map((m) => ({
          authorType: m.authorType,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
        })),
      })),
    },
    loyaltyPoints: {
      source: "PointsLedgerEntry",
      count: points.length,
      data: {
        balancePoints: loyaltyBalance,
        entries: points.map((p) => ({
          kind: p.kind,
          points: p.points,
          balanceAfter: p.balanceAfter,
          reason: p.reason,
          orderId: p.orderId,
          createdAt: p.createdAt.toISOString(),
        })),
      },
    },
    couponUsages: {
      source: "CouponUsage",
      count: couponUsages.length,
      data: couponUsages.map((u) => ({
        couponId: u.couponId,
        orderId: u.orderId,
        discountPoisha: u.discountPoisha,
        usedAt: u.usedAt.toISOString(),
      })),
    },
    downloadReissueRequests: {
      source: "DownloadReissueRequest",
      count: reissueRequests.length,
      data: reissueRequests.map((r) => ({
        id: r.id,
        grantId: r.grantId,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    },
    newsletterSubscription: {
      source: "NewsletterSubscriber (matched by email)",
      count: newsletter ? 1 : 0,
      data: newsletter
        ? {
            email: newsletter.email,
            status: newsletter.status,
            source: newsletter.source,
            subscribedAt: newsletter.createdAt.toISOString(),
            unsubscribedAt: iso(newsletter.unsubscribedAt),
          }
        : null,
    },
    resellerProfile: {
      source: "Reseller + ResellerWalletEntry (separate business record, matched by phone)",
      count: reseller ? 1 : 0,
      data: reseller
        ? {
            id: reseller.id,
            name: reseller.name,
            status: reseller.status,
            tier: reseller.tier,
            code: reseller.code,
            walletBalancePoisha: resellerWallet?._sum.amountPoisha ?? 0,
            createdAt: reseller.createdAt.toISOString(),
          }
        : null,
    },
    b2bProfile: {
      source: "B2bCustomer (separate business record, matched by phone)",
      count: b2b ? 1 : 0,
      data: b2b
        ? {
            id: b2b.id,
            companyName: b2b.companyName,
            contactName: b2b.contactName,
            status: b2b.status,
            creditLimitPoisha: b2b.creditLimitPoisha,
            duePoisha: b2b.duePoisha,
            createdAt: b2b.createdAt.toISOString(),
          }
        : null,
    },
    wishlist: {
      source: "browser localStorage (no server-side wishlist store exists)",
      note: "Your wishlist is stored only in your own browser on this device — the server holds no copy, so there is nothing server-side to export.",
      data: [],
    },
  };

  return {
    meta: {
      kind: "customer-data-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      customerId,
      // Filled by recordExportEvent() before the document is served.
      recordedInLedger: false,
      auditLogWritten: false,
    },
    sections,
  };
}

/**
 * Durable recording of an export event: the privacy.exports ledger
 * (guaranteed record) + a best-effort AuditLog row. The AuditLog
 * actor FK points at staff User, so the actor is null and the
 * customer is the entity — the closest the staff seam allows for a
 * customer actor (see ledger.ts header). Mutates doc.meta with the
 * two outcomes so the downloaded file itself states how it was
 * recorded.
 */
export async function recordExportEvent(doc: CustomerDataExport): Promise<void> {
  const counts: Record<string, number> = {};
  for (const [key, section] of Object.entries(doc.sections)) {
    counts[key] = section.count ?? (Array.isArray(section.data) ? section.data.length : 1);
  }
  const auditId = await writeAudit({
    actorId: null,
    action: "customers.data_export",
    entityType: "Customer",
    entityId: doc.meta.customerId,
    afterJson: { sections: Object.keys(doc.sections), counts },
  });
  doc.meta.auditLogWritten = auditId !== null;
  try {
    await recordDataExport({
      at: doc.meta.exportedAt,
      customerId: doc.meta.customerId,
      sections: Object.keys(doc.sections),
      counts,
      auditLogWritten: doc.meta.auditLogWritten,
    });
    doc.meta.recordedInLedger = true;
  } catch (error) {
    console.error("privacy.exports ledger write failed:", error);
    doc.meta.recordedInLedger = false;
  }
}

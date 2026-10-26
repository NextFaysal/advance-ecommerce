/**
 * Vendor portal dashboard — ADV-13 read model. Server-only.
 *
 * Everything here is the vendor's OWN data, computed from real rows:
 *   - products: VendorProduct rows; stock is the linked
 *     ProductVariant.stock "as recorded" (null when the listing is
 *     free-standing — VendorProduct has no stock column of its own);
 *   - orders: orders whose items include one of the vendor's linked
 *     variants, with the vendor's own line totals from OrderItem
 *     rows; the customer's phone is MASKED — a full customer number
 *     never leaves through the portal;
 *   - earnings: VendorCommissionLine rows (written exactly-once by
 *     the delivered-order hook) + VendorRefund chargebacks;
 *   - payout summary: the same arithmetic as summarizePayout()
 *     (src/vendors/service.ts) — gross − commission − refunds,
 *     never below zero — computed inline because the service
 *     function asserts the module.multi_vendor flag, while this
 *     portal is gated by its own module.vendor_portal flag.
 *
 * PAYOUT RECORDS (schema wave 2): VendorPayoutRequest now exists.
 * The summary reports the outstanding net payable MINUS what payout
 * requests have already settled (PAID) or hold (PENDING + APPROVED)
 * — see payouts.ts for the model. PAID still means "a staff member
 * recorded an external payment"; no money moves through the system.
 *
 * DOCUMENTS (schema wave 2): VendorDocument rows (staff-recorded
 * metadata) are listed for the KYC card. Self-upload remains off:
 * storage is unconfigured and no upload endpoint exists yet.
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "../checkout/validation";
import { getVendorKyc } from "./kyc-store";
import type { VendorKycRecord } from "./kyc";
import {
  computeVendorPayoutBalances,
  type VendorPayoutRequest,
} from "./payouts";
import { listVendorPayoutRequests } from "./payout-store";
import { listVendorDocuments, type VendorDocumentView } from "./documents";

export interface VendorPortalProduct {
  id: string;
  productName: string;
  sku: string;
  pricePoisha: number;
  approval: string;
  rejectionReason: string | null;
  variantId: string | null;
  /** Linked variant stock as recorded; null = not tracked here. */
  stock: number | null;
}

export interface VendorPortalOrderLine {
  productName: string;
  sku: string;
  quantity: number;
  unitPricePoisha: number;
  lineTotalPoisha: number;
}

export interface VendorPortalOrder {
  orderId: string;
  orderNo: string;
  status: string;
  createdAt: string;
  customerName: string;
  customerPhoneMasked: string;
  lines: VendorPortalOrderLine[];
  /** The vendor's gross for this order (their items only). */
  myGrossPoisha: number;
  /** CREDITED when a commission line exists for (order, vendor);
   *  AWAITING_DELIVERY while the order is undelivered; NOT_CREDITED
   *  when a delivered order earned no line (e.g. the listing was not
   *  APPROVED at delivery time — the hook's own rule). */
  commissionStatus: "CREDITED" | "AWAITING_DELIVERY" | "NOT_CREDITED";
  commissionPoisha: number | null;
  vendorEarningPoisha: number | null;
}

export interface VendorPortalLedgerLine {
  orderId: string;
  orderNo: string | null;
  grossPoisha: number;
  commissionBps: number;
  commissionPoisha: number;
  vendorEarningPoisha: number;
  createdAt: string;
}

export interface VendorPortalRefund {
  id: string;
  orderId: string | null;
  amountPoisha: number;
  reason: string;
  createdAt: string;
}

export interface VendorPortalPayoutSummary {
  orderCount: number;
  grossPoisha: number;
  commissionPoisha: number;
  refundsPoisha: number;
  /** Outstanding payable to the vendor (never below zero). */
  netPayablePoisha: number;
  /** Payout requests exist as records (schema wave 2). */
  hasPayoutRecords: boolean;
  /** Σ PAID requests — staff-recorded external payments. */
  paidOutPoisha: number;
  /** Σ PENDING + APPROVED requests — committed, not yet paid. */
  heldPoisha: number;
  /** netPayable − paidOut − held: what a new request may draw on. */
  availablePoisha: number;
}

export interface VendorDocumentStatus {
  available: boolean;
  code: "STORAGE_NOT_CONFIGURED" | "UPLOAD_ENDPOINT_PENDING";
  reasonBn: string;
}

export interface VendorPortalDashboard {
  vendorId: string;
  shopName: string;
  ownerName: string;
  phoneMasked: string;
  email: string | null;
  status: string;
  commissionBps: number;
  createdAt: string;
  kyc: VendorKycRecord;
  documentUpload: VendorDocumentStatus;
  products: VendorPortalProduct[];
  orders: VendorPortalOrder[];
  ledger: VendorPortalLedgerLine[];
  refunds: VendorPortalRefund[];
  payout: VendorPortalPayoutSummary;
  payoutRequests: VendorPayoutRequest[];
  documents: VendorDocumentView[];
}

/**
 * KYC document upload availability — the reviews/photo.ts probe
 * pattern. Self-upload stays disabled for two distinct reasons,
 * reported distinctly: storage credentials first; even with storage,
 * no upload ENDPOINT exists yet — documents are recorded by staff
 * (VendorDocument rows, schema wave 2) and shown on the KYC card.
 */
export async function getVendorDocumentStatus(): Promise<VendorDocumentStatus> {
  const { isStorageConfigured } = await import("../catalog/media-server");
  const storageReady = await isStorageConfigured().catch(() => false);
  if (!storageReady) {
    return {
      available: false,
      code: "STORAGE_NOT_CONFIGURED",
      reasonBn:
        "কাগজপত্র নিজে আপলোড করার ব্যবস্থা এখনো চালু হয়নি — ফাইল রাখার স্টোরেজ (R2/S3) এখনো কনফিগার করা হয়নি। কাগজপত্র স্টোরে জমা দিন; স্টাফ রেকর্ড করে নিচে তালিকায় দেখিয়ে দেবেন।",
    };
  }
  return {
    available: false,
    code: "UPLOAD_ENDPOINT_PENDING",
    reasonBn:
      "কাগজপত্র নিজে আপলোড করার ব্যবস্থা এখনো তৈরি হয়নি — স্টোরেজ থাকলেও আপলোডের পথ এখনো বানানো হয়নি। কাগজপত্র স্টোরে জমা দিন; স্টাফ রেকর্ড করে নিচে তালিকায় দেখিয়ে দেবেন।",
  };
}

export async function buildVendorPortalDashboard(
  vendorId: string,
): Promise<VendorPortalDashboard | null> {
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, deletedAt: null },
  });
  if (vendor === null) return null;

  const productRows = await prisma.vendorProduct.findMany({
    where: { vendorId, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const variantIds = [
    ...new Set(productRows.map((p) => p.variantId).filter((v): v is string => v !== null)),
  ];
  const variantStocks = new Map<string, number>();
  if (variantIds.length > 0) {
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: { id: true, stock: true },
    });
    for (const v of variants) variantStocks.set(v.id, v.stock);
  }
  const products: VendorPortalProduct[] = productRows.map((p) => ({
    id: p.id,
    productName: p.productName,
    sku: p.sku,
    pricePoisha: p.pricePoisha,
    approval: p.approval,
    rejectionReason: p.rejectionReason,
    variantId: p.variantId,
    stock: p.variantId ? (variantStocks.get(p.variantId) ?? null) : null,
  }));

  /* Commission ledger (the earnings truth) + per-order lookup. */
  const lineRows = await prisma.vendorCommissionLine.findMany({
    where: { vendorId },
    orderBy: { createdAt: "desc" },
  });
  const lineOrderIds = [...new Set(lineRows.map((l) => l.orderId))];
  const orderNoById = new Map<string, string>();
  if (lineOrderIds.length > 0) {
    const orders = await prisma.order.findMany({
      where: { id: { in: lineOrderIds } },
      select: { id: true, orderNo: true },
    });
    for (const o of orders) orderNoById.set(o.id, o.orderNo);
  }
  const lineByOrder = new Map(lineRows.map((l) => [l.orderId, l]));
  const ledger: VendorPortalLedgerLine[] = lineRows.map((l) => ({
    orderId: l.orderId,
    orderNo: orderNoById.get(l.orderId) ?? null,
    grossPoisha: l.grossPoisha,
    commissionBps: l.commissionBps,
    commissionPoisha: l.commissionPoisha,
    vendorEarningPoisha: l.vendorEarningPoisha,
    createdAt: l.createdAt.toISOString(),
  }));

  /* Orders containing this vendor's products (their lines only). */
  let orders: VendorPortalOrder[] = [];
  if (variantIds.length > 0) {
    const items = await prisma.orderItem.findMany({
      where: { variantId: { in: variantIds } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            status: true,
            customerName: true,
            customerPhone: true,
            createdAt: true,
          },
        },
      },
    });
    const grouped = new Map<string, VendorPortalOrder>();
    for (const item of items) {
      let entry = grouped.get(item.orderId);
      if (entry === undefined) {
        const line = lineByOrder.get(item.orderId);
        entry = {
          orderId: item.orderId,
          orderNo: item.order.orderNo,
          status: item.order.status,
          createdAt: item.order.createdAt.toISOString(),
          customerName: item.order.customerName,
          customerPhoneMasked: maskPhone(item.order.customerPhone),
          lines: [],
          myGrossPoisha: 0,
          commissionStatus:
            line !== undefined
              ? "CREDITED"
              : item.order.status === "DELIVERED"
                ? "NOT_CREDITED"
                : "AWAITING_DELIVERY",
          commissionPoisha: line?.commissionPoisha ?? null,
          vendorEarningPoisha: line?.vendorEarningPoisha ?? null,
        };
        grouped.set(item.orderId, entry);
      }
      const lineTotal = item.unitPricePoisha * item.quantity;
      entry.lines.push({
        productName: item.productName,
        sku: item.sku,
        quantity: item.quantity,
        unitPricePoisha: item.unitPricePoisha,
        lineTotalPoisha: lineTotal,
      });
      entry.myGrossPoisha += lineTotal;
    }
    orders = [...grouped.values()].slice(0, 50);
  }

  const refundRows = await prisma.vendorRefund.findMany({
    where: { vendorId },
    orderBy: { createdAt: "desc" },
  });
  const refunds: VendorPortalRefund[] = refundRows.map((r) => ({
    id: r.id,
    orderId: r.orderId,
    amountPoisha: r.amountPoisha,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
  }));

  const grossPoisha = lineRows.reduce((s, l) => s + l.grossPoisha, 0);
  const commissionPoisha = lineRows.reduce((s, l) => s + l.commissionPoisha, 0);
  const refundsPoisha = refundRows.reduce((s, r) => s + r.amountPoisha, 0);

  const [kyc, documentUpload, payoutRequests, documents] = await Promise.all([
    getVendorKyc(vendorId),
    getVendorDocumentStatus(),
    listVendorPayoutRequests(vendorId),
    listVendorDocuments(vendorId),
  ]);

  const netPayablePoisha = Math.max(0, grossPoisha - commissionPoisha - refundsPoisha);
  const balances = computeVendorPayoutBalances(netPayablePoisha, payoutRequests);

  return {
    vendorId: vendor.id,
    shopName: vendor.name,
    ownerName: vendor.ownerName ?? "",
    phoneMasked: maskPhone(vendor.phone),
    email: vendor.email,
    status: vendor.status,
    commissionBps: vendor.commissionBps,
    createdAt: vendor.createdAt.toISOString(),
    kyc,
    documentUpload,
    products,
    orders,
    ledger,
    refunds,
    payout: {
      orderCount: lineRows.length,
      grossPoisha,
      commissionPoisha,
      refundsPoisha,
      netPayablePoisha,
      hasPayoutRecords: true,
      paidOutPoisha: balances.paidOutPoisha,
      heldPoisha: balances.heldPoisha,
      availablePoisha: balances.availablePoisha,
    },
    payoutRequests,
    documents,
  };
}

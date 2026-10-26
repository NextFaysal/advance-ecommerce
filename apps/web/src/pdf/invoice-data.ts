/**
 * Invoice read model for the PDF invoice — ADV-29 (doc 22).
 *
 * Built from EXACTLY the read models the screens use, so the PDF can
 * never disagree with them:
 *   - the order itself via src/orders/repository.getOrderByIdOrNo
 *     (the admin detail API's loader — items are purchase-time
 *     snapshots, totals are the persisted Order columns);
 *   - paid money via src/orders/advance.getOrderAdvanceView
 *     (data.advance on the detail payload, the print centre's paid
 *     source);
 *   - the money split via the print centre / MoneyBreakdown
 *     arithmetic (src/orders/components/MoneyBreakdown): subtotal −
 *     discount + shipping + residual = total, the residual labelled
 *     "COD fee & other charges".
 *
 * Wave-41 follow-up closed here: the print centre folds a gift-card
 * redemption into that residual (mislabelled). The PDF decomposes
 * it from the RECORDED ledger instead — GiftCardTransaction rows
 * for this order (REDEEM negative, REFUND_RESTORE positive) — and
 * prints a real gift-card line, so gross total − gift card =
 * Order.totalPoisha exactly. The discount line is the recorded
 * Order.discountPoisha (coupon + membership-tier combined, exactly
 * as persisted by the create pipeline — the split lives in the
 * create response, not on the order row).
 *
 * Store identity comes from Settings (general.store_name /
 * general.store_address / general.store_bin — the same keys the
 * Mushak 6.3 print uses). Empty values stay empty: no invented
 * brand, address or BIN is ever printed.
 */
import { prisma } from "@advance-ecommerce/db";
import { getOrderByIdOrNo } from "@/orders/repository";
import { getOrderAdvanceView } from "@/orders/advance";
import { getSetting } from "@/lib/settings";
import { resolveInvoiceTexts } from "@/templates/overrides";
import { formatBdt } from "@/checkout/pricing";
import { lineTotalPoisha, qtyNumber } from "@/lib/quantity";
import { dhakaYmdOf } from "@/lib/dhaka-date";
import { RENTAL_DEPOSIT_LABEL_BN, RENTAL_DEPOSIT_LABEL_EN } from "@/rental/selection";
import { POD_PRINT_FEE_LABEL_BN, POD_PRINT_FEE_LABEL_EN } from "@/pod/selection";
import { getOrderPodView } from "@/pod/customisation";

export interface InvoiceMoneyRow {
  labelBn: string;
  labelEn: string;
  /** Signed poisha (the discount / gift-card rows are negative). */
  poisha: number;
  emphasis?: "total" | "due";
}

export interface InvoiceData {
  orderId: string;
  orderNo: string;
  status: string;
  paymentStatus: string;
  paymentMethodLabel: string;
  createdAtLabel: string;
  storeName: string;
  storeAddress: string;
  storeBin: string;
  customerName: string;
  /** Already policy-applied by the caller (admin: phoneForViewer,
   *  customer: masked own number) — this module never re-decides. */
  customerPhone: string;
  addressText: string;
  giftMessage: string | null;
  items: {
    productName: string;
    sku: string;
    quantity: number;
    unitPricePoisha: number;
    lineTotalPoisha: number;
  }[];
  moneyRows: InvoiceMoneyRow[];
  totalPoisha: number;
  /** Merchant template copy (ADV-29 — src/templates/overrides.ts),
   *  resolved at build time. Null = the slot is unset: headerNote
   *  and termsLine print nothing; footerNote falls back to the
   *  built-in default in the renderers. */
  headerNote: string | null;
  footerNote: string | null;
  termsLine: string | null;
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod: "Cash on Delivery (COD)",
  bkash: "bKash",
  nagad: "Nagad",
  rocket: "Rocket",
  card: "Card",
  sslcommerz: "SSLCommerz",
  aamarpay: "AamarPay",
  shurjopay: "ShurjoPay",
};

function dhakaDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export interface InvoiceMoneyInput {
  subtotalPoisha: number;
  /** null = the payload predates the persisted split (print-centre
   *  fallback: ONE net line, exactly like the print view). */
  discountPoisha: number | null;
  shippingPoisha: number | null;
  totalPoisha: number;
  /** Net gift-card coverage from the ledger (>= 0). */
  giftCardNetPoisha: number;
  giftCardLast4: string | null;
  paidPoisha: number;
  /** Rental security deposit frozen on the order's RentalBooking
   *  (ADV-23 vertical 3) — already inside totalPoisha; rendered as
   *  its own row so it never hides inside the "COD fee & other
   *  charges" residual. 0 / omitted for non-rental orders. */
  rentalDepositPoisha?: number;
  /** Print-on-demand print fee frozen on the order's create-time
   *  note (ADV-23 vertical 5) — already inside totalPoisha;
   *  rendered as its own row like the deposit. 0 / omitted for
   *  non-POD orders. */
  printFeePoisha?: number;
}

/** Pure row builder — the print centre's arithmetic, with the
 *  gift-card tender decomposed out of the residual. */
export function computeInvoiceMoneyRows(input: InvoiceMoneyInput): InvoiceMoneyRow[] {
  const rows: InvoiceMoneyRow[] = [
    { labelBn: "সাবটোটাল (পণ্য)", labelEn: "Subtotal", poisha: input.subtotalPoisha },
  ];
  const grossPoisha = input.totalPoisha + input.giftCardNetPoisha;
  if (input.discountPoisha === null || input.shippingPoisha === null) {
    const net = grossPoisha - input.subtotalPoisha;
    if (net !== 0) {
      rows.push({ labelBn: "ডেলিভারি ও সমন্বয় (নেট)", labelEn: "Delivery & adjustments (net)", poisha: net });
    }
  } else {
    if (input.discountPoisha > 0) {
      rows.push({ labelBn: "ছাড়", labelEn: "Discount", poisha: -input.discountPoisha });
    }
    rows.push({ labelBn: "ডেলিভারি চার্জ", labelEn: "Delivery charge", poisha: input.shippingPoisha });
    // ADV-23 rental deposit: its own row (the figure frozen on the
    // RentalBooking), taken OUT of the residual below so a
    // refundable deposit is never mislabelled as a fee.
    const rentalDepositPoisha = input.rentalDepositPoisha ?? 0;
    if (rentalDepositPoisha > 0) {
      rows.push({
        labelBn: RENTAL_DEPOSIT_LABEL_BN,
        labelEn: RENTAL_DEPOSIT_LABEL_EN,
        poisha: rentalDepositPoisha,
      });
    }
    // ADV-23 vertical 5 print fee: its own row (the figure frozen
    // on the order note), taken OUT of the residual below so a
    // print charge is never mislabelled as a fee either.
    const printFeePoisha = input.printFeePoisha ?? 0;
    if (printFeePoisha > 0) {
      rows.push({
        labelBn: POD_PRINT_FEE_LABEL_BN,
        labelEn: POD_PRINT_FEE_LABEL_EN,
        poisha: printFeePoisha,
      });
    }
    const residual =
      grossPoisha -
      (input.subtotalPoisha - input.discountPoisha + input.shippingPoisha + rentalDepositPoisha + printFeePoisha);
    if (residual !== 0) {
      rows.push({ labelBn: "সিওডি ফি ও অন্যান্য চার্জ", labelEn: "COD fee & other charges", poisha: residual });
    }
  }
  if (input.giftCardNetPoisha > 0) {
    rows.push({
      labelBn: "মোট (গিফট কার্ডের আগে)",
      labelEn: "Total before gift card",
      poisha: grossPoisha,
      emphasis: "total",
    });
    rows.push({
      labelBn: `গিফট কার্ড (…${input.giftCardLast4 ?? "????"})`,
      labelEn: "Gift card",
      poisha: -input.giftCardNetPoisha,
    });
  }
  rows.push({ labelBn: "সর্বমোট", labelEn: "Total", poisha: input.totalPoisha, emphasis: "total" });
  rows.push({ labelBn: "পরিশোধিত", labelEn: "Paid", poisha: input.paidPoisha });
  const due = input.totalPoisha - input.paidPoisha;
  if (due > 0) {
    rows.push({ labelBn: "বকেয়া", labelEn: "Due", poisha: due, emphasis: "due" });
  }
  return rows;
}

/** Net gift-card coverage for an order from the recorded ledger:
 *  −Σ(REDEEM + REFUND_RESTORE amounts) — REDEEM is stored negative,
 *  a restore positive, so a fully restored card nets to 0. */
export async function getOrderGiftCardCoverage(
  orderId: string,
): Promise<{ netPoisha: number; codeLast4: string | null }> {
  const txns = await prisma.giftCardTransaction.findMany({
    where: { orderId, kind: { in: ["REDEEM", "REFUND_RESTORE"] } },
    orderBy: { createdAt: "asc" },
    select: { amountPoisha: true, kind: true, giftCard: { select: { codeLast4: true } } },
  });
  let net = 0;
  let last4: string | null = null;
  for (const t of txns) {
    net -= t.amountPoisha;
    if (t.kind === "REDEEM") last4 = t.giftCard.codeLast4;
  }
  return { netPoisha: Math.max(0, net), codeLast4: last4 };
}

/** The order's rental view (ADV-23 vertical 3): the RentalBooking
 *  row's frozen facts, or null when the order is not a rental. The
 *  admin order GET attaches this as data.rental (the giftCard
 *  precedent) so the detail screen + print centre decompose the
 *  deposit out of their residuals exactly like this module does. */
export async function getOrderRentalView(
  orderId: string,
): Promise<{
  depositPoisha: number;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
} | null> {
  const row = await prisma.rentalBooking.findUnique({
    where: { orderId },
    select: { depositPoisha: true, startDate: true, endDate: true, days: true, status: true },
  });
  if (!row) return null;
  return {
    depositPoisha: row.depositPoisha,
    startDate: dhakaYmdOf(row.startDate),
    endDate: dhakaYmdOf(row.endDate),
    days: row.days,
    status: row.status,
  };
}

/**
 * Build the invoice data for one order. `customerPhoneDisplay` is
 * the phone string the CALLER's policy allows on paper (admin route:
 * phoneForViewer; customer route: the masked own number) — the same
 * policy the print centre inherits from the detail API.
 * Returns null when the order does not exist.
 */
export async function buildInvoiceData(
  idOrNo: string,
  customerPhoneDisplay: string,
): Promise<InvoiceData | null> {
  const order = await getOrderByIdOrNo(idOrNo);
  if (!order) return null;
  const [advance, giftCard, rental, pod, storeName, storeAddress, storeBin, templateTexts] =
    await Promise.all([
      getOrderAdvanceView(order.id),
      getOrderGiftCardCoverage(order.id),
      getOrderRentalView(order.id),
      getOrderPodView(order.id),
      getSetting("general.store_name"),
      getSetting("general.store_address"),
      getSetting("general.store_bin"),
      resolveInvoiceTexts(),
    ]);
  const subtotalPoisha = order.items.reduce((sum, i) => sum + lineTotalPoisha(i.unitPricePoisha, i.quantity), 0);
  const a = order.address;
  return {
    orderId: order.id,
    orderNo: order.orderNo,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethodLabel: PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod,
    createdAtLabel: dhakaDateTime(order.createdAt),
    storeName: (storeName ?? "").trim(),
    storeAddress: (storeAddress ?? "").trim(),
    storeBin: (storeBin ?? "").trim(),
    customerName: order.customerName,
    customerPhone: customerPhoneDisplay,
    addressText: [a.addressLine, a.union, a.upazila, a.district, a.division].filter(Boolean).join(", "),
    giftMessage: order.giftMessage ?? null,
    items: order.items.map((i) => ({
      productName: i.productName,
      sku: i.sku,
      quantity: qtyNumber(i.quantity),
      unitPricePoisha: i.unitPricePoisha,
      lineTotalPoisha: lineTotalPoisha(i.unitPricePoisha, i.quantity),
    })),
    moneyRows: computeInvoiceMoneyRows({
      subtotalPoisha,
      discountPoisha: typeof order.discountPoisha === "number" ? order.discountPoisha : null,
      shippingPoisha: typeof order.shippingPoisha === "number" ? order.shippingPoisha : null,
      totalPoisha: order.totalPoisha,
      giftCardNetPoisha: giftCard.netPoisha,
      giftCardLast4: giftCard.codeLast4,
      paidPoisha: advance?.paidPoisha ?? 0,
      rentalDepositPoisha: rental?.depositPoisha ?? 0,
      printFeePoisha: pod?.feePoisha ?? 0,
    }),
    totalPoisha: order.totalPoisha,
    headerNote: templateTexts.headerNote,
    footerNote: templateTexts.footerNote,
    termsLine: templateTexts.termsLine,
  };
}

export { formatBdt };

/**
 * Mushak 6.3 (চালানপত্র) — ADV-11 (doc 22): the Bangladeshi VAT tax
 * invoice data builder. Pure: takes an order snapshot + seller name
 * and returns the document the print page renders.
 *
 * HONESTY RULES (the platform convention):
 *  - The VAT figures come ONLY from the order's RECORDED split
 *    (Order.vatPoisha / vatRateBps, written at create time when a
 *    rate was configured). When no split was recorded the document
 *    still renders as a challan, but every VAT cell is null (the page
 *    prints "—") and `vatRecorded` is false with an explanatory note
 *    — a split is never reconstructed after the fact.
 *  - Per-line VAT is the order's recorded VAT allocated pro-rata by
 *    line value (largest-remainder, so the lines sum EXACTLY to the
 *    recorded figure) and the document says so. The official form's
 *    per-line VAT is normally computed line-by-line; here the
 *    system of record holds VAT at order level only.
 *  - Seller address and BIN, and the buyer's BIN, have NO Settings
 *    keys or schema fields anywhere in the system today — they are
 *    returned as null and the page renders blank fill-in lines.
 *    Nothing is invented.
 *  - Supplementary duty (সম্পূরক শুল্ক) is not tracked anywhere in
 *    the order model → null per line (printed "—").
 */

export interface MushakOrderInput {
  orderNo: string;
  /** ISO timestamp of the order (Asia/Dhaka date/time are derived). */
  createdAtIso: string;
  customerName: string;
  customerPhone: string;
  /** Full delivery address as one line (the challan's buyer address). */
  buyerAddressText: string;
  items: Array<{
    productName: string;
    sku: string;
    quantity: number;
    unitPricePoisha: number;
  }>;
  subtotalPoisha: number;
  discountPoisha: number;
  shippingPoisha: number;
  codFeePoisha: number;
  taxPoisha: number;
  totalPoisha: number;
  /** Recorded VAT split — null when no rate was configured. */
  vatPoisha: number | null;
  vatRateBps: number | null;
}

export interface Mushak63Line {
  description: string;
  sku: string;
  quantity: number;
  unitPricePoisha: number;
  valuePoisha: number;
  /** Supplementary duty — never tracked → always null. */
  supplementaryDutyPoisha: null;
  /** The order's recorded rate (bps), or null when unrecorded. */
  vatRateBps: number | null;
  /** Pro-rata allocation of the recorded order VAT; null if unrecorded. */
  vatPoisha: number | null;
}

export interface Mushak63 {
  /** চালান নম্বর — the human order number. */
  challanNo: string;
  issueDateDhaka: string; // YYYY-MM-DD
  issueTimeDhaka: string; // HH:MM (24h, Asia/Dhaka)
  seller: { name: string; address: string | null; bin: string | null };
  buyer: { name: string; address: string; phone: string; bin: null };
  lines: Mushak63Line[];
  totals: {
    /** Σ line values (goods value, VAT-inclusive as recorded). */
    goodsValuePoisha: number;
    discountPoisha: number;
    deliveryPoisha: number;
    codFeePoisha: number;
    otherTaxPoisha: number;
    /** Recorded VAT total (the Σ of the line allocations). */
    vatPoisha: number | null;
    /** Goods value excluding the recorded VAT (null when unrecorded). */
    valueExcludingVatPoisha: number | null;
    totalPayablePoisha: number;
  };
  vatRecorded: boolean;
  /** Machine-stable note keys the page renders as footnotes. */
  notes: Array<"vat_pro_rata_allocation" | "vat_not_recorded" | "seller_details_blank" | "buyer_bin_blank">;
}

function dhakaParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const part = (t: string) => dateParts.find((p) => p.type === t)?.value ?? "";
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time };
}

/** Largest-remainder pro-rata allocation summing EXACTLY to total. */
function allocateProRata(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (total <= 0 || weightSum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / weightSum);
  const out = raw.map((v) => Math.floor(v));
  let remainder = total - out.reduce((s, v) => s + v, 0);
  const byFraction = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of byFraction) {
    if (remainder <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    remainder -= 1;
  }
  return out;
}

export function buildMushak63(
  input: MushakOrderInput,
  sellerName: string,
  sellerDetails?: { address?: string | null; bin?: string | null },
): Mushak63 {
  const { date, time } = dhakaParts(input.createdAtIso);
  const vatRecorded = input.vatPoisha !== null && input.vatRateBps !== null;
  const lineValues = input.items.map((i) => i.unitPricePoisha * i.quantity);
  const lineVat = vatRecorded
    ? allocateProRata(input.vatPoisha as number, lineValues)
    : input.items.map(() => null);

  const lines: Mushak63Line[] = input.items.map((item, idx) => ({
    description: item.productName,
    sku: item.sku,
    quantity: item.quantity,
    unitPricePoisha: item.unitPricePoisha,
    valuePoisha: lineValues[idx] as number,
    supplementaryDutyPoisha: null,
    vatRateBps: vatRecorded ? input.vatRateBps : null,
    vatPoisha: lineVat[idx] ?? null,
  }));

  const goodsValuePoisha = lineValues.reduce((s, v) => s + v, 0);
  const sellerAddress = sellerDetails?.address?.trim() ? sellerDetails.address.trim() : null;
  const sellerBin = sellerDetails?.bin?.trim() ? sellerDetails.bin.trim() : null;
  const notes: Mushak63["notes"] = ["buyer_bin_blank"];
  if (!sellerAddress || !sellerBin) notes.push("seller_details_blank");
  if (vatRecorded) notes.push("vat_pro_rata_allocation");
  else notes.push("vat_not_recorded");

  return {
    challanNo: input.orderNo,
    issueDateDhaka: date,
    issueTimeDhaka: time,
    seller: { name: sellerName, address: sellerAddress, bin: sellerBin },
    buyer: { name: input.customerName, address: input.buyerAddressText, phone: input.customerPhone, bin: null },
    lines,
    totals: {
      goodsValuePoisha,
      discountPoisha: input.discountPoisha,
      deliveryPoisha: input.shippingPoisha,
      codFeePoisha: input.codFeePoisha,
      otherTaxPoisha: input.taxPoisha,
      vatPoisha: vatRecorded ? (input.vatPoisha as number) : null,
      valueExcludingVatPoisha: vatRecorded ? input.totalPoisha - (input.vatPoisha as number) : null,
      totalPayablePoisha: input.totalPoisha,
    },
    vatRecorded,
    notes,
  };
}

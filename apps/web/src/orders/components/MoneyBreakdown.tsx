// OD0 (doc 19 §2.2) — MoneyBreakdown: the wave-28 print split, on screen.
// Renders the totals hierarchy subtotal → discount → shipping → residual
// → total → paid → due with the EXACT arithmetic and labels of the print
// centre (app/admin/orders/print/page.tsx), so screen and invoice can
// never disagree. Pure presentation: serialisable poisha props only,
// formatting via ui/money.
import { Money } from "../../components/ui/money";

export interface MoneyBreakdownInput {
  subtotalPoisha: number;
  discountPoisha?: number;
  shippingPoisha?: number;
  totalPoisha: number;
  /** Omit for surfaces that don't know collections yet (checkout);
   *  when provided, the পরিশোধিত row shows and বকেয়া appears while
   *  total − paid > 0. */
  paidPoisha?: number;
  /** Rental security deposit (ADV-23 vertical 3) already inside
   *  totalPoisha, from the detail payload's data.rental — rendered
   *  as its own row and taken out of the residual, exactly like
   *  the PDF invoice (src/pdf/invoice-data). Omit / 0 for
   *  non-rental orders. */
  rentalDepositPoisha?: number;
  /** Print-on-demand print fee (ADV-23 vertical 5) already inside
   *  totalPoisha, from the detail payload's data.pod — rendered
   *  as its own row and taken out of the residual, exactly like
   *  the deposit. Omit / 0 for non-POD orders. */
  printFeePoisha?: number;
}

export type MoneyBreakdownRowKey =
  | "subtotal"
  | "discount"
  | "shipping"
  | "deposit"
  | "printFee"
  | "residual"
  | "total"
  | "paid"
  | "due";

export interface MoneyBreakdownRow {
  key: MoneyBreakdownRowKey;
  labelBn: string;
  labelEn: string;
  /** Signed display amount: the discount row carries a negative value
   *  and renders with the print centre's leading −. */
  poisha: number;
  emphasis?: "total" | "due";
}

/** Pure row builder — the component renders exactly these rows, and the
 *  arithmetic is testable without a DOM. Row rules (print parity):
 *  discount only when > 0; residual ("সিওডি ফি ও অন্যান্য চার্জ") only
 *  when total − (subtotal − discount + shipping) ≠ 0; paid only when
 *  provided; due only when total − paid > 0. */
export function buildMoneyBreakdownRows(input: MoneyBreakdownInput): MoneyBreakdownRow[] {
  const discount = input.discountPoisha ?? 0;
  const shipping = input.shippingPoisha ?? 0;
  const deposit = input.rentalDepositPoisha ?? 0;
  const printFee = input.printFeePoisha ?? 0;
  const residual =
    input.totalPoisha - (input.subtotalPoisha - discount + shipping + deposit + printFee);
  const rows: MoneyBreakdownRow[] = [
    { key: "subtotal", labelBn: "সাবটোটাল (পণ্য)", labelEn: "Subtotal", poisha: input.subtotalPoisha },
  ];
  if (discount > 0) {
    rows.push({ key: "discount", labelBn: "ছাড়", labelEn: "Discount", poisha: -discount });
  }
  rows.push({ key: "shipping", labelBn: "ডেলিভারি চার্জ", labelEn: "Delivery charge", poisha: shipping });
  if (deposit > 0) {
    rows.push({ key: "deposit", labelBn: "ভাড়ার জামানত (ফেরতযোগ্য)", labelEn: "Rental deposit (refundable)", poisha: deposit });
  }
  if (printFee > 0) {
    rows.push({ key: "printFee", labelBn: "প্রিন্ট ফি", labelEn: "Print fee", poisha: printFee });
  }
  if (residual !== 0) {
    rows.push({ key: "residual", labelBn: "সিওডি ফি ও অন্যান্য চার্জ", labelEn: "COD fee & other charges", poisha: residual });
  }
  rows.push({ key: "total", labelBn: "সর্বমোট", labelEn: "Total", poisha: input.totalPoisha, emphasis: "total" });
  if (input.paidPoisha !== undefined) {
    rows.push({ key: "paid", labelBn: "পরিশোধিত", labelEn: "Paid", poisha: input.paidPoisha });
    const due = input.totalPoisha - input.paidPoisha;
    if (due > 0) {
      rows.push({ key: "due", labelBn: "বকেয়া", labelEn: "Due", poisha: due, emphasis: "due" });
    }
  }
  return rows;
}

export function MoneyBreakdown({
  lang = "bn",
  className = "",
  ...input
}: MoneyBreakdownInput & { lang?: "bn" | "en"; className?: string }) {
  const rows = buildMoneyBreakdownRows(input);
  return (
    <dl className={`space-y-1.5 text-sm ${className}`}>
      {rows.map((row) => {
        const negative = row.poisha < 0;
        const amount = (
          <>
            {negative ? "−" : ""}
            <Money poisha={Math.abs(row.poisha)} />
          </>
        );
        if (row.emphasis === "total") {
          return (
            <div key={row.key} className="flex items-baseline justify-between border-t border-border pt-2 text-base font-bold">
              <dt>{lang === "bn" ? row.labelBn : row.labelEn}</dt>
              <dd>{amount}</dd>
            </div>
          );
        }
        if (row.emphasis === "due") {
          return (
            <div key={row.key} className="flex items-baseline justify-between font-semibold text-amber-700">
              <dt>{lang === "bn" ? row.labelBn : row.labelEn}</dt>
              <dd>{amount}</dd>
            </div>
          );
        }
        return (
          <div key={row.key} className="flex items-baseline justify-between">
            <dt className="text-text-muted">{lang === "bn" ? row.labelBn : row.labelEn}</dt>
            <dd>{amount}</dd>
          </div>
        );
      })}
    </dl>
  );
}

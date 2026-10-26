/**
 * Mushak 6.3 (চালানপত্র) print page — ADV-11 (doc 22).
 * URL: /admin/erp/mushak/<orderId>
 *
 * Server-rendered from the Order row via the pure builder in
 * src/erp/mushak.ts; print isolation mirrors the orders print centre
 * (visibility trick + @page A4). What is NOT known is printed as a
 * blank fill-in line, never invented:
 *  - Seller name comes from Settings general.store_name; the seller
 *    address and BIN have no Settings keys anywhere in the system,
 *    so those lines print blank (a screen-only note says so).
 *  - The buyer's BIN likewise has no field → blank.
 *  - VAT figures appear ONLY when the order carries its recorded
 *    split (vatPoisha/vatRateBps from create time); otherwise the
 *    VAT cells print "—" with the footnote the builder flags.
 * The buyer's phone is not a Mushak field and is not printed.
 */
import { notFound } from "next/navigation";
import { prisma } from "@advance-ecommerce/db";
import { getSetting } from "@/lib/settings";
import { buildMushak63 } from "@/erp/mushak";
import { formatBdt } from "@/checkout/pricing";
import MushakPrintButton from "./print-button";

export const dynamic = "force-dynamic";

const NOTE_TEXT: Record<string, string> = {
  vat_pro_rata_allocation:
    "দ্রষ্টব্য: অর্ডারে ভ্যাট মোট হিসেবে রেকর্ড করা — পণ্যের লাইনে ভ্যাট আনুপাতিক হারে বণ্টিত (মোট রেকর্ডকৃত ভ্যাটের সাথে মিলিয়ে)।",
  vat_not_recorded:
    "দ্রষ্টব্য: এই অর্ডারে কোনো ভ্যাট বিভাজন রেকর্ড করা হয়নি (অর্ডারের সময় Settings-এ ভ্যাট হার নির্ধারিত ছিল না) — ভ্যাটের ঘর তাই ফাঁকা রাখা হয়েছে; পরে অনুমান করে বসানো হয়নি।",
  seller_details_blank:
    "বিক্রেতার ঠিকানা ও BIN: সিস্টেমে এই তথ্যের কোনো Settings ক্ষেত্র নেই — খালি জায়গায় হাতে লিখুন।",
  buyer_bin_blank: "ক্রেতার BIN: ক্রেতার রেকর্ডে BIN ক্ষেত্র নেই — থাকলে হাতে লিখুন।",
};

function money(poisha: number | null): string {
  return poisha === null ? "—" : formatBdt(poisha);
}

export default async function Mushak63Page({
  params,
}: {
  params: { orderId: string };
}) {
  const { orderId } = params;
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (!order || order.deletedAt) notFound();

  const storeName = (await getSetting("general.store_name")) ?? "";
  const storeAddress = (await getSetting("general.store_address")) ?? "";
  const storeBin = (await getSetting("general.store_bin")) ?? "";
  const addressText = [order.addressLine, order.union, order.upazila, order.district, order.division]
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .join(", ");

  const doc = buildMushak63(
    {
      orderNo: order.orderNo,
      createdAtIso: order.createdAt.toISOString(),
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      buyerAddressText: addressText,
      items: order.items.map((i) => ({
        productName: i.productName,
        sku: i.sku,
        quantity: i.quantity,
        unitPricePoisha: i.unitPricePoisha,
      })),
      subtotalPoisha: order.subtotalPoisha,
      discountPoisha: order.discountPoisha,
      shippingPoisha: order.shippingPoisha,
      codFeePoisha: order.codFeePoisha,
      taxPoisha: order.taxPoisha,
      totalPoisha: order.totalPoisha,
      vatPoisha: order.vatPoisha,
      vatRateBps: order.vatRateBps,
    },
    storeName,
    { address: storeAddress, bin: storeBin },
  );

  const blank = "________________________";

  return (
    <main className="mx-auto max-w-3xl p-4">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #mushak-print, #mushak-print * { visibility: visible !important; }
          #mushak-print { position: absolute; inset: 0; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>

      <div className="mb-4 flex items-center justify-between print:hidden">
        <p className="text-sm text-text-muted">
          মূসক-৬.৩ চালানপত্র — অর্ডার {doc.challanNo}। বিক্রেতার ঠিকানা/BIN ও ক্রেতার BIN-এর কোনো
          Settings/রেকর্ড ক্ষেত্র সিস্টেমে নেই — ছাপানো ফর্মে সেগুলো খালি থাকবে, হাতে পূরণ করুন।
        </p>
        <MushakPrintButton />
      </div>

      <div id="mushak-print" className="border border-black bg-white p-6 text-black">
        <div className="flex items-start justify-between">
          <div className="w-24" />
          <div className="flex-1 text-center">
            <div className="text-lg font-bold">{doc.seller.name || blank}</div>
            <div className="text-sm">ঠিকানা: {doc.seller.address || blank}</div>
            <div className="text-sm">BIN: {doc.seller.bin || blank}</div>
            <div className="mt-2 text-xl font-bold underline">চালানপত্র</div>
          </div>
          <div className="w-24 border border-black px-2 py-1 text-center text-sm font-bold">
            মূসক-৬.৩
          </div>
        </div>

        <div className="mt-4 flex justify-between text-sm">
          <span>চালান নম্বর: <strong>{doc.challanNo}</strong></span>
          <span>তারিখ: {doc.issueDateDhaka} · সময়: {doc.issueTimeDhaka}</span>
        </div>

        <div className="mt-3 border border-black p-3 text-sm">
          <div>ক্রেতার নাম: <strong>{doc.buyer.name}</strong></div>
          <div>ক্রেতার ঠিকানা: {doc.buyer.address}</div>
          <div>ক্রেতার BIN: {blank}</div>
        </div>

        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr>
              {["ক্রমিক", "পণ্য/সেবার বিবরণ", "পরিমাণ", "একক মূল্য", "মোট মূল্য", "সম্পূরক শুল্ক", "ভ্যাটের হার", "ভ্যাটের পরিমাণ"].map(
                (h) => (
                  <th key={h} className="border border-black px-2 py-1 text-left font-semibold">
                    {h}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((line, idx) => (
              <tr key={idx}>
                <td className="border border-black px-2 py-1">{idx + 1}</td>
                <td className="border border-black px-2 py-1">
                  {line.description}
                  <span className="block text-xs">SKU: {line.sku}</span>
                </td>
                <td className="border border-black px-2 py-1">{line.quantity}</td>
                <td className="border border-black px-2 py-1">{money(line.unitPricePoisha)}</td>
                <td className="border border-black px-2 py-1">{money(line.valuePoisha)}</td>
                <td className="border border-black px-2 py-1">{money(line.supplementaryDutyPoisha)}</td>
                <td className="border border-black px-2 py-1">
                  {line.vatRateBps === null ? "—" : `${line.vatRateBps / 100}%`}
                </td>
                <td className="border border-black px-2 py-1">{money(line.vatPoisha)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <table className="w-72 text-sm">
            <tbody>
              <tr>
                <td className="py-0.5">মোট পণ্যমূল্য:</td>
                <td className="py-0.5 text-right">{money(doc.totals.goodsValuePoisha)}</td>
              </tr>
              {doc.totals.discountPoisha > 0 ? (
                <tr>
                  <td className="py-0.5">বাদ: ছাড়:</td>
                  <td className="py-0.5 text-right">−{money(doc.totals.discountPoisha)}</td>
                </tr>
              ) : null}
              {doc.totals.deliveryPoisha > 0 ? (
                <tr>
                  <td className="py-0.5">ডেলিভারি চার্জ:</td>
                  <td className="py-0.5 text-right">{money(doc.totals.deliveryPoisha)}</td>
                </tr>
              ) : null}
              {doc.totals.codFeePoisha > 0 ? (
                <tr>
                  <td className="py-0.5">COD ফি:</td>
                  <td className="py-0.5 text-right">{money(doc.totals.codFeePoisha)}</td>
                </tr>
              ) : null}
              {doc.totals.otherTaxPoisha > 0 ? (
                <tr>
                  <td className="py-0.5">অন্যান্য কর:</td>
                  <td className="py-0.5 text-right">{money(doc.totals.otherTaxPoisha)}</td>
                </tr>
              ) : null}
              <tr>
                <td className="py-0.5">ভ্যাটের পরিমাণ (মোট):</td>
                <td className="py-0.5 text-right">{money(doc.totals.vatPoisha)}</td>
              </tr>
              <tr>
                <td className="py-0.5">ভ্যাট ব্যতীত মূল্য:</td>
                <td className="py-0.5 text-right">{money(doc.totals.valueExcludingVatPoisha)}</td>
              </tr>
              <tr className="border-t border-black font-bold">
                <td className="py-1">সর্বমোট পরিশোধযোগ্য:</td>
                <td className="py-1 text-right">{money(doc.totals.totalPayablePoisha)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-4 space-y-1 text-xs">
          {doc.notes.map((n) => (
            <p key={n}>{NOTE_TEXT[n]}</p>
          ))}
        </div>

        <div className="mt-10 flex justify-between text-sm">
          <span>ক্রেতার স্বাক্ষর: {blank}</span>
          <span>বিক্রেতার স্বাক্ষর ও সিল: {blank}</span>
        </div>
      </div>
    </main>
  );
}

/**
 * Payslip print page — ADV-11 remainder (payroll-lite).
 * URL: /admin/erp/payslip/<runId>/<userId>
 *
 * Server-rendered from the payroll Setting doc (src/erp/payroll.ts);
 * print isolation mirrors the Mushak 6.3 page (visibility trick +
 * @page A4). The slip prints EXACTLY what the run line recorded —
 * gross, deduction, net — because a component split (basic / house
 * rent / transport / other) is NOT stored on the run line: a slip
 * generated after a later salary-config edit must not present edited
 * figures as the run's record. The note on the slip says so.
 * Behind module.erp_lite: OFF renders an honest notice, not a slip.
 */
import { notFound } from "next/navigation";
import { getSetting } from "@/lib/settings";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { formatBdt } from "@/checkout/pricing";
import { getPayrollDoc } from "@/erp/payroll";
import { dhakaTimestampText } from "@/erp/exports";
import PayslipPrintButton from "./print-button";

export const dynamic = "force-dynamic";

export default async function PayslipPage({
  params,
}: {
  params: { runId: string; userId: string };
}) {
  if (!isFeatureEnabled("module.erp_lite")) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-text-muted">
          ERP-lite মডিউল বন্ধ (module.erp_lite OFF) — পে-স্লিপ দেখতে মডিউলটি চালু করুন।
        </p>
      </main>
    );
  }

  const doc = await getPayrollDoc();
  const run = doc.runs.find((r) => r.id === params.runId);
  const line = run?.lines.find((l) => l.userId === params.userId);
  if (!run || !line) notFound();

  const storeName = (await getSetting("general.store_name")) ?? "";
  const storeAddress = (await getSetting("general.store_address")) ?? "";
  const blank = "________________________";

  return (
    <main className="mx-auto max-w-3xl p-4">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #payslip-print, #payslip-print * { visibility: visible !important; }
          #payslip-print { position: absolute; inset: 0; }
          @page { size: A4; margin: 12mm; }
        }
      `}</style>

      <div className="mb-4 flex items-center justify-between print:hidden">
        <p className="text-sm text-text-muted">
          পে-স্লিপ — {line.name}, মাস {run.month}। অঙ্কগুলো রান তৈরি হওয়ার সময়ের স্ন্যাপশট; রান লাইনে
          কম্পোনেন্ট-ভিত্তিক বিভাজন সংরক্ষিত থাকে না, তাই স্লিপে মোট/কর্তন/নিটই দেখানো হয়।
        </p>
        <PayslipPrintButton />
      </div>

      <div id="payslip-print" className="border border-black bg-white p-6 text-black">
        <div className="text-center">
          <div className="text-lg font-bold">{storeName || blank}</div>
          {storeAddress ? <div className="text-sm">{storeAddress}</div> : null}
          <div className="mt-2 text-xl font-bold underline">বেতন স্লিপ (Payslip)</div>
        </div>

        <div className="mt-4 flex justify-between text-sm">
          <span>
            কর্মীর নাম: <strong>{line.name}</strong>
          </span>
          <span>
            মাস: <strong>{run.month}</strong>
          </span>
        </div>
        <div className="mt-1 flex justify-between text-sm">
          <span>
            রানের অবস্থা: <strong>{run.status === "FINALIZED" ? "ফাইনালাইজড" : "খসড়া"}</strong>
          </span>
          <span>তৈরি: {dhakaTimestampText(new Date())} (Asia/Dhaka)</span>
        </div>

        <table className="mt-4 w-full border-collapse text-sm">
          <tbody>
            <tr className="border border-black">
              <td className="border border-black px-3 py-2">মোট বেতন (Gross)</td>
              <td className="border border-black px-3 py-2 text-right">{formatBdt(line.grossPoisha)}</td>
            </tr>
            <tr className="border border-black">
              <td className="border border-black px-3 py-2">কর্তন (Deduction)</td>
              <td className="border border-black px-3 py-2 text-right">− {formatBdt(line.deductionPoisha)}</td>
            </tr>
            <tr className="border border-black font-bold">
              <td className="border border-black px-3 py-2">নিট প্রদেয় (Net pay)</td>
              <td className="border border-black px-3 py-2 text-right">{formatBdt(line.netPoisha)}</td>
            </tr>
          </tbody>
        </table>

        {run.status === "FINALIZED" ? (
          <p className="mt-3 text-sm">
            জার্নাল এন্ট্রি: {run.journalEntryId ?? "— (মোট ০ হওয়ায় কোনো এন্ট্রি পোস্ট হয়নি)"}
            {run.finalizedAt ? ` · ফাইনালাইজ: ${dhakaTimestampText(new Date(run.finalizedAt))} (Asia/Dhaka)` : ""}
          </p>
        ) : (
          <p className="mt-3 text-sm">
            দ্রষ্টব্য: এই রান এখনো খসড়া — ফাইনালাইজ না করা পর্যন্ত এই স্লিপের অঙ্ক চূড়ান্ত নয়।
          </p>
        )}

        <div className="mt-10 flex justify-between text-sm">
          <span>কর্মীর স্বাক্ষর: {blank}</span>
          <span>কর্তৃপক্ষের স্বাক্ষর: {blank}</span>
        </div>
      </div>
    </main>
  );
}

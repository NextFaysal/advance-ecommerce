import { BuilderClient } from "./builder-client";

// Admin > Reports > Report Builder (ADV-8, doc 22). Custom reports
// over real DB rows: dataset + columns + filters + Dhaka range ->
// preview and watermarked CSV export (reason mandatory, audited —
// same contract as the sales export). Saved definitions and
// delivery schedules persist as JSON documents in the Setting table
// (src/reports/saved-reports.ts).
export const dynamic = "force-dynamic";

export default function ReportBuilderPage() {
  return (
    <main className="min-w-0">
      <h1 className="text-xl font-bold">রিপোর্ট বিল্ডার (Report Builder)</h1>
      <p className="mt-2 text-sm text-slate-600">
        ডেটাসেট, কলাম, ফিল্টার ও তারিখ বেছে নিজের রিপোর্ট বানান। প্রিভিউ ও CSV এক্সপোর্ট দুটোই আসল ডাটাবেস
        ডেটা থেকে তৈরি হয়; এক্সপোর্টে কারণ আবশ্যক, CSV-তে watermark থাকে এবং audit-লগ হয়। সংরক্ষিত
        রিপোর্টে দৈনিক/সাপ্তাহিক ইমেইল ডেলিভারির সময়সূচি দেওয়া যায় — ডেলিভারি queue হয়ে worker চালু
        থাকলে পাঠানো হয়।
      </p>
      <BuilderClient />
    </main>
  );
}

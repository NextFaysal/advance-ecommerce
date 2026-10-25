import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { getSetting } from "@/lib/settings";
import { VatRateCard } from "./vat-card";

// Admin > Settings > Accounting — the VAT rate card (wave 16).
// Until now the sales-VAT rate (Settings key `accounting.vat_rate_bps`,
// wave 7) could only be changed by writing the Settings store
// directly — the ERP VAT report read it, but there was no UI. This
// page is that UI: it reads the current stored value server-side
// (the key is not public, so the client never fetches it directly)
// and the card saves through the standard Settings API, which
// requires a reason and writes the settings.update audit row.
// Nothing about the VAT computation changes here.
export const dynamic = "force-dynamic";

/**
 * The effective rate, parsed with EXACTLY the rule the order flow
 * uses (orders/repository.readConfiguredVatRateBps): unset, blank,
 * non-integer, <= 0 or > 10000 (basis points) all mean "not
 * configured" — order creation then records no VAT split.
 */
function effectiveVatRateBps(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const rate = Number.parseInt(raw, 10);
  if (!Number.isInteger(rate) || rate <= 0 || rate > 10000) return null;
  return rate;
}

export default async function AccountingSettingsPage() {
  let raw: string | null = null;
  let dbReady = true;
  try {
    raw = await getSetting("accounting.vat_rate_bps");
  } catch {
    dbReady = false;
  }
  const initialBps = effectiveVatRateBps(raw);

  return (
    <main className="min-w-0">
      <PageHeader
        title="হিসাব — VAT সেটিংস"
        description="বিক্রয়ের VAT হার সেট করুন। হারটি Settings-এ basis points (bps) হিসেবে থাকে — 15% = 1500 bps — এই পেজে আপনি শুধু শতকরা হার লিখবেন, রূপান্তর পেজই করবে।"
        breadcrumb="সেটিংস / হিসাব"
        actions={
          <Link
            href="/admin/settings"
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300"
          >
            ← সব সেটিংস
          </Link>
        }
      />

      <section className="mt-4 rounded-lg border border-border bg-card p-4 shadow-card">
        <h2 className="font-semibold">এই হার দিয়ে কী হয়?</h2>
        <ul className="mt-2 list-inside list-disc space-y-1 text-sm leading-relaxed text-text-muted">
          <li>
            আমাদের দাম <strong>VAT-সহ (VAT-inclusive)</strong> — ক্রেতা যে মোট দাম দেন, তার ভেতরেই VAT ধরা থাকে।
            হার সেট থাকলে প্রতিটি নতুন অর্ডার তৈরির সময় মোট দাম থেকে VAT-এর অংশটুকু আলাদা করে অর্ডারে সংরক্ষিত হয়
            (<span className="font-mono text-xs">vatPoisha</span> / <span className="font-mono text-xs">vatRateBps</span>) — ক্রেতার মোট দাম একদমই বদলায় না।
          </li>
          <li>
            <Link href="/admin/erp" className="font-medium text-brand-700 underline">ERP পেজের</Link> মাসিক বিক্রয় VAT রিপোর্ট
            (আউটপুট VAT, VAT-ছাড়া নিট বিক্রয়, নিট প্রদেয়) এই সংরক্ষিত বিভাজন থেকেই তৈরি হয়। ক্রয়ের (ইনপুট) VAT এই সিস্টেমে এখনো ধরা হয় না — ক্রয়ের কোনো লেজার নেই।
          </li>
          <li>হার বদলালে <strong>আগের অর্ডারের বিভাজন বদলায় না</strong> — প্রতিটি অর্ডারে তার নিজের সময়ের হারই সংরক্ষিত থাকে।</li>
          <li>ঘর খালি রেখে বা 0 সেভ করলে বিভাজন <strong>বন্ধ</strong> — তখন রিপোর্টে শুধু সেই অর্ডারগুলোই আসবে, যেগুলোতে আগে থেকে বিভাজন সংরক্ষিত আছে।</li>
        </ul>
      </section>

      <div className="mt-4">
        <VatRateCard initialBps={initialBps} initialRaw={raw ?? ""} dbReady={dbReady} />
      </div>

      <p className="mt-4 text-sm text-text-muted">
        সেটিং কী: <code className="font-mono text-xs">accounting.vat_rate_bps</code> — মান শতকরা নয়, basis points-এ সংরক্ষিত হয়।
        প্রতিটি পরিবর্তন কারণসহ অডিট লগে (<span className="font-mono text-xs">settings.update</span>) লেখা থাকে।
      </p>
    </main>
  );
}

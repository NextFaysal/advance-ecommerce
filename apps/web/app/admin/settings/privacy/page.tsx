import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getMaintenanceConfig } from "@/privacy/maintenance";
import {
  readConsentLog,
  readDeletionLedger,
  readExportLedger,
  type ConsentLogEntry,
  type DeletionLedgerEntry,
  type ExportLedgerEntry,
} from "@/privacy/ledger";
import { maskPhone } from "@/checkout/validation";
import { MaintenanceCard } from "./maintenance-card";

// Admin > Settings > Privacy (ADV-29) — the operator surface for
// the privacy machinery in src/privacy/:
//   - maintenance mode editor (site.maintenance, saved through the
//     standard audited Settings API),
//   - the marketing consent log (privacy.consent_log),
//   - the data-export ledger (privacy.exports),
//   - the account anonymisation ledger (privacy.deletions).
// All three ledgers are Setting-row JSON docs written by the
// customer-facing flows themselves; this page only READS them. If
// the DB is unreachable the page says so and shows defaults — it
// never renders invented records.
export const dynamic = "force-dynamic";

function formatAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat("bn-BD", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function shortId(id: string | null): string {
  if (id === null) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export default async function AdminPrivacySettingsPage() {
  let dbReady = true;
  let maintenance = await getMaintenanceConfig().catch(() => null);
  let consent: ConsentLogEntry[] = [];
  let exportsLedger: ExportLedgerEntry[] = [];
  let deletions: DeletionLedgerEntry[] = [];
  if (maintenance === null) {
    dbReady = false;
    maintenance = { enabled: false, messageBn: "", messageEn: "" };
  }
  try {
    [consent, exportsLedger, deletions] = await Promise.all([
      readConsentLog(50),
      readExportLedger(20),
      readDeletionLedger(20),
    ]);
  } catch {
    dbReady = false;
  }

  return (
    <main>
      <PageHeader
        title="গোপনীয়তা ও মেইনটেন্যান্স"
        description="কাস্টমার ডেটা অধিকার (এক্সপোর্ট/মুছে ফেলা), মার্কেটিং সম্মতির লগ এবং স্টোরফ্রন্ট মেইনটেন্যান্স মোড — সব রেকর্ড আসল privacy লেজার থেকে পড়া। (Privacy & Maintenance)"
        breadcrumb="Admin / Settings"
      />

      <div className="mb-6">
        <MaintenanceCard
          initialEnabled={maintenance.enabled}
          initialMessageBn={maintenance.messageBn}
          initialMessageEn={maintenance.messageEn}
          dbReady={dbReady}
        />
      </div>

      <Card className="mb-6">
        <h2 className="font-semibold">মার্কেটিং সম্মতির লগ (Consent Log)</h2>
        <p className="mt-1 text-sm text-text-muted">
          নিউজলেটার সাবস্ক্রাইব/আনসাবস্ক্রাইব ও অ্যাকাউন্ট মোছার সময় সম্মতি প্রত্যাহারের রেকর্ড
          (সর্বশেষ ৫০টি, <code className="font-mono text-xs">privacy.consent_log</code>)।
        </p>
        {consent.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">এখনো কোনো সম্মতি-পরিবর্তনের রেকর্ড নেই।</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <th className="py-2 pr-3 font-medium">সময়</th>
                  <th className="py-2 pr-3 font-medium">সিদ্ধান্ত</th>
                  <th className="py-2 pr-3 font-medium">উৎস</th>
                  <th className="py-2 pr-3 font-medium">ইমেইল</th>
                  <th className="py-2 pr-3 font-medium">ফোন</th>
                  <th className="py-2 font-medium">কাস্টমার</th>
                </tr>
              </thead>
              <tbody>
                {consent.map((entry, i) => (
                  <tr key={`${entry.at}-${i}`} className="border-b border-border/50">
                    <td className="py-2 pr-3 whitespace-nowrap">{formatAt(entry.at)}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={entry.action === "granted" ? "success" : "warning"}>
                        {entry.action === "granted" ? "সম্মতি দিয়েছেন" : "সম্মতি তুলে নিয়েছেন"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">{entry.source}</td>
                    <td className="py-2 pr-3">{entry.email ?? "—"}</td>
                    <td className="py-2 pr-3">{entry.phone ? maskPhone(entry.phone) : "—"}</td>
                    <td className="py-2 font-mono text-xs">{shortId(entry.customerId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">ডেটা এক্সপোর্ট লেজার</h2>
          <p className="mt-1 text-sm text-text-muted">
            কাস্টমারদের নিজের ডেটা ডাউনলোডের রেকর্ড (সর্বশেষ ২০টি,{" "}
            <code className="font-mono text-xs">privacy.exports</code>)।
          </p>
          {exportsLedger.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">এখনো কোনো এক্সপোর্ট হয়নি।</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {exportsLedger.map((entry, i) => (
                <li key={`${entry.at}-${i}`} className="rounded-lg border border-border/60 px-3 py-2">
                  <span className="font-medium">{formatAt(entry.at)}</span>{" "}
                  <span className="font-mono text-xs text-text-muted">{shortId(entry.customerId)}</span>
                  <span className="block text-text-muted">
                    {entry.sections.length}টি সেকশন · অডিট লগ: {entry.auditLogWritten ? "লেখা হয়েছে" : "লেখা যায়নি"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="font-semibold">অ্যাকাউন্ট মুছে ফেলার লেজার</h2>
          <p className="mt-1 text-sm text-text-muted">
            বেনামীকরণের (anonymisation) রেকর্ড (সর্বশেষ ২০টি,{" "}
            <code className="font-mono text-xs">privacy.deletions</code>)। অর্ডার হিসাবের জন্য
            সংরক্ষিত থাকে — এখানে শুধু সংখ্যা থাকে, কোনো ব্যক্তিগত তথ্য নয়।
          </p>
          {deletions.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">এখনো কোনো অ্যাকাউন্ট মোছা হয়নি।</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {deletions.map((entry, i) => (
                <li key={`${entry.at}-${i}`} className="rounded-lg border border-border/60 px-3 py-2">
                  <span className="font-medium">{formatAt(entry.at)}</span>{" "}
                  <span className="font-mono text-xs text-text-muted">{shortId(entry.customerId)}</span>
                  <span className="block text-text-muted">
                    প্রমাণ: {entry.proof} · সংরক্ষিত অর্ডার {entry.ordersRetained}টি · বেনামী রিভিউ{" "}
                    {entry.reviewsAnonymised}টি · মোছা ঠিকানা {entry.addressesDeleted}টি · সেশন{" "}
                    {entry.sessionsDeleted}টি
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </main>
  );
}

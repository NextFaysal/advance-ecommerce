import { PageHeader } from "@/components/ui/page-header";
import { DataTable } from "@/components/ui/table";
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
import { AgeGateCard } from "./age-gate-card";
import { loadAgeRestrictions } from "@/catalog/age-restrictions";
import { getRequestLocale } from "@/i18n/server";
import { intlLocale, interpolate, pick, type Locale } from "@/i18n/locale";
import { SETTINGS_B_STRINGS } from "../strings-b";
import { prisma } from "@advance-ecommerce/db";

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

function formatAt(iso: string, locale: Locale): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" }).format(d);
}

function shortId(id: string | null): string {
  if (id === null) return "—";
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export default async function AdminPrivacySettingsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
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
  // Age gate (ADV-29): the current restriction document + the real
  // category slugs for the editor's datalist. Same honesty rule as
  // the ledgers above — a failed read shows defaults and says so.
  let ageRestrictions: { slug: string; minAge: number }[] = [];
  let categorySlugs: string[] = [];
  try {
    const [restrictions, categories] = await Promise.all([
      loadAgeRestrictions(),
      prisma.category.findMany({ where: { deletedAt: null }, select: { slug: true }, orderBy: { slug: "asc" } }),
    ]);
    ageRestrictions = restrictions;
    categorySlugs = categories.map((c) => c.slug);
  } catch {
    dbReady = false;
  }

  return (
    <main>
      <PageHeader
        title={s.privTitle}
        description={s.privDesc}
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

      <div className="mb-6">
        <AgeGateCard initialRestrictions={ageRestrictions} categorySlugs={categorySlugs} dbReady={dbReady} />
      </div>

      <Card className="mb-6">
        <h2 className="font-semibold">{s.privConsentTitle}</h2>
        <p className="mt-1 text-sm text-text-muted">
          {s.privConsentDescA}
          <code className="font-mono text-xs">privacy.consent_log</code>
          {s.privConsentDescB}
        </p>
        {consent.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">{s.privConsentEmpty}</p>
        ) : (
          <div className="mt-3">
            <DataTable
              columns={[
                { key: "time", header: s.privColTime },
                { key: "decision", header: s.privColDecision },
                { key: "source", header: s.privColSource },
                { key: "email", header: s.privColEmail },
                { key: "phone", header: s.privColPhone },
                { key: "customer", header: s.privColCustomer },
              ]}
              rows={consent.map((entry) => ({
                time: <span className="tnum whitespace-nowrap">{formatAt(entry.at, locale)}</span>,
                decision: (
                  <Badge tone={entry.action === "granted" ? "success" : "warning"}>
                    {entry.action === "granted" ? s.privGranted : s.privWithdrawn}
                  </Badge>
                ),
                source: entry.source,
                email: entry.email ?? "—",
                phone: entry.phone ? maskPhone(entry.phone) : "—",
                customer: <span className="font-mono text-xs">{shortId(entry.customerId)}</span>,
              }))}
            />
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">{s.privExportTitle}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {s.privExportDescA}
            <code className="font-mono text-xs">privacy.exports</code>
            {s.privExportDescB}
          </p>
          {exportsLedger.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">{s.privExportEmpty}</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {exportsLedger.map((entry, i) => (
                <li key={`${entry.at}-${i}`} className="rounded-xl border border-border/60 px-3 py-2">
                  <span className="font-medium">{formatAt(entry.at, locale)}</span>{" "}
                  <span className="font-mono text-xs text-text-muted">{shortId(entry.customerId)}</span>
                  <span className="block text-text-muted">
                    {interpolate(s.privExportMeta, { count: entry.sections.length, audit: entry.auditLogWritten ? s.privAuditYes : s.privAuditNo })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="font-semibold">{s.privDeletionTitle}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {s.privDeletionDescA}
            <code className="font-mono text-xs">privacy.deletions</code>
            {s.privDeletionDescB}
          </p>
          {deletions.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">{s.privDeletionEmpty}</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {deletions.map((entry, i) => (
                <li key={`${entry.at}-${i}`} className="rounded-xl border border-border/60 px-3 py-2">
                  <span className="font-medium">{formatAt(entry.at, locale)}</span>{" "}
                  <span className="font-mono text-xs text-text-muted">{shortId(entry.customerId)}</span>
                  <span className="block text-text-muted">
                    {interpolate(s.privDeletionMeta, { proof: entry.proof, orders: entry.ordersRetained, reviews: entry.reviewsAnonymised, addresses: entry.addressesDeleted, sessions: entry.sessionsDeleted })}
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

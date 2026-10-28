import { PageHeader } from "@/admin-shell/PageHeader";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Money, formatPoisha } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { demoB2bFlags, isB2bEnabled } from "@/b2b/flags";
import { ConvertQuotationButton } from "./convert-button";
import { B2bGroupsCard } from "./groups-card";
import { b2bStore } from "@/b2b/db-store";
import { readB2bRequestMetaMap } from "@/b2b/requests";
import { checkCredit, effectiveQuotationStatus } from "@/b2b/service";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { B2B_STRINGS } from "./strings";

// B2B / Wholesale admin — Agent 25, Step 48 (A12); real data wired 2026-10-25.
// Locked state: while module.b2b is OFF in the feature_flags TABLE
// (seeded default, paid add-on), the page renders the lock panel,
// matching the API's 403 FEATURE_LOCKED — the same pattern as riders /
// resellers. demoB2bFlags delegates to the unified flag reader,
// hydrated from the DB below. Customers and quotations come from the
// Prisma b2bStore (B2bCustomer / B2bQuotation tables — the same store
// the B2B API serves); the page-local SAMPLE rows are gone.
// Credit state is computed with the real checkCredit() and quotation
// status with effectiveQuotationStatus(). Phones are masked via <Phone>.
// oldestDueDate + tradeLicenseNo are persisted columns since migration
// 20261025112500_b2b_credit_dates_and_order_vat (wave 7), so the
// overdue-by-date rule in checkCredit fires for stored customers too —
// the overdue count below reflects the full rule (limit + status +
// due date), not a degraded subset.

export const dynamic = "force-dynamic";

export default async function AdminB2bPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, B2B_STRINGS);
  await ensureDbFeatureFlags();
  if (!isB2bEnabled(demoB2bFlags)) {
    return (
      <main className="space-y-6">
        <PageHeader title={s.title} subtitle={s.lockedDesc} />
        <p role="status">{s.locked}</p>
      </main>
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const [customers, quotations, requestMeta] = await Promise.all([
    b2bStore.listCustomers(),
    b2bStore.listQuotations(),
    readB2bRequestMetaMap(),
  ]);
  const approvalQueue = customers.filter((c) => c.approvalStatus === "PENDING");
  const totalOutstanding = customers.reduce((s, c) => s + c.outstandingPoisha, 0);
  const overdueCount = customers.filter(
    (c) => checkCredit(c, 0, todayIso).overdue,
  ).length;
  const businessName = (id: string) =>
    customers.find((c) => c.id === id)?.businessName ?? id;

  const customerRows = customers.map((c) => {
    const credit = checkCredit(c, 0, todayIso);
    return {
      business: <span className="font-medium">{c.businessName}</span>,
      contact: c.contactName,
      phone: <Phone phone={c.phone} />,
      approval: (
        <Badge
          tone={
            c.approvalStatus === "APPROVED"
              ? "success"
              : c.approvalStatus === "PENDING"
                ? "warning"
                : "danger"
          }
        >
          {c.approvalStatus}
        </Badge>
      ),
      limit: <Money poisha={c.creditLimitPoisha} />,
      outstanding: (
        <span>
          <Money poisha={c.outstandingPoisha} />
          {c.oldestDueDate ? (
            <span className="block text-xs text-text-muted">{interpolate(s.oldestDue, { date: c.oldestDueDate })}</span>
          ) : null}
        </span>
      ),
      available: <Money poisha={credit.availablePoisha} />,
      creditState: credit.overdue ? (
        <Badge tone="danger">{s.overdueBadge}</Badge>
      ) : credit.allowed ? (
        <Badge tone="success">{s.creditOn}</Badge>
      ) : (
        <Badge tone="warning">{s.notApproved}</Badge>
      ),
    };
  });

  const quotationRows = quotations.map((q) => {
    const request = requestMeta[q.id] ?? null;
    // Buyer RFQs (ADV-14 remainder) are marked distinctly; a DRAFT
    // RFQ is a request, not an offer, so its placeholder validUntil
    // never makes it read EXPIRED here (src/b2b/requests.ts).
    const status =
      request !== null && q.status === "DRAFT" ? "DRAFT" : effectiveQuotationStatus(q, todayIso);
    return {
      id: <span className="tnum font-mono">{q.id}</span>,
      source:
        request !== null ? (
          <span>
            <Badge tone="info">{s.buyerRfq}</Badge>
            <span className="mt-1 block text-xs text-text-muted">
              {request.channel === "BULK_CSV" ? s.bulkCsv : s.portalForm} ·{" "}
              {request.submittedAt.slice(0, 10)}
              {request.desiredDate ? ` · ${interpolate(s.desiredDate, { date: request.desiredDate })}` : ""}
              {request.note ? ` · ${interpolate(s.noteSuffix, { note: request.note })}` : ""}
            </span>
          </span>
        ) : (
          <Badge>{s.staffCreated}</Badge>
        ),
      business: businessName(q.b2bCustomerId),
      lines: <span className="tnum">{q.lines.reduce((s, l) => s + l.quantity, 0)}</span>,
      total: <Money poisha={q.totalPoisha} />,
      validUntil: <span className="tnum">{q.validUntil}</span>,
      status: (
        <Badge
          tone={
            status === "ACCEPTED" || status === "CONVERTED"
              ? "success"
              : status === "SENT"
                ? "info"
                : status === "EXPIRED" || status === "REJECTED"
                  ? "danger"
                  : "warning"
          }
        >
          {status}
        </Badge>
      ),
      action:
        status === "ACCEPTED" ? (
          <ConvertQuotationButton quotationId={q.id} />
        ) : status === "CONVERTED" ? (
          <span className="text-xs text-text-muted">
            {interpolate(s.orderLabel, { id: q.convertedOrderId ?? "—" })}
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    };
  });

  const queueRows = approvalQueue.map((c) => ({
    business: <span className="font-medium">{c.businessName}</span>,
    contact: c.contactName,
    phone: <Phone phone={c.phone} />,
    applied: <span className="tnum">{c.createdAt.slice(0, 10)}</span>,
    note: c.tradeLicenseNo
      ? interpolate(s.queueNoteLicense, { no: c.tradeLicenseNo })
      : s.queueNotePlain,
  }));

  return (
    <main className="space-y-6">
      <PageHeader title={s.title} subtitle={s.description} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={s.statCustomers} value={String(customers.length)} delta={interpolate(s.statPending, { count: approvalQueue.length })} icon={<Icon name="users" size={22} />} />
        <StatCard label={s.statOutstanding} value={formatPoisha(totalOutstanding)} delta={s.statOutstandingDelta} icon={<Icon name="banknote" size={22} />} />
        <StatCard label={s.statOverdue} value={String(overdueCount)} delta={overdueCount > 0 ? s.statOverdueYes : s.statOverdueNo} deltaTone={overdueCount > 0 ? "down" : "up"} icon={<Icon name="clock" size={22} />} />
        <StatCard label={s.statQuotations} value={String(quotations.length)} delta={s.statQuotationsDelta} icon={<Icon name="tag" size={22} />} />
      </div>

      <p className="rounded-xl bg-success-soft px-3 py-2 text-xs text-text-main">
        {s.creditRuleNote}
        </p>

      {customers.length === 0 ? (
        <EmptyState title={s.customersEmptyTitle} description={s.customersEmptyDesc} />
      ) : null}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">{s.customersTitle}</h2>
        <div className="space-y-3 md:hidden">
          {customerRows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                {r.business}
                {r.creditState}
              </div>
              <p className="text-sm text-text-muted">
                {r.contact} · {r.phone}
              </p>
              <p>{r.approval}</p>
              <div className="grid grid-cols-3 gap-2 border-t border-border pt-2 text-sm">
                <span>
                  <span className="block text-xs text-text-muted">{s.colLimit}</span>
                  {r.limit}
                </span>
                <span>
                  <span className="block text-xs text-text-muted">{s.colOutstanding}</span>
                  {r.outstanding}
                </span>
                <span>
                  <span className="block text-xs text-text-muted">{s.colAvailable}</span>
                  {r.available}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden md:block">
          <DataTable
            caption={s.customersCaption}
            columns={[
              { key: "business", header: s.colBusiness },
              { key: "contact", header: s.colContact },
              { key: "phone", header: s.colPhone },
              { key: "approval", header: s.colApproval },
              { key: "limit", header: s.colLimit },
              { key: "outstanding", header: s.colOutstanding },
              { key: "available", header: s.colAvailable },
              { key: "creditState", header: s.colCreditState },
            ]}
            rows={customerRows}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">{s.queueTitle}</h2>
        {queueRows.length > 0 ? (
          <>
            <div className="space-y-3 md:hidden">
              {queueRows.map((r, i) => (
                <div key={i} className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-xs">
                  <div className="flex items-center justify-between gap-2">
                    {r.business}
                    {r.applied}
                  </div>
                  <p className="text-sm text-text-muted">
                    {r.contact} · {r.phone}
                  </p>
                  <p className="text-sm">{r.note}</p>
                </div>
              ))}
            </div>
            <div className="hidden md:block">
              <DataTable
                caption={s.queueCaption}
                columns={[
                  { key: "business", header: s.colBusiness },
                  { key: "contact", header: s.colContact },
                  { key: "phone", header: s.colPhone },
                  { key: "applied", header: s.colApplied },
                  { key: "note", header: s.colNote },
                ]}
                rows={queueRows}
              />
            </div>
          </>
        ) : (
          <p className="text-sm text-text-muted">{s.noQueue}</p>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">{s.groupPricingTitle}</h2>
        <B2bGroupsCard />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">{s.quotationsTitle}</h2>
        <div className="space-y-3 md:hidden">
          {quotationRows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                {r.id}
                {r.status}
              </div>
              <p>{r.source}</p>
              <p className="text-sm">{r.business}</p>
              <div className="grid grid-cols-3 gap-2 border-t border-border pt-2 text-sm">
                <span>
                  <span className="block text-xs text-text-muted">{s.colLines}</span>
                  {r.lines}
                </span>
                <span>
                  <span className="block text-xs text-text-muted">{s.colTotal}</span>
                  {r.total}
                </span>
                <span>
                  <span className="block text-xs text-text-muted">{s.colValidUntil}</span>
                  {r.validUntil}
                </span>
              </div>
              <div>{r.action}</div>
            </div>
          ))}
        </div>
        <div className="hidden md:block">
          <DataTable
            caption={s.quotationsCaption}
            columns={[
              { key: "id", header: s.colQuotation },
              { key: "source", header: s.colSource },
              { key: "business", header: s.colBusiness },
              { key: "lines", header: s.colLines },
              { key: "total", header: s.colTotal },
              { key: "validUntil", header: s.colValidUntil },
              { key: "status", header: s.colStatus },
              { key: "action", header: s.colAction },
            ]}
            rows={quotationRows}
          />
        </div>
      </section>
    </main>
  );
}

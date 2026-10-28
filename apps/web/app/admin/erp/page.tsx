import { PageHeader } from "@/admin-shell/PageHeader";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { DeliveryCostsPanel } from "./delivery-costs-panel";
import { PurchaseLedgerPanel } from "./purchase-ledger-panel";
import { PayrollPanel } from "./payroll-panel";
import { ErpExportsPanel } from "./exports-panel";
import { accountByCode } from "@/erp/accounts";
import { erpStore, listSalesVatRows } from "@/erp/db-store";
import { accountBalances } from "@/erp/ledger";
import { buildVatReport } from "@/erp/vat";
import { ErpPeriodManager } from "@/components/admin/erp-period-manager";
import type { AccountType, JournalEntry } from "@/erp/types";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { ERP_STRINGS, type ErpStrings } from "./strings";

// Admin > ERP-lite — Agent 20, Step 49 (A16) UI over Agent 17's ledger;
// real data wired 2026-10-25. Accounts, journal entries and periods are
// read from the Prisma erpStore (ErpAccount / ErpJournalEntry /
// ErpJournalLine / ErpPeriod — the same store POST
// /api/v1/admin/modules/erp-journal serves); balances are computed with
// the real accountBalances() over the persisted entries. Posted entries
// are append-only in the store (corrections happen via reversal).
//
// VAT — sales side wired in wave 7: order creation records a VAT
// split on the Order row (vatPoisha + vatRateBps, migration
// 20261025112500_b2b_credit_dates_and_order_vat) ONLY while a rate is
// configured in Settings (accounting.vat_rate_bps); the card below
// renders buildVatReport over those recorded rows for the report
// period (latest accounting period, else the current Dhaka month).
// Purchase-side VAT is still not tracked — there is no purchase /
// invoice ledger in the system — and the card says so instead of
// netting a fabricated input figure. (Also pre-existing, unchanged
// here: this page and the erp-journal API gate on RBAC
// reports.accounting, not module.erp_lite.)

export const dynamic = "force-dynamic";

function accountTypeText(s: ErpStrings): Record<AccountType, string> {
  return {
    asset: s.typeAsset,
    liability: s.typeLiability,
    equity: s.typeEquity,
    income: s.typeIncome,
    expense: s.typeExpense,
  };
}

function statusText(s: ErpStrings): Record<JournalEntry["status"], { label: string; tone: "success" | "warning" | "neutral" }> {
  return {
    posted: { label: s.statusPosted, tone: "success" },
    draft: { label: s.statusDraft, tone: "warning" },
    reversed: { label: s.statusReversed, tone: "neutral" },
  };
}

/** Current accounting period ("YYYY-MM") on the Asia/Dhaka calendar. */
function currentDhakaPeriod(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}`;
}

function entryTotals(entry: JournalEntry): { debit: number; credit: number } {
  return {
    debit: entry.lines.reduce((s, l) => s + l.debitPoisha, 0),
    credit: entry.lines.reduce((s, l) => s + l.creditPoisha, 0),
  };
}

export default async function AdminErpPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, ERP_STRINGS);
  const ACCOUNT_TYPE_TEXT = accountTypeText(s);
  const STATUS_TEXT = statusText(s);
  const [accounts, entries, periods] = await Promise.all([
    erpStore.listAccounts(),
    erpStore.listEntries(),
    erpStore.listPeriods(),
  ]);
  const balances = accountBalances(entries);
  // VAT report period: the latest accounting period on record, else
  // the current Dhaka month. Rows are the orders carrying a recorded
  // VAT split; buildVatReport applies the exact date-range filter.
  const vatPeriod = periods.length > 0 ? (periods[periods.length - 1] as { period: string }).period : currentDhakaPeriod();
  const [vatYear, vatMonth] = vatPeriod.split("-").map(Number);
  const vatFrom = `${vatPeriod}-01`;
  const vatLastDay = new Date(Date.UTC(vatYear as number, vatMonth as number, 0)).getUTCDate();
  const vatTo = `${vatPeriod}-${String(vatLastDay).padStart(2, "0")}`;
  const vatRows = await listSalesVatRows(vatFrom, vatTo);
  const vatRowsInPeriod = vatRows.filter((r) => r.date >= vatFrom && r.date <= vatTo);
  const vatReport = vatRowsInPeriod.length > 0 ? buildVatReport(vatRows, vatFrom, vatTo) : null;
  const postedCount = entries.filter((e) => e.status === "posted").length;
  const draftCount = entries.filter((e) => e.status === "draft").length;
  const trialDebit = balances.reduce((s, b) => s + b.debitPoisha, 0);
  const trialCredit = balances.reduce((s, b) => s + b.creditPoisha, 0);

  const accountRows = accounts.map((a) => ({
    code: <span className="tnum font-mono">{a.code}</span>,
    name: (
      <span>
        {a.nameBn} <span className="text-text-muted">({a.nameEn})</span>
      </span>
    ),
    type: <Badge tone="info">{ACCOUNT_TYPE_TEXT[a.type]}</Badge>,
    active: a.isActive ? <Badge tone="success">{s.active}</Badge> : <Badge tone="neutral">{s.inactive}</Badge>,
  }));

  const entryRows = entries.map((e) => {
    const totals = entryTotals(e);
    const status = STATUS_TEXT[e.status];
    return {
      date: <span className="tnum font-mono text-xs">{e.date}</span>,
      description: (
        <span>
          <span className="font-medium">{e.description}</span>
          <span className="block text-xs text-text-muted">
            {e.lines
              .map((l) => `${l.accountCode} ${l.debitPoisha > 0 ? interpolate(s.lineDebit, { amount: l.debitPoisha }) : interpolate(s.lineCredit, { amount: l.creditPoisha })}`)
              .join(" · ")}
          </span>
        </span>
      ),
      source: (
        <span className="font-mono text-xs">
          {e.sourceKind}
          {e.sourceId ? ` / ${e.sourceId}` : ""}
        </span>
      ),
      status: <Badge tone={status.tone}>{status.label}</Badge>,
      debit: <Money poisha={totals.debit} />,
      credit: <Money poisha={totals.credit} />,
    };
  });

  const balanceRows = balances.map((b) => {
    const account = accountByCode(accounts, b.accountCode);
    return {
      code: <span className="tnum font-mono">{b.accountCode}</span>,
      name: account ? `${account.nameBn} (${account.nameEn})` : b.accountCode,
      debit: <Money poisha={b.debitPoisha} />,
      credit: <Money poisha={b.creditPoisha} />,
      balance: <Money poisha={b.balancePoisha} />,
    };
  });

  const periodRows = periods.map((p) => ({
    period: <span className="tnum font-mono">{p.period}</span>,
    state: p.isLocked ? <Badge tone="danger">{s.periodLocked}</Badge> : <Badge tone="success">{s.periodOpen}</Badge>,
    note: p.isLocked ? s.periodLockedNote : s.periodOpenNote,
  }));

  return (
    <main className="space-y-6">
      <PageHeader
        title={s.title}
        subtitle={s.description}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={s.statAccounts} value={String(accounts.length)} delta={s.statAccountsDelta} icon={<Icon name="chart" size={22} />} />
        <StatCard label={s.statPosted} value={String(postedCount)} delta={interpolate(s.statPostedDelta, { total: entries.length })} icon={<Icon name="check" size={22} />} />
        <StatCard label={s.statDraft} value={String(draftCount)} delta={s.statDraftDelta} icon={<Icon name="clock" size={22} />} />
        <StatCard label={s.statTrialDebit} value={trialDebit.toLocaleString("en-US")} delta={s.statTrialDelta} icon={<Icon name="chart" size={22} />} />
      </div>

      {entries.length === 0 ? (
        <EmptyState title={s.entriesEmptyTitle} description={s.entriesEmptyDesc} />
      ) : null}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">{s.journalTitle}</h2>
        <div className="space-y-3 md:hidden">
          {entryRows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                {r.date}
                {r.status}
              </div>
              {r.description}
              <p>{r.source}</p>
              <div className="grid grid-cols-2 gap-2 border-t border-border pt-2 text-sm">
                <span>
                  <span className="block text-xs text-text-muted">{s.colDebit}</span>
                  {r.debit}
                </span>
                <span>
                  <span className="block text-xs text-text-muted">{s.colCredit}</span>
                  {r.credit}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden md:block">
          <DataTable
            caption={s.journalCaption}
            columns={[
              { key: "date", header: s.colDate },
              { key: "description", header: s.colDescLines },
              { key: "source", header: s.colSource },
              { key: "status", header: s.colStatus },
              { key: "debit", header: s.colDebit },
              { key: "credit", header: s.colCredit },
            ]}
            rows={entryRows}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">{s.trialTitle}</h2>
        <div className="space-y-3 md:hidden">
          {balanceRows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                {r.code}
                <span className="text-sm">{r.name}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 border-t border-border pt-2 text-sm">
                <span>
                  <span className="block text-xs text-text-muted">{s.colDebit}</span>
                  {r.debit}
                </span>
                <span>
                  <span className="block text-xs text-text-muted">{s.colCredit}</span>
                  {r.credit}
                </span>
                <span>
                  <span className="block text-xs text-text-muted">{s.colBalance}</span>
                  {r.balance}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden md:block">
          <DataTable
            caption={interpolate(s.trialCaption, { debit: trialDebit.toLocaleString("en-US"), credit: trialCredit.toLocaleString("en-US") })}
            columns={[
              { key: "code", header: s.colCode },
              { key: "name", header: s.colAccount },
              { key: "debit", header: s.colDebit },
              { key: "credit", header: s.colCredit },
              { key: "balance", header: s.colBalance },
            ]}
            rows={balanceRows}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="font-display text-base font-semibold">{s.vatTitle}</h3>
          <p className="tnum mt-1 font-mono text-xs text-text-muted">
            {interpolate(s.vatPeriodLine, { from: vatFrom, to: vatTo })}
          </p>
          {vatReport ? (
            <>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-text-muted">{s.vatOutput}</dt>
                  <dd><Money poisha={vatReport.outputVatPoisha} /></dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-text-muted">{s.vatSalesNet}</dt>
                  <dd><Money poisha={vatReport.salesNetPoisha} /></dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2 font-medium">
                  <dt>{s.vatNetPayable}</dt>
                  <dd><Money poisha={vatReport.netPayablePoisha} /></dd>
                </div>
              </dl>
              {vatReport.byRate.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm text-text-muted">
                  {vatReport.byRate.map((r) => (
                    <li key={r.vatRateBps} className="flex items-baseline justify-between gap-4">
                      <span>{interpolate(s.vatRateLine, { rate: r.vatRateBps / 100 })}</span>
                      <Money poisha={r.salesVatPoisha} />
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-3 text-sm text-text-muted">
                {s.vatInputNote}
              </p>
            </>
          ) : (
            <>
              <div className="mt-2">
                <EmptyState title={s.vatEmptyTitle} description={s.vatEmptyDesc} />
              </div>
            </>
          )}
        </Card>

        <div>
          <ErpPeriodManager
            initialPeriods={periods.map((p) => ({
              code: p.period,
              lockedAt: p.isLocked ? p.lockedAt || new Date().toISOString() : null,
            }))}
          />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">{s.chartTitle}</h2>
        <div className="space-y-3 md:hidden">
          {accountRows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                {r.code}
                {r.active}
              </div>
              <p className="text-sm">{r.name}</p>
              <p>{r.type}</p>
            </div>
          ))}
        </div>
        <div className="hidden md:block">
          <DataTable
            caption={s.chartCaption}
            columns={[
              { key: "code", header: s.colCode },
              { key: "name", header: s.colAccountName },
              { key: "type", header: s.colType },
              { key: "active", header: s.colActiveStatus },
            ]}
            rows={accountRows}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold">{s.failedDeliveryTitle}</h2>
        <DeliveryCostsPanel />
      </section>

      <PurchaseLedgerPanel />

      <PayrollPanel />

      <ErpExportsPanel />
    </main>
  );
}

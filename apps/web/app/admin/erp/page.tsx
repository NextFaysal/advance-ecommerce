import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Icon } from "@/components/ui/icon";
import { DeliveryCostsPanel } from "./delivery-costs-panel";
import { accountByCode } from "@/erp/accounts";
import { erpStore, listSalesVatRows } from "@/erp/db-store";
import { accountBalances } from "@/erp/ledger";
import { buildVatReport } from "@/erp/vat";
import type { AccountType, JournalEntry } from "@/erp/types";

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

const ACCOUNT_TYPE_TEXT: Record<AccountType, string> = {
  asset: "সম্পদ",
  liability: "দায়",
  equity: "মূলধন",
  income: "আয়",
  expense: "ব্যয়",
};

const STATUS_TEXT: Record<JournalEntry["status"], { label: string; tone: "success" | "warning" | "neutral" }> = {
  posted: { label: "পোস্ট করা", tone: "success" },
  draft: { label: "খসড়া", tone: "warning" },
  reversed: { label: "রিভার্স করা", tone: "neutral" },
};

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
    code: <span className="font-mono">{a.code}</span>,
    name: (
      <span>
        {a.nameBn} <span className="text-text-muted">({a.nameEn})</span>
      </span>
    ),
    type: <Badge tone="info">{ACCOUNT_TYPE_TEXT[a.type]}</Badge>,
    active: a.isActive ? <Badge tone="success">সক্রিয়</Badge> : <Badge tone="neutral">বন্ধ</Badge>,
  }));

  const entryRows = entries.map((e) => {
    const totals = entryTotals(e);
    const status = STATUS_TEXT[e.status];
    return {
      date: <span className="font-mono text-xs">{e.date}</span>,
      description: (
        <span>
          <span className="font-medium">{e.description}</span>
          <span className="block text-xs text-text-muted">
            {e.lines
              .map((l) => `${l.accountCode} ${l.debitPoisha > 0 ? `ডেবিট ${l.debitPoisha}` : `ক্রেডিট ${l.creditPoisha}`}`)
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
      code: <span className="font-mono">{b.accountCode}</span>,
      name: account ? `${account.nameBn} (${account.nameEn})` : b.accountCode,
      debit: <Money poisha={b.debitPoisha} />,
      credit: <Money poisha={b.creditPoisha} />,
      balance: <Money poisha={b.balancePoisha} />,
    };
  });

  const periodRows = periods.map((p) => ({
    period: <span className="font-mono">{p.period}</span>,
    state: p.isLocked ? <Badge tone="danger">লক করা</Badge> : <Badge tone="success">খোলা</Badge>,
    note: p.isLocked ? "লক করা পিরিয়ডে নতুন এন্ট্রি পোস্ট করা যায় না" : "এন্ট্রি পোস্ট করা যাবে",
  }));

  return (
    <main>
      <PageHeader
        title="ERP-lite হিসাবরক্ষণ"
        description="আসল ডেটা — হিসাব, জার্নাল এন্ট্রি ও পিরিয়ড ডাটাবেস থেকে (erp-journal API-র একই স্টোর)। পোস্ট করা এন্ট্রি অপরিবর্তনীয়; সংশোধন রিভার্সাল দিয়ে হয়।"
        breadcrumb="Admin / Modules / ERP-lite"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="হিসাবের সংখ্যা" value={String(accounts.length)} delta="ErpAccount টেবিল" icon={<Icon name="chart" size={22} />} />
        <StatCard label="পোস্ট করা এন্ট্রি" value={String(postedCount)} delta={`${entries.length}টির মধ্যে`} icon={<Icon name="check" size={22} />} />
        <StatCard label="খসড়া এন্ট্রি" value={String(draftCount)} delta="এখনো পোস্ট হয়নি" icon={<Icon name="clock" size={22} />} />
        <StatCard label="ট্রায়াল ব্যালেন্স (ডেবিট)" value={trialDebit.toLocaleString("en-US")} delta="পয়সায়" icon={<Icon name="chart" size={22} />} />
      </div>

      {entries.length === 0 ? (
        <p className="mb-6 rounded-md bg-surface-2 px-3 py-2 text-sm text-text-muted">
          এখনো কোনো জার্নাল এন্ট্রি সংরক্ষিত হয়নি — erp-journal API দিয়ে প্রথম এন্ট্রি পোস্ট হলেই এখানে
          দেখা যাবে। নিচের তালিকাগুলো খালি কারণ টেবিল খালি, নমুনা ডেটা নয়।
        </p>
      ) : null}

      <h2 className="mb-3 text-lg font-semibold">জার্নাল এন্ট্রি</h2>
      <DataTable
        caption="পোস্ট করা এন্ট্রি অপরিবর্তনীয় — সংশোধন হয় রিভার্সাল এন্ট্রি দিয়ে। সব পরিমাণ পয়সায় (Money)।"
        columns={[
          { key: "date", header: "তারিখ" },
          { key: "description", header: "বিবরণ ও লাইন" },
          { key: "source", header: "উৎস" },
          { key: "status", header: "অবস্থা" },
          { key: "debit", header: "ডেবিট" },
          { key: "credit", header: "ক্রেডিট" },
        ]}
        rows={entryRows}
      />

      <h2 className="mb-3 mt-8 text-lg font-semibold">ট্রায়াল ব্যালেন্স (শুধু পোস্ট করা এন্ট্রি)</h2>
      <DataTable
        caption={`মোট ডেবিট ${trialDebit.toLocaleString("en-US")} পয়সা · মোট ক্রেডিট ${trialCredit.toLocaleString("en-US")} পয়সা — দ্বি-পক্ষীয় নিয়মে দুটো সবসময় সমান`}
        columns={[
          { key: "code", header: "কোড" },
          { key: "name", header: "হিসাব" },
          { key: "debit", header: "ডেবিট" },
          { key: "credit", header: "ক্রেডিট" },
          { key: "balance", header: "ব্যালেন্স (ডেবিট − ক্রেডিট)" },
        ]}
        rows={balanceRows}
      />

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="text-base font-semibold">VAT সারাংশ — বিক্রয় (Sales VAT)</h3>
          <p className="mt-1 font-mono text-xs text-text-muted">
            পিরিয়ড: {vatFrom} → {vatTo} · উৎস: অর্ডারে সংরক্ষিত VAT বিভাজন (vatPoisha / vatRateBps)
          </p>
          {vatReport ? (
            <>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-text-muted">আউটপুট VAT (বিক্রয়ে আদায়)</dt>
                  <dd><Money poisha={vatReport.outputVatPoisha} /></dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-text-muted">বিক্রয়ের নিট (VAT ছাড়া)</dt>
                  <dd><Money poisha={vatReport.salesNetPoisha} /></dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2 font-medium">
                  <dt>নিট প্রদেয় (শুধু বিক্রয় VAT থেকে)</dt>
                  <dd><Money poisha={vatReport.netPayablePoisha} /></dd>
                </div>
              </dl>
              {vatReport.byRate.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm text-text-muted">
                  {vatReport.byRate.map((r) => (
                    <li key={r.vatRateBps} className="flex items-baseline justify-between gap-4">
                      <span>হার {r.vatRateBps / 100}% — বিক্রয় VAT</span>
                      <Money poisha={r.salesVatPoisha} />
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-3 text-sm text-text-muted">
                ইনপুট VAT (ক্রয়): এই সিস্টেমে ক্রয়/ইনভয়েসের কোনো লেজার নেই — তাই ইনপুট VAT
                হিসাবের বাইরে এবং ওপরের নিট প্রদেয় থেকে কোনো ক্রয় VAT বাদ দেওয়া হয়নি।
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-text-muted">
                এই পিরিয়ডে VAT বিভাজনসহ কোনো অর্ডার নেই। VAT বিভাজন রেকর্ড হয় অর্ডার তৈরির
                সময় — শুধুমাত্র যখন Settings-এ <code className="font-mono text-xs">accounting.vat_rate_bps</code>{" "}
                হার সেট করা থাকে। হার সেট করার আগের অর্ডারগুলোতে কোনো বিভাজন নেই, এবং পরে তা
                অনুমান করে বসানো হয় না — তাই হার সেট করে নতুন অর্ডার এলেই এখানে আসল সংখ্যা
                দেখা যাবে।
              </p>
              <p className="mt-2 text-sm text-text-muted">
                ক্রয় দিকের VAT-এর জন্য ক্রয়/ইনভয়েস লেজার প্রয়োজন — এই সিস্টেমে সেটি এখনো নেই,
                তাই এই রিপোর্ট শুধু বিক্রয়ের।
              </p>
            </>
          )}
        </Card>

        <div>
          <h3 className="mb-3 text-base font-semibold">হিসাব পিরিয়ড</h3>
          {periods.length > 0 ? (
            <DataTable
              caption="পিরিয়ড লক — ErpPeriod টেবিল থেকে"
              columns={[
                { key: "period", header: "পিরিয়ড" },
                { key: "state", header: "অবস্থা" },
                { key: "note", header: "মন্তব্য" },
              ]}
              rows={periodRows}
            />
          ) : (
            <p className="text-sm text-text-muted">
              কোনো পিরিয়ড রেকর্ড নেই — পিরিয়ড তৈরি/লক হয় erp-journal API দিয়ে।
            </p>
          )}
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">হিসাবের চার্ট (Chart of Accounts)</h2>
      <DataTable
        caption="বাংলাদেশি SME ডিফল্ট চার্ট — কোডই স্থিতিশীল কী; VAT দেনা (২১০০) নিজস্ব দায় হিসাব যাতে VAT রিপোর্ট মিলে যায়"
        columns={[
          { key: "code", header: "কোড" },
          { key: "name", header: "হিসাবের নাম" },
          { key: "type", header: "ধরন" },
          { key: "active", header: "অবস্থা" },
        ]}
        rows={accountRows}
      />

      <h2 className="mb-3 mt-8 text-lg font-semibold">ব্যর্থ ডেলিভারির খরচ (Failed-delivery costs)</h2>
      <DeliveryCostsPanel />
    </main>
  );
}

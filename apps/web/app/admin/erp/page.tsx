import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { DEFAULT_CHART_OF_ACCOUNTS, accountByCode } from "@/erp/accounts";
import {
  accountBalances,
  buildExpenseEntry,
  buildJournalEntry,
  buildSupplierPaymentEntry,
  postEntry,
} from "@/erp/ledger";
import { buildVatReport } from "@/erp/vat";
import type { AccountingPeriod, AccountType, JournalEntry, VatRow } from "@/erp/types";

// Admin > ERP-lite — Agent 20, Step 49 (A16) UI over Agent 17's ledger.
// TEMPORARY DEMO: journal entries are built at render time through the
// real builders in src/erp (buildJournalEntry enforces debit = credit,
// integer poisha, one-sided lines; postEntry enforces the period lock) —
// unbalanced entries cannot even be constructed. Nothing is persisted.
// Real wiring: entries/accounts/periods come from the modules ERP API
// (POST /api/v1/admin/modules/erp-journal exists) backed by Prisma
// tables, and orders/payments auto-post via sourceKind/sourceId.

const ACCOUNT_TYPE_TEXT: Record<AccountType, string> = {
  asset: "সম্পদ",
  liability: "দায়",
  equity: "মূলধন",
  income: "আয়",
  expense: "ব্যয়",
};

const STATUS_TEXT: Record<JournalEntry["status"], { label: string; tone: "success" | "warning" | "neutral" }> = {
  posted: { label: "✓ পোস্ট করা", tone: "success" },
  draft: { label: "◷ খসড়া", tone: "warning" },
  reversed: { label: "↩ রিভার্স করা", tone: "neutral" },
};

const DEMO_PERIODS: AccountingPeriod[] = [
  { period: "2026-09", isLocked: true, lockedAt: "2026-10-05T09:00:00.000Z", lockedById: "demo-owner" },
  { period: "2026-10", isLocked: false, lockedAt: null, lockedById: null },
];

function buildDemoEntries(): JournalEntry[] {
  const now = new Date("2026-10-24T09:00:00.000Z");
  const sale = postEntry(
    buildJournalEntry(
      {
        date: "2026-10-24",
        description: "নগদ বিক্রয় — ডেমো অর্ডার DEMO-1001",
        lines: [
          { accountCode: "1000", debitPoisha: 450000, creditPoisha: 0 },
          { accountCode: "4000", debitPoisha: 0, creditPoisha: 450000 },
        ],
        sourceKind: "order",
        sourceId: "DEMO-1001",
      },
      now,
    ),
    DEMO_PERIODS,
  );
  const rent = postEntry(
    buildExpenseEntry(
      {
        date: "2026-10-24",
        expenseAccountCode: "5200",
        paidFromAccountCode: "1000",
        amountPoisha: 1500000,
        vatPoisha: 0,
        description: "দোকান ভাড়া — অক্টোবর (ডেমো)",
      },
      now,
    ),
    DEMO_PERIODS,
  );
  const packaging = postEntry(
    buildExpenseEntry(
      {
        date: "2026-10-23",
        expenseAccountCode: "5500",
        paidFromAccountCode: "1000",
        amountPoisha: 100000,
        vatPoisha: 15000,
        description: "প্যাকেজিং সামগ্রী ক্রয়, VATসহ (ডেমো)",
      },
      now,
    ),
    DEMO_PERIODS,
  );
  const supplier = postEntry(
    buildSupplierPaymentEntry(
      {
        date: "2026-10-22",
        supplierId: "sup_demo_1",
        payableAccountCode: "2000",
        paidFromAccountCode: "1010",
        amountPoisha: 800000,
        purchaseOrderId: null,
      },
      now,
    ),
    DEMO_PERIODS,
  );
  const marketingDraft = buildJournalEntry(
    {
      date: "2026-10-24",
      description: "মার্কেটিং খরচ — এখনো পোস্ট হয়নি (ডেমো খসড়া)",
      lines: [
        { accountCode: "5400", debitPoisha: 200000, creditPoisha: 0 },
        { accountCode: "1020", debitPoisha: 0, creditPoisha: 200000 },
      ],
      sourceKind: "manual",
      sourceId: null,
    },
    now,
  );
  return [sale, rent, packaging, supplier, marketingDraft];
}

const DEMO_VAT_ROWS: VatRow[] = [
  { date: "2026-10-05", kind: "sale", netPoisha: 1000000, vatPoisha: 150000, vatRateBps: 1500 },
  { date: "2026-10-12", kind: "sale", netPoisha: 500000, vatPoisha: 75000, vatRateBps: 1500 },
  { date: "2026-10-08", kind: "purchase", netPoisha: 600000, vatPoisha: 90000, vatRateBps: 1500 },
];

function entryTotals(entry: JournalEntry): { debit: number; credit: number } {
  return {
    debit: entry.lines.reduce((s, l) => s + l.debitPoisha, 0),
    credit: entry.lines.reduce((s, l) => s + l.creditPoisha, 0),
  };
}

export default function AdminErpPage() {
  const accounts = DEFAULT_CHART_OF_ACCOUNTS;
  const entries = buildDemoEntries();
  const balances = accountBalances(entries);
  const postedCount = entries.filter((e) => e.status === "posted").length;
  const trialDebit = balances.reduce((s, b) => s + b.debitPoisha, 0);
  const trialCredit = balances.reduce((s, b) => s + b.creditPoisha, 0);
  const vat = buildVatReport(DEMO_VAT_ROWS, "2026-10-01", "2026-10-31");

  const accountRows = accounts.map((a) => ({
    code: <span className="font-mono">{a.code}</span>,
    name: (
      <span>
        {a.nameBn} <span className="text-text-muted">({a.nameEn})</span>
      </span>
    ),
    type: <Badge tone="info">{ACCOUNT_TYPE_TEXT[a.type]}</Badge>,
    active: a.isActive ? <Badge tone="success">✓ সক্রিয়</Badge> : <Badge tone="neutral">বন্ধ</Badge>,
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

  const vatRateRows = vat.byRate.map((r) => ({
    rate: `${(r.vatRateBps / 100).toFixed(0)}%`,
    salesVat: <Money poisha={r.salesVatPoisha} />,
    purchaseVat: <Money poisha={r.purchaseVatPoisha} />,
  }));

  const periodRows = DEMO_PERIODS.map((p) => ({
    period: <span className="font-mono">{p.period}</span>,
    state: p.isLocked ? <Badge tone="danger">🔒 লক করা</Badge> : <Badge tone="success">খোলা</Badge>,
    note: p.isLocked ? "লক করা পিরিয়ডে নতুন এন্ট্রি পোস্ট করা যায় না" : "এন্ট্রি পোস্ট করা যাবে",
  }));

  return (
    <main>
      <PageHeader
        title="ERP-lite হিসাবরক্ষণ"
        description="TEMPORARY DEMO — এন্ট্রিগুলো আসল ledger builder দিয়ে তৈরি; ডেবিট = ক্রেডিট না হলে এন্ট্রি তৈরি-ই হয় না। কিছুই সংরক্ষিত হয়নি।"
        breadcrumb="Admin / Modules / ERP-lite"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="হিসাবের সংখ্যা" value={String(accounts.length)} delta="ডিফল্ট চার্ট" icon="📒" />
        <StatCard label="পোস্ট করা এন্ট্রি" value={String(postedCount)} delta={`${entries.length}টির মধ্যে`} icon="✓" />
        <StatCard label="ট্রায়াল ব্যালেন্স (ডেবিট)" value={trialDebit.toLocaleString("en-US")} delta="পয়সায়" icon="⚖" />
        <StatCard label="নিট VAT দেনা" value={vat.netPayablePoisha.toLocaleString("en-US")} delta="পয়সায় · অক্টোবর" icon="৳" />
      </div>

      <h2 className="mb-3 text-lg font-semibold">জার্নাল এন্ট্রি (ডেমো)</h2>
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
          <h3 className="text-base font-semibold">VAT সারাংশ — অক্টোবর ২০২৬ (ডেমো)</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">বিক্রয়ের নিট পরিমাণ</dt>
              <dd><Money poisha={vat.salesNetPoisha} /></dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">আউটপুট VAT (বিক্রয়ে সংগৃহীত)</dt>
              <dd><Money poisha={vat.outputVatPoisha} /></dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">ক্রয়ের নিট পরিমাণ</dt>
              <dd><Money poisha={vat.purchaseNetPoisha} /></dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">ইনপুট VAT (ক্রয়ে প্রদত্ত, দাবিযোগ্য)</dt>
              <dd><Money poisha={vat.inputVatPoisha} /></dd>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2 font-medium">
              <dt>নিট VAT দেনা (আউটপুট − ইনপুট)</dt>
              <dd><Money poisha={vat.netPayablePoisha} /></dd>
            </div>
          </dl>
          <div className="mt-4">
            <DataTable
              caption="হার অনুযায়ী বিভাজন"
              columns={[
                { key: "rate", header: "VAT হার" },
                { key: "salesVat", header: "বিক্রয় VAT" },
                { key: "purchaseVat", header: "ক্রয় VAT" },
              ]}
              rows={vatRateRows}
            />
          </div>
        </Card>

        <div>
          <h3 className="mb-3 text-base font-semibold">হিসাব পিরিয়ড</h3>
          <DataTable
            caption="পিরিয়ড লক (ডেমো)"
            columns={[
              { key: "period", header: "পিরিয়ড" },
              { key: "state", header: "অবস্থা" },
              { key: "note", header: "মন্তব্য" },
            ]}
            rows={periodRows}
          />
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
    </main>
  );
}

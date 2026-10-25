import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Icon } from "@/components/ui/icon";
import { accountByCode } from "@/erp/accounts";
import { erpStore } from "@/erp/db-store";
import { accountBalances } from "@/erp/ledger";
import type { AccountType, JournalEntry } from "@/erp/types";

// Admin > ERP-lite — Agent 20, Step 49 (A16) UI over Agent 17's ledger;
// real data wired 2026-10-25. Accounts, journal entries and periods are
// read from the Prisma erpStore (ErpAccount / ErpJournalEntry /
// ErpJournalLine / ErpPeriod — the same store POST
// /api/v1/admin/modules/erp-journal serves); balances are computed with
// the real accountBalances() over the persisted entries. Posted entries
// are append-only in the store (corrections happen via reversal).
//
// VAT — STILL NOT WIRED, and deliberately shows NO numbers: the VAT
// report builder (src/erp/vat.ts) needs per-row VAT splits
// {netPoisha, vatPoisha, vatRateBps} for sales and purchases, and no
// such data exists anywhere in the schema — Order rows carry totals
// only (no VAT split) and there is no purchase/invoice table for input
// VAT. The exact schema gap is stated in the VAT card below instead of
// demo rows. (Also pre-existing, unchanged here: this page and the
// erp-journal API gate on RBAC reports.accounting, not module.erp_lite.)

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
          <h3 className="text-base font-semibold">VAT সারাংশ — এখনো ডেটা উৎস নেই</h3>
          <p className="mt-2 text-sm text-text-muted">
            VAT রিপোর্ট বিল্ডার (<code className="font-mono text-xs">src/erp/vat.ts</code>) তৈরি আছে, কিন্তু
            তার ইনপুট — বিক্রয় ও ক্রয়ের সারি অনুযায়ী VAT বিভাজন (netPoisha, vatPoisha, vatRateBps) —
            এই সিস্টেমে কোথাও সংরক্ষিত হয় না: অর্ডার টেবিলে শুধু মোট টাকা থাকে (VAT বিভাজন নেই) এবং
            ক্রয়/ইনভয়েসের কোনো টেবিলই নেই। তাই এখানে কোনো সংখ্যা দেখানো হচ্ছে না — ডেমো সংখ্যা
            দেখানো হতো বিভ্রান্তিকর।
          </p>
          <p className="mt-2 text-sm text-text-muted">
            যা লাগবে: অর্ডার/ক্রয়ে VAT বিভাজনের কলাম (vatPoisha + vatRateBps) অথবা আলাদা VAT লেজার
            টেবিল — মাইগ্রেশন প্রয়োজন, এই পেজের কাজের বাইরে।
          </p>
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
    </main>
  );
}

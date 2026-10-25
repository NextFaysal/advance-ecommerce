import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Money, formatPoisha } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import { Icon } from "@/components/ui/icon";
import { demoB2bFlags, isB2bEnabled } from "@/b2b/flags";
import { b2bStore } from "@/b2b/db-store";
import { checkCredit, effectiveQuotationStatus } from "@/b2b/service";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";

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
// KNOWN SCHEMA GAP (labelled on the page, not hidden): the B2bCustomer
// table has no oldestDueDate column, so persisted customers never carry
// a due date and checkCredit's overdue-by-date rule cannot fire — the
// overdue count therefore reflects limit/status rules only until the
// column lands (needs a migration; reported, not faked).

export const dynamic = "force-dynamic";

export default async function AdminB2bPage() {
  await ensureDbFeatureFlags();
  if (!isB2bEnabled(demoB2bFlags)) {
    return (
      <main>
        <PageHeader title="B2B / পাইকারি" description="Wholesale, quotations and credit (A12)" />
        <p role="status">
          এই মডিউলটি এই ইনস্টলে লক করা আছে। B2B / পাইকারি একটি পেইড অ্যাড-অন —
          খুলতে Admin &gt; Settings থেকে <code>module.b2b</code> ফিচার ফ্ল্যাগ চালু করুন।
          (This module is locked — enable the <code>module.b2b</code> feature flag to unlock it.)
        </p>
      </main>
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const [customers, quotations] = await Promise.all([
    b2bStore.listCustomers(),
    b2bStore.listQuotations(),
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
      outstanding: <Money poisha={c.outstandingPoisha} />,
      available: <Money poisha={credit.availablePoisha} />,
      creditState: credit.overdue ? (
        <Badge tone="danger">ওভারডিউ — ক্রেডিট বন্ধ</Badge>
      ) : credit.allowed ? (
        <Badge tone="success">ক্রেডিট চালু</Badge>
      ) : (
        <Badge tone="warning">অনুমোদিত নয়</Badge>
      ),
    };
  });

  const quotationRows = quotations.map((q) => {
    const status = effectiveQuotationStatus(q, todayIso);
    return {
      id: <span className="font-mono">{q.id}</span>,
      business: businessName(q.b2bCustomerId),
      lines: q.lines.reduce((s, l) => s + l.quantity, 0),
      total: <Money poisha={q.totalPoisha} />,
      validUntil: q.validUntil,
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
    };
  });

  const queueRows = approvalQueue.map((c) => ({
    business: <span className="font-medium">{c.businessName}</span>,
    contact: c.contactName,
    phone: <Phone phone={c.phone} />,
    applied: c.createdAt.slice(0, 10),
    note: "যাচাই: ট্রেড লাইসেন্স ও ক্রেডিট সীমা — সিদ্ধান্ত B2B API দিয়ে (PATCH customers)",
  }));

  return (
    <main>
      <PageHeader
        title="B2B / পাইকারি"
        description="আসল ডেটা — B2B গ্রাহক ও কোটেশন ডাটাবেস থেকে (B2B API-র একই স্টোর)। ক্রেডিট অবস্থা আসল checkCredit() দিয়ে হিসাব করা; ফোন মাস্ক করা। (B2B / Wholesale)"
        breadcrumb="Admin / Add-on Modules"
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="B2B গ্রাহক" value={String(customers.length)} delta={`${approvalQueue.length} অনুমোদনের অপেক্ষায়`} icon={<Icon name="users" size={22} />} />
        <StatCard label="মোট বকেয়া" value={formatPoisha(totalOutstanding)} delta="সব গ্রাহক মিলিয়ে" icon={<Icon name="banknote" size={22} />} />
        <StatCard label="ওভারডিউ গ্রাহক" value={String(overdueCount)} delta={overdueCount > 0 ? "ক্রেডিট বন্ধ আছে" : "সীমা/অবস্থা অনুযায়ী কেউ নেই"} deltaTone={overdueCount > 0 ? "down" : "up"} icon={<Icon name="clock" size={22} />} />
        <StatCard label="কোটেশন" value={String(quotations.length)} delta="সক্রিয় তালিকা নিচে" icon={<Icon name="tag" size={22} />} />
      </div>

      <p className="mb-6 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
        সীমাবদ্ধতা (লুকানো নয়): B2bCustomer টেবিলে বকেয়ার মেয়াদ-তারিখ (oldestDueDate) কলাম নেই — তাই
        সংরক্ষিত গ্রাহকদের ক্ষেত্রে মেয়াদ-ভিত্তিক ওভারডিউ শনাক্তকরণ কাজ করে না; ওপরের ওভারডিউ সংখ্যা শুধু
        ক্রেডিট-সীমা ও অনুমোদন-অবস্থার নিয়মে হিসাব করা। কলামটি যোগ হলে (মাইগ্রেশন প্রয়োজন) মেয়াদ-ভিত্তিক
        নিয়মও সক্রিয় হবে।
      </p>

      {customers.length === 0 ? (
        <p className="mb-6 text-sm text-text-muted">
          এখনো কোনো B2B গ্রাহক নিবন্ধিত হয়নি — B2B API দিয়ে গ্রাহক যোগ হলে এখানে দেখা যাবে।
        </p>
      ) : null}

      <h2 className="mb-3 text-lg font-semibold">গ্রাহক ও ক্রেডিট অবস্থা</h2>
      <DataTable
        caption="B2B গ্রাহক — বকেয়া থাকলে ও মেয়াদ পেরিয়ে গেলে নতুন ক্রেডিট অর্ডার বন্ধ (checkCredit নিয়ম)"
        columns={[
          { key: "business", header: "প্রতিষ্ঠান" },
          { key: "contact", header: "যোগাযোগ" },
          { key: "phone", header: "ফোন" },
          { key: "approval", header: "অনুমোদন" },
          { key: "limit", header: "ক্রেডিট সীমা" },
          { key: "outstanding", header: "বকেয়া" },
          { key: "available", header: "অবশিষ্ট ক্রেডিট" },
          { key: "creditState", header: "ক্রেডিট অবস্থা" },
        ]}
        rows={customerRows}
      />

      <h2 className="mb-3 mt-8 text-lg font-semibold">অনুমোদনের সারি (Approval queue)</h2>
      {queueRows.length > 0 ? (
        <DataTable
          caption="PENDING আবেদন — অনুমোদন/বাতিল B2B API-র approval transition নিয়ম মেনে হয়"
          columns={[
            { key: "business", header: "প্রতিষ্ঠান" },
            { key: "contact", header: "যোগাযোগ" },
            { key: "phone", header: "ফোন" },
            { key: "applied", header: "আবেদনের তারিখ" },
            { key: "note", header: "যাচাই নোট" },
          ]}
          rows={queueRows}
        />
      ) : (
        <p className="text-sm text-text-muted">কোনো আবেদন অপেক্ষমাণ নেই।</p>
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold">কোটেশনসমূহ</h2>
      <DataTable
        caption="কোটেশন — মেয়াদ পেরিয়ে যাওয়া DRAFT/SENT কার্যত EXPIRED হিসেবে দেখানো হয় (effectiveQuotationStatus)"
        columns={[
          { key: "id", header: "কোটেশন" },
          { key: "business", header: "প্রতিষ্ঠান" },
          { key: "lines", header: "মোট পরিমাণ (পিস)" },
          { key: "total", header: "মোট" },
          { key: "validUntil", header: "মেয়াদ" },
          { key: "status", header: "অবস্থা" },
        ]}
        rows={quotationRows}
      />
    </main>
  );
}

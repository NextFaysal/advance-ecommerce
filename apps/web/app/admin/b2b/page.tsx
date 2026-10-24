import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Money, formatPoisha } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import { demoB2bFlags, isB2bEnabled } from "@/b2b/flags";
import { demoB2bStore } from "@/b2b/store";
import { checkCredit, effectiveQuotationStatus, quotationTotalPoisha } from "@/b2b/service";
import type { B2bCustomer, Quotation } from "@/b2b/types";

// B2B / Wholesale admin — Agent 25, Step 48 (A12).
// Locked state: while module.b2b is OFF (seeded default, paid add-on),
// the page renders the lock panel, matching the API's 403 FEATURE_LOCKED —
// the same pattern as riders / resellers. When unlocked, customers come
// from the Agent 16 demo store plus page-local SAMPLE rows (labelled);
// credit state is computed with the real checkCredit() and quotation
// status with effectiveQuotationStatus(). Phones are masked via <Phone>.

const SAMPLE_CUSTOMERS: B2bCustomer[] = [
  {
    id: "b2b_sample_overdue",
    businessName: "SAMPLE Dhaka Distributors",
    contactName: "Demo Manager",
    phone: "+8801700000011",
    approvalStatus: "APPROVED",
    creditLimitPoisha: 100000000,
    outstandingPoisha: 25000000,
    oldestDueDate: "2026-10-01",
    createdAt: "2026-09-15T00:00:00.000Z",
  },
  {
    id: "b2b_sample_clear",
    businessName: "SAMPLE Chattogram Traders",
    contactName: "Demo Owner",
    phone: "+8801700000012",
    approvalStatus: "APPROVED",
    creditLimitPoisha: 50000000,
    outstandingPoisha: 0,
    createdAt: "2026-09-20T00:00:00.000Z",
  },
  {
    id: "b2b_sample_suspended",
    businessName: "SAMPLE Khulna Supply Co",
    contactName: "Demo Contact",
    phone: "+8801700000013",
    approvalStatus: "SUSPENDED",
    creditLimitPoisha: 20000000,
    outstandingPoisha: 5000000,
    oldestDueDate: "2026-11-01",
    createdAt: "2026-08-30T00:00:00.000Z",
  },
];

const SAMPLE_QUOTATIONS: Quotation[] = [
  {
    id: "quo_sample_sent",
    b2bCustomerId: "b2b_sample_clear",
    lines: [
      { variantId: "var_sample_1", sku: "SAMPLE-SKU-1", productName: "SAMPLE Product A", quantity: 50, unitPricePoisha: 45000 },
      { variantId: "var_sample_2", sku: "SAMPLE-SKU-2", productName: "SAMPLE Product B", quantity: 20, unitPricePoisha: 120000 },
    ],
    totalPoisha: 0, // computed below with quotationTotalPoisha
    status: "SENT",
    validUntil: "2027-01-31",
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  },
  {
    id: "quo_sample_accepted",
    b2bCustomerId: "b2b_sample_overdue",
    lines: [
      { variantId: "var_sample_3", sku: "SAMPLE-SKU-3", productName: "SAMPLE Product C", quantity: 100, unitPricePoisha: 30000 },
    ],
    totalPoisha: 0,
    status: "ACCEPTED",
    validUntil: "2027-02-28",
    createdAt: "2026-10-10T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
  },
  {
    id: "quo_sample_stale",
    b2bCustomerId: "b2b_sample_clear",
    lines: [
      { variantId: "var_sample_1", sku: "SAMPLE-SKU-1", productName: "SAMPLE Product A", quantity: 10, unitPricePoisha: 47000 },
    ],
    totalPoisha: 0,
    status: "DRAFT",
    validUntil: "2026-01-31", // past → effectiveQuotationStatus reads EXPIRED
    createdAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-01-10T00:00:00.000Z",
  },
];

export default function AdminB2bPage() {
  if (!isB2bEnabled(demoB2bFlags)) {
    return (
      <main>
        <PageHeader title="B2B / পাইকারি" description="Wholesale, quotations and credit (A12)" />
        <p role="status">
          🔒 এই মডিউলটি এই ইনস্টলে লক করা আছে। B2B / পাইকারি একটি পেইড অ্যাড-অন —
          খুলতে Admin &gt; Settings থেকে <code>module.b2b</code> ফিচার ফ্ল্যাগ চালু করুন।
          (This module is locked — enable the <code>module.b2b</code> feature flag to unlock it.)
        </p>
      </main>
    );
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const customers: B2bCustomer[] = [...demoB2bStore.listCustomers(), ...SAMPLE_CUSTOMERS];
  const quotations: Quotation[] = [
    ...demoB2bStore.listQuotations(),
    ...SAMPLE_QUOTATIONS.map((q) => ({ ...q, totalPoisha: quotationTotalPoisha(q.lines) })),
  ];
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
        description="TEMPORARY DEMO — ডেমো স্টোর + নমুনা (SAMPLE) সারি। ক্রেডিট অবস্থা আসল checkCredit() দিয়ে হিসাব করা; ফোন মুখোশ করা। (B2B / Wholesale)"
        breadcrumb="Admin / Add-on Modules"
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="B2B গ্রাহক (ডেমো)" value={String(customers.length)} delta={`${approvalQueue.length} অনুমোদনের অপেক্ষায়`} icon="🏢" />
        <StatCard label="মোট বকেয়া" value={formatPoisha(totalOutstanding)} delta="ডেমো" icon="৳" />
        <StatCard label="ওভারডিউ গ্রাহক" value={String(overdueCount)} delta={overdueCount > 0 ? "ক্রেডিট বন্ধ আছে" : "কেউ নেই"} deltaTone={overdueCount > 0 ? "down" : "up"} icon="⏰" />
        <StatCard label="কোটেশন (ডেমো)" value={String(quotations.length)} delta="সক্রিয় তালিকা নিচে" icon="📄" />
      </div>

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

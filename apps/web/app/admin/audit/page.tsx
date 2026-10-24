import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";

// Audit Log admin — Agent 27.
// Permission behind this page: audit.view (see src/lib/rbac.ts).
// Rows below are SAMPLE rows shaped exactly like the audit records that
// src/lib/audit.ts writes (AuditInput: actorId, action, entityType,
// entityId, before/after, reason, ip, userAgent + row id/createdAt) —
// fictional actors and entities, demo-labelled, no real log data.
// Sensitive actions mirror SENSITIVE_ACTIONS in src/lib/audit.ts: they
// REQUIRE a reason, and their reason cell is highlighted below.
// Real wiring (later): getAuditLogs() in src/lib/audit.ts over the
// AuditLog table, with the filters here driving its query.

interface SampleAuditRow {
  id: string;
  actor: string; // display label for AuditInput.actorId
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  time: string; // Asia/Dhaka display string (sample)
}

/** Mirror of SENSITIVE_ACTIONS in src/lib/audit.ts (kept local so this
 *  page does not import the Prisma-coupled audit module). */
const SENSITIVE_ACTION_SET: ReadonlySet<string> = new Set([
  "orders.delete",
  "orders.refund",
  "payments.refund",
  "products.delete",
  "products.price_change",
  "customers.view_full_phone",
  "customers.export",
  "orders.export",
  "settings.update",
  "staff.manage",
  "roles.manage",
  "feature_flags.manage",
]);

const SAMPLE_ROWS: SampleAuditRow[] = [
  {
    id: "aud_sample_01",
    actor: "SAMPLE ম্যানেজার",
    action: "orders.update_status",
    entityType: "Order",
    entityId: "ord_sample_100245",
    reason: null,
    time: "২৪ অক্টোবর ২০২৬, ১১:৪২",
  },
  {
    id: "aud_sample_02",
    actor: "SAMPLE ম্যানেজার",
    action: "customers.view_full_phone",
    entityType: "Customer",
    entityId: "cus_sample_0091",
    reason: "কুরিয়ার ডেলিভারি সমস্যায় গ্রাহককে কল করা দরকার ছিল",
    time: "২৪ অক্টোবর ২০২৬, ১১:৩৫",
  },
  {
    id: "aud_sample_03",
    actor: "SAMPLE মালিক",
    action: "products.price_change",
    entityType: "Product",
    entityId: "prd_sample_0312",
    reason: "অফার ক্যাম্পেইনের জন্য দাম হালনাগাদ",
    time: "২৪ অক্টোবর ২০২৬, ১০:১৮",
  },
  {
    id: "aud_sample_04",
    actor: "SAMPLE হিসাবরক্ষক",
    action: "payments.refund",
    entityType: "Payment",
    entityId: "pay_sample_7781",
    reason: "ডুপ্লিকেট পেমেন্ট — গ্রাহকের অনুরোধে রিফান্ড",
    time: "২৪ অক্টোবর ২০২৬, ০৯:৫৭",
  },
  {
    id: "aud_sample_05",
    actor: "SAMPLE ম্যানেজার",
    action: "products.create",
    entityType: "Product",
    entityId: "prd_sample_0313",
    reason: null,
    time: "২৩ অক্টোবর ২০২৬, ১৭:২০",
  },
  {
    id: "aud_sample_06",
    actor: "SAMPLE মালিক",
    action: "settings.update",
    entityType: "Setting",
    entityId: "payment.bkash.enabled",
    reason: "bKash মার্চেন্ট অ্যাকাউন্ট যাচাই শেষে চালু করা হলো",
    time: "২৩ অক্টোবর ২০২৬, ১৫:০৯",
  },
  {
    id: "aud_sample_07",
    actor: "SAMPLE মালিক",
    action: "orders.export",
    entityType: "Order",
    entityId: "export_sample_0042",
    reason: "মাসিক হিসাব মেলানোর জন্য এক্সপোর্ট",
    time: "২৩ অক্টোবর ২০২৬, ১২:৩০",
  },
  {
    id: "aud_sample_08",
    actor: "SAMPLE মালিক",
    action: "feature_flags.manage",
    entityType: "FeatureFlag",
    entityId: "module.rider",
    reason: "নিজস্ব রাইডার পাইলট চালুর প্রস্তুতি (ডেমো সারি — আসলে বদলায়নি)",
    time: "২২ অক্টোবর ২০২৬, ১৯:৪৫",
  },
];

export default function AdminAuditPage() {
  const sensitiveCount = SAMPLE_ROWS.filter((r) => SENSITIVE_ACTION_SET.has(r.action)).length;
  const withReason = SAMPLE_ROWS.filter((r) => r.reason !== null && r.reason.trim() !== "").length;

  const rows = SAMPLE_ROWS.map((r) => {
    const sensitive = SENSITIVE_ACTION_SET.has(r.action);
    return {
      time: <span className="whitespace-nowrap">{r.time}</span>,
      actor: <span className="font-medium">{r.actor}</span>,
      action: (
        <span className="inline-flex items-center gap-2">
          <span className="font-mono text-xs">{r.action}</span>
          {sensitive ? <Badge tone="warning">সংবেদনশীল</Badge> : null}
        </span>
      ),
      entity: (
        <span className="font-mono text-xs">
          {r.entityType} · {r.entityId}
        </span>
      ),
      reason: sensitive ? (
        <span className="block rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
          কারণ আবশ্যক: {r.reason ?? "—"}
        </span>
      ) : r.reason !== null ? (
        <span className="text-xs">{r.reason}</span>
      ) : (
        <span className="text-xs text-text-subtle">প্রযোজ্য নয়</span>
      ),
    };
  });

  return (
    <main>
      <PageHeader
        title="অডিট লগ"
        description="TEMPORARY DEMO — নিচের সারিগুলো src/lib/audit.ts-এর রেকর্ড আকারে সাজানো কাল্পনিক SAMPLE তথ্য; কোনো আসল লগ নয়। (Audit Log — audit.view)"
        breadcrumb="Admin / System"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="লগ এন্ট্রি (ডেমো)" value={String(SAMPLE_ROWS.length)} delta="নমুনা সারি" icon="📜" />
        <StatCard label="সংবেদনশীল কাজ" value={String(sensitiveCount)} delta="কারণ আবশ্যক" deltaTone="down" icon="⚠️" />
        <StatCard label="কারণসহ এন্ট্রি" value={String(withReason)} delta="সংবেদনশীল কাজে বাধ্যতামূলক" icon="✍️" />
        <StatCard label="রিটেনশন" value="স্থায়ী" delta="লগ মুছে ফেলা যায় না" icon="🔒" />
      </div>

      <Card className="mb-6">
        <p className="mb-3 text-sm font-medium">ফিল্টার (আউটলাইন — এখনো কার্যকর নয়)</p>
        <FilterBar chips={["Entity: Order", "Action: payments.refund"]} />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Input name="audit-from" label="শুরুর তারিখ (From)" type="date" disabled />
          <Input name="audit-to" label="শেষের তারিখ (To)" type="date" disabled />
          <Input name="audit-actor" label="কর্মী (Actor ID)" placeholder="staff id…" disabled />
        </div>
        <p className="mt-3 text-xs text-text-muted">
          আসল ওয়্যারিংয়ে এই ফিল্টারগুলো <code>getAuditLogs()</code>-এর কোয়েরি চালাবে
          (entity / actor / তারিখ)। এখন এগুলো শুধু আকার দেখানোর জন্য — কোনো অনুসন্ধান চলে না।
        </p>
      </Card>

      <h2 className="mb-3 text-lg font-semibold">সাম্প্রতিক কার্যকলাপ (SAMPLE)</h2>
      <DataTable
        caption="অডিট লগ — সংবেদনশীল কাজের কারণ হাইলাইট করা; গোপন তথ্য (পাসওয়ার্ড, টোকেন, OTP) লগে কখনো থাকে না — sanitizeAuditJson() সেগুলো [REDACTED] করে"
        columns={[
          { key: "time", header: "সময় (Asia/Dhaka)" },
          { key: "actor", header: "কে করেছে" },
          { key: "action", header: "কাজ (Action)" },
          { key: "entity", header: "এনটিটি" },
          { key: "reason", header: "কারণ" },
        ]}
        rows={rows}
      />

      <Card className="mt-6">
        <p className="text-sm font-medium">এক্সপোর্ট নিয়ম (আউটলাইন)</p>
        <p className="mt-1 text-sm text-text-muted">
          অডিট লগ এক্সপোর্ট নিজেই একটি সংবেদনশীল কাজ (<code className="font-mono text-xs">audit.view</code> এর
          বাইরে এক্সপোর্টে কারণ লাগবে): এক্সপোর্টের আগে কারণ লিখতে হবে, এবং তৈরি ফাইলের প্রতিটি
          পৃষ্ঠা/শিটে ওয়াটারমার্ক থাকবে — কে এক্সপোর্ট করেছে, কখন (Asia/Dhaka), এবং কারণ।
          এই বোতামটি এখন নিষ্ক্রিয় আউটলাইন — কোনো ফাইল তৈরি হয় না।
        </p>
        <div className="mt-4">
          <Button type="button" variant="outline" disabled>
            অডিট লগ এক্সপোর্ট (আউটলাইন — নিষ্ক্রিয়)
          </Button>
        </div>
      </Card>
    </main>
  );
}

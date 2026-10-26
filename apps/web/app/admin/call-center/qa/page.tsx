import { PageHeader } from "@/components/ui/page-header";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { CallCenterTabs } from "../tabs";
import { QaTable } from "./qa-table";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";

// Call QA review — C3. Supervisors sample completed call logs and
// stamp a QA score (0–5) + comment on each (PATCH qa/[logId],
// staff.manage). The table client-fetches GET /api/v1/admin/
// call-center/qa like the reviews manager fetches its queue.
// Guarded by the module flag here and by the API's permissions.
export const dynamic = "force-dynamic";

export default async function AdminCallCenterQaPage() {
  await ensureDbFeatureFlags().catch(() => {});
  if (!isCallCenterEnabled(demoCallCenterFlags)) {
    return (
      <main>
        <PageHeader title="কল QA রিভিউ" description="Call QA Review (module.call_center)" breadcrumb="Admin / Call Center" />
        <p role="status">
          🔒 এই মডিউলটি এই ইনস্টলে লক করা আছে। Call Center একটি পেইড অ্যাড-অন —
          খুলতে Admin &gt; Settings থেকে <code>module.call_center</code> ফিচার ফ্ল্যাগ চালু করুন।
          (This module is locked — enable the <code>module.call_center</code> feature flag to unlock it.)
        </p>
      </main>
    );
  }

  return (
    <main>
      <PageHeader
        title="কল QA রিভিউ"
        description="সম্পন্ন কলগুলোর নমুনা যাচাই — প্রতিটি কলে ০–৫ স্কোর ও মন্তব্য দিন (শুধু সুপারভাইজার, staff.manage)। কোন স্ক্রিপ্ট সংস্করণে কল হয়েছে এবং কী disposition দেওয়া হয়েছে তাও দেখা যায়। (Call QA Review — sampled call logs with supervisor scoring)"
        breadcrumb="Admin / Call Center"
      />
      <CallCenterTabs active="qa" />
      <QaTable />
    </main>
  );
}

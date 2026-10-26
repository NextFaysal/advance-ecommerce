import { PageHeader } from "@/components/ui/page-header";
import { WebhooksPanel } from "./webhooks-panel";

// Webhooks + API keys admin (ADV-26) — developer platform core.
// Thin shell; the panel is a self-fetching client component over
// /api/v1/admin/webhooks/** (all guarded server-side by
// settings.integrations). A delivery shows "SENT" only when the
// target really answered 2xx; secrets and API keys are shown ONCE
// at creation and never again.
export const dynamic = "force-dynamic";

export default function AdminWebhooksPage() {
  return (
    <main>
      <PageHeader
        title="ওয়েবহুক ও API কী"
        description="আউটবাউন্ড ওয়েবহুক এন্ডপয়েন্ট, ডেলিভারি লগ ও পার্টনার API কী পরিচালনা করুন। সাইনিং সিক্রেট এনক্রিপ্ট করে রাখা হয় এবং তৈরির সময় একবারই দেখা যায়; ডেলিভারি SENT মানেই টার্গেট সত্যিকারে 2xx উত্তর দিয়েছে।"
      />
      <WebhooksPanel />
    </main>
  );
}

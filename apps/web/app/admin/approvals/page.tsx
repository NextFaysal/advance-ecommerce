import { PageHeader } from "@/components/ui/page-header";
import { ApprovalsPanel } from "./approvals-panel";

// Approvals admin (ADV-27) — the manager queue for approval
// workflows: discount approvals (a confirm was blocked because the
// order's discount reached the configured share of its subtotal)
// and refund approvals (a refund above the configured amount cannot
// be SENT until approved). Decisions require orders.edit
// (Owner/Manager) and are audited server-side. The page is a thin
// shell; the panel is a self-fetching client component.
export const dynamic = "force-dynamic";

export default function AdminApprovalsPage() {
  return (
    <main>
      <PageHeader
        title="অনুমোদন"
        description="বড় ছাড়ের অর্ডার ও বড় রিফান্ডের জন্য ম্যানেজারের অনুমোদনের তালিকা। অনুমোদন ছাড়া সংশ্লিষ্ট অর্ডার নিশ্চিত করা বা রিফান্ড পাঠানো যাবে না — কেন আটকে আছে, প্রতিটি অনুরোধেই তা লেখা আছে।"
      />
      <ApprovalsPanel />
    </main>
  );
}

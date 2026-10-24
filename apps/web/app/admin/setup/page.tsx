import { PageHeader } from "@/components/ui/page-header";
import { SetupWizard } from "./SetupWizard";

// First-run setup wizard — Agent 37.
// Bangla-first, multi-step: store info -> locked BD defaults -> payment
// enablement -> courier enablement -> integrations note -> finish.
// Progress persists in localStorage only (demo). API keys are never
// collected here — they belong in Admin > Settings (encrypted).
export default function AdminSetupPage() {
  return (
    <main>
      <PageHeader
        title="সেটআপ উইজার্ড"
        description="প্রথমবারের সেটআপ — দোকানের তথ্য, পেমেন্ট ও কুরিয়ার চালু করুন। অগ্রগতি শুধু এই ব্রাউজারে (localStorage) সংরক্ষিত থাকে।"
        breadcrumb="Admin / Setup"
      />
      <SetupWizard />
    </main>
  );
}

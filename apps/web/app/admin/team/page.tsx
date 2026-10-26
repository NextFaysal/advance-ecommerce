import { PageHeader } from "@/components/ui/page-header";
import { TeamClient } from "./team-client";
import { TargetsPanel } from "./targets-panel";
import { DigestPanel } from "./digest-panel";

// Team ops (ADV-27 remainder) — attendance grid, shifts, staff
// targets and the daily digest. Thin shell; the panels are
// self-fetching client components over /api/v1/admin/team/**
// (reads staff.view, writes staff.manage — enforced server-side).
export const dynamic = "force-dynamic";

export default function AdminTeamPage() {
  return (
    <main>
      <PageHeader
        title="টিম"
        description="স্টাফদের উপস্থিতি, শিফট, মাসিক লক্ষ্য (টার্গেট) ও দৈনিক ডাইজেস্ট। উপস্থিতির হিসাব আসে রেকর্ড করা চেক-ইন/চেক-আউট জোড়া থেকে; টার্গেটের অগ্রগতি আসে আসল অর্ডার ইতিহাস থেকে — অনুমান করা কোনো সংখ্যা এখানে নেই।"
      />
      <TeamClient />
      <TargetsPanel />
      <DigestPanel />
    </main>
  );
}

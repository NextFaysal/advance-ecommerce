import { PageHeader } from "@/components/ui/page-header";
import { TeamClient } from "./team-client";
import { TargetsPanel } from "./targets-panel";
import { DigestPanel } from "./digest-panel";
import { ChatPanel } from "./chat-panel";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { TEAM_STRINGS } from "./strings";

// Team ops (ADV-27 remainder) — attendance grid, shifts, staff
// targets and the daily digest. Thin shell; the panels are
// self-fetching client components over /api/v1/admin/team/**
// (reads staff.view, writes staff.manage — enforced server-side).
export const dynamic = "force-dynamic";

export default async function AdminTeamPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, TEAM_STRINGS);
  return (
    <main>
      <PageHeader
        title={s.title}
        description={s.description}
      />
      <TeamClient />
      <TargetsPanel />
      <DigestPanel />
      <ChatPanel />
    </main>
  );
}

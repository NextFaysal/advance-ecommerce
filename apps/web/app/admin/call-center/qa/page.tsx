import { PageHeader } from "@/components/ui/page-header";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { pick } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
import { CallCenterTabs } from "../tabs";
import { CALL_CENTER_STRINGS } from "../strings";
import { QaTable } from "./qa-table";

// Call QA review — C3. Supervisors sample completed call logs and
// stamp a QA score (0–5) + comment on each (PATCH qa/[logId],
// staff.manage). The table client-fetches GET /api/v1/admin/
// call-center/qa like the reviews manager fetches its queue.
// Guarded by the module flag here and by the API's permissions.
export const dynamic = "force-dynamic";

export default async function AdminCallCenterQaPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
  await ensureDbFeatureFlags();
  if (!isCallCenterEnabled(demoCallCenterFlags)) {
    return (
      <main>
        <PageHeader title={s.qaTitle} description={s.qaDescShort} breadcrumb={s.breadcrumb} />
        <p role="status">
          {s.lockedA} <code>module.call_center</code> {s.lockedB}
        </p>
      </main>
    );
  }

  return (
    <main>
      <PageHeader
        title={s.qaTitle}
        description={s.qaDescLong}
        breadcrumb={s.breadcrumb}
      />
      <CallCenterTabs active="qa" />
      <QaTable />
    </main>
  );
}

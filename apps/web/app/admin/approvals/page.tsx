import { PageHeader } from "@/components/ui/page-header";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { APPROVALS_STRINGS } from "./strings";
import { ApprovalsPanel } from "./approvals-panel";

// Approvals admin (ADV-27) — the manager queue for approval
// workflows: discount approvals (a confirm was blocked because the
// order's discount reached the configured share of its subtotal)
// and refund approvals (a refund above the configured amount cannot
// be SENT until approved). Decisions require orders.edit
// (Owner/Manager) and are audited server-side. The page is a thin
// shell; the panel is a self-fetching client component.
export const dynamic = "force-dynamic";

export default async function AdminApprovalsPage() {
  const locale = await getRequestLocale();
  const t = pick(locale, APPROVALS_STRINGS);
  return (
    <main>
      <PageHeader title={t.title} description={t.description} />
      <ApprovalsPanel />
    </main>
  );
}

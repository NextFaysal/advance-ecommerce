import { PageHeader } from "@/components/ui/page-header";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { TicketsManager } from "./tickets-manager";
import { CannedRepliesEditor, KbArticlesEditor } from "./support-tools";
import { TICKETS_STRINGS } from "./strings";

// Support ticket queue (ADV-16b) — real SupportTicket rows written
// by signed-in customers from /account/tickets. Staff reply moves a
// ticket to PENDING; a customer reply reopens it to OPEN. The list
// and thread are REAL — <TicketsManager> reads GET
// /api/v1/admin/tickets; replies and status changes go through the
// admin tickets API. Guarded by customers.view (reads) /
// customers.edit (writes) in the API — no dedicated support
// permission exists in PERMISSIONS.
export const dynamic = "force-dynamic";

export default async function AdminTicketsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, TICKETS_STRINGS);
  return (
    <main>
      <PageHeader
        title={s.pageTitle}
        description={s.pageDescription}
        breadcrumb={s.pageBreadcrumb}
      />
      <TicketsManager />
      <section className="mt-8 space-y-5" aria-label={s.toolsLabel}>
        <h2 className="text-base font-bold text-text-main">{s.toolsHeading}</h2>
        <CannedRepliesEditor />
        <KbArticlesEditor />
      </section>
    </main>
  );
}

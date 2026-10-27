import { PageHeader } from "@/components/ui/page-header";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { AUDIT_STRINGS } from "./strings";
import { AuditClient } from "./audit-client";

// Audit Log admin.
// Permission behind this page: audit.view (see src/lib/rbac.ts).
// REAL DATA (rewired 2026-10-25): the list, filters, pagination and
// CSV export all run against the DB-backed audit API
// (app/api/v1/admin/audit-log/) over the AuditLog table — the previous
// hardcoded SAMPLE rows are gone. Sensitive actions (the
// SENSITIVE_ACTIONS set in src/lib/audit.ts) required a reason when
// written and are highlighted by the client component.
export default async function AdminAuditPage() {
  const locale = await getRequestLocale();
  const t = pick(locale, AUDIT_STRINGS);
  return (
    <main>
      <PageHeader title={t.title} description={t.description} breadcrumb={t.breadcrumb} />
      <AuditClient />
    </main>
  );
}

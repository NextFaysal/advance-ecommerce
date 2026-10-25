import { PageHeader } from "@/components/ui/page-header";
import { AuditClient } from "./audit-client";

// Audit Log admin.
// Permission behind this page: audit.view (see src/lib/rbac.ts).
// REAL DATA (rewired 2026-10-25): the list, filters, pagination and
// CSV export all run against the DB-backed audit API
// (app/api/v1/admin/audit-log/) over the AuditLog table — the previous
// hardcoded SAMPLE rows are gone. Sensitive actions (the
// SENSITIVE_ACTIONS set in src/lib/audit.ts) required a reason when
// written and are highlighted by the client component.
export default function AdminAuditPage() {
  return (
    <main>
      <PageHeader
        title="অডিট লগ"
        description="আসল অডিট রেকর্ড — AuditLog টেবিল থেকে। সংবেদনশীল কাজে কারণ বাধ্যতামূলক, আর গোপন তথ্য লগে কখনো থাকে না (লেখার সময়ই [REDACTED] হয়)। (Audit Log — audit.view)"
        breadcrumb="Admin / System"
      />
      <AuditClient />
    </main>
  );
}

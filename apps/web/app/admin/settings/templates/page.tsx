import { PageHeader } from "@/components/ui/page-header";
import { TemplatesEditor } from "./templates-editor";

// Admin > Settings > Templates (ADV-29 template designer, doc 23
// wave 53) — merchant overrides for the invoice copy slots
// (header note / terms line / footer note) and the subject+intro
// copy of the three transactional email templates. Storage and
// resolution live in src/templates/overrides.ts (Setting documents
// templates.invoice / templates.email.<key>); this page is only
// the editor surface, the client editor self-fetches through
// /api/v1/admin/settings/templates (settings.view / settings.edit,
// reason-required + audited writes).
export const dynamic = "force-dynamic";

export default function AdminTemplatesSettingsPage() {
  return (
    <main>
      <PageHeader
        title="টেমপ্লেট ডিজাইনার"
        description="ইনভয়েস ও ইমেইলের নির্দিষ্ট লেখা (কপি) বদলান — লেআউট বা হিসাব বদলায় না। খালি রাখা স্লটে বিল্ট-ইন লেখাই ছাপা/পাঠানো হয়। (Template designer)"
        breadcrumb="Admin / Settings"
      />
      <TemplatesEditor />
    </main>
  );
}

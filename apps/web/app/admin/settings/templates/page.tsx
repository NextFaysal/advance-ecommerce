import { PageHeader } from "@/components/ui/page-header";
import { TemplatesEditor } from "./templates-editor";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { SETTINGS_B_STRINGS } from "../strings-b";

// Admin > Settings > Templates (ADV-29 template designer, doc 23
// wave 53) — merchant overrides for the invoice copy slots
// (header note / terms line / footer note) and the subject+intro
// copy of the three transactional email templates. Storage and
// resolution live in src/templates/overrides.ts (Setting documents
// templates.invoice / templates.email.<key>); this page is only
// the editor surface, the client editor self-fetches through
// /api/v1/admin/settings/templates (settings.view / settings.edit,
// reason-required + audited writes).
// UI copy: doc-30 dictionary (../strings-b), locale via getRequestLocale().
export const dynamic = "force-dynamic";

export default async function AdminTemplatesSettingsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  return (
    <main>
      <PageHeader title={s.tplPageTitle} description={s.tplPageDesc} breadcrumb="Admin / Settings" />
      <TemplatesEditor />
    </main>
  );
}

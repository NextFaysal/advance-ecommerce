import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { PageHeader } from "@/components/ui/page-header";
import { BuilderClient } from "./builder-client";
import { REPORTS_STRINGS } from "../strings";

// Admin > Reports > Report Builder (ADV-8, doc 22). Custom reports
// over real DB rows: dataset + columns + filters + Dhaka range ->
// preview and watermarked CSV export (reason mandatory, audited —
// same contract as the sales export). Saved definitions and
// delivery schedules persist as JSON documents in the Setting table
// (src/reports/saved-reports.ts).
export const dynamic = "force-dynamic";

export default async function ReportBuilderPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, REPORTS_STRINGS);
  return (
    <main className="min-w-0">
      <PageHeader title={s.builderTitle} description={s.builderDesc} />
      <BuilderClient />
    </main>
  );
}

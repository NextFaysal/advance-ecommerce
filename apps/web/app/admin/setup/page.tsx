import { PageHeader } from "@/components/ui/page-header";
import { SetupWizard } from "./SetupWizard";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { SETUP_STRINGS } from "./strings";

// First-run setup wizard — Agent 37.
// Bangla-first, multi-step: store info -> locked BD defaults -> payment
// enablement -> courier enablement -> integrations note -> finish.
// Progress persists in localStorage only (demo). API keys are never
// collected here — they belong in Admin > Settings (encrypted).
export default async function AdminSetupPage() {
  const s = pick(await getRequestLocale(), SETUP_STRINGS);
  return (
    <main>
      <PageHeader
        title={s.pageTitle}
        description={s.pageDescription}
        breadcrumb={s.pageBreadcrumb}
      />
      <SetupWizard />
    </main>
  );
}

import { PageHeader } from "@/components/ui/page-header";
import { WebhooksPanel } from "./webhooks-panel";
import { CustomFieldsManager } from "./custom-fields-manager";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { WEBHOOKS_STRINGS } from "./strings";

// Webhooks + API keys admin (ADV-26) — developer platform core.
// Thin shell; the panel is a self-fetching client component over
// /api/v1/admin/webhooks/** (all guarded server-side by
// settings.integrations). A delivery shows "SENT" only when the
// target really answered 2xx; secrets and API keys are shown ONCE
// at creation and never again.
export const dynamic = "force-dynamic";

export default async function AdminWebhooksPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, WEBHOOKS_STRINGS);
  return (
    <main>
      <PageHeader
        title={s.title}
        description={s.description}
      />
      <WebhooksPanel />
      {/* Custom-field definitions (ADV-26, wave 53) — same developer-
          platform surface: values surface through the partner API. */}
      <div className="mt-8">
        <CustomFieldsManager />
      </div>
    </main>
  );
}

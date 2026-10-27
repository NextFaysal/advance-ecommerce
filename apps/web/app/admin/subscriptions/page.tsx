import { cookies } from "next/headers";
import { PageHeader } from "@/components/ui/page-header";
import { validateSessionToken } from "@/lib/auth";
import { SubscriptionsList } from "@/components/admin/subscriptions-list";
import { pick } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
import { SUBSCRIPTIONS_ADMIN_STRINGS } from "./strings";

// Customer subscriptions (ADV-18 remainder) — staff oversight list.
// The list itself is a self-fetching client component (no props cross
// the server->client boundary); this page only gates on a valid staff
// session, mirroring /admin/security. Row data is served by
// GET /api/v1/admin/subscriptions behind orders.view.
export const dynamic = "force-dynamic";

export default async function AdminSubscriptionsPage() {
  const s = pick(await getRequestLocale(), SUBSCRIPTIONS_ADMIN_STRINGS);
  const token = cookies().get("admin_session")?.value;
  const session = token ? await validateSessionToken(token) : null;

  if (!session) {
    return (
      <main>
        <PageHeader title={s.title} description={s.loginDescription} breadcrumb={s.breadcrumb} />
        <p role="status" className="text-sm text-text-muted">
          {s.loginPrompt}
        </p>
      </main>
    );
  }

  return (
    <main>
      <PageHeader title={s.title} description={s.description} breadcrumb={s.breadcrumb} />
      <SubscriptionsList />
    </main>
  );
}

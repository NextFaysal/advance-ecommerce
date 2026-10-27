import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { SETTINGS_STRINGS } from "../strings";
import { CheckoutFieldsPanel } from "./checkout-fields-panel";

// Admin > Settings > Checkout Fields (doc 28). The storefront
// checkout's field set — labels (Bn/En), placeholders, visibility,
// required flags and order within each step group, plus up to 5
// merchant-added text fields — lives in the Setting doc
// `checkout.fields`. This page is its editor: the panel loads and
// saves through the dedicated /api/v1/admin/checkout-fields routes
// (settings.view / settings.edit + mandatory reason, audited), and
// the public checkout renders from the same coerced config, so a
// saved change is what the customer sees on the next page load.
export const dynamic = "force-dynamic";

export default async function CheckoutFieldsSettingsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  return (
    <main className="min-w-0">
      <PageHeader
        title={s.chfPageTitle}
        description={s.chfPageDesc}
        breadcrumb={s.chfBreadcrumb}
        actions={
          <Link
            href="/admin/settings"
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300"
          >
            {s.allSettings}
          </Link>
        }
      />
      <div className="mt-4 grid gap-4">
        <CheckoutFieldsPanel />
      </div>
    </main>
  );
}

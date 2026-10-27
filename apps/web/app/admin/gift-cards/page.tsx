import { PageHeader } from "@/components/ui/page-header";
import { GiftCardsPanel } from "./gift-cards-panel";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { GIFT_CARDS_STRINGS } from "./strings";

// Gift cards admin (ADV-18A) — issue / list / disable. The page is a
// thin shell; the panel is a self-fetching client component over
// /api/v1/admin/gift-cards (reads marketing.coupon, writes
// marketing.campaign, module.marketing_mechanics gate — all enforced
// server-side; with the module OFF the API answers FEATURE_LOCKED
// and the panel says so plainly).
export const dynamic = "force-dynamic";

export default async function AdminGiftCardsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, GIFT_CARDS_STRINGS);
  return (
    <main>
      <PageHeader title={s.title} description={s.description} />
      <GiftCardsPanel />
    </main>
  );
}

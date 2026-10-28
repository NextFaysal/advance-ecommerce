import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import FunnelBuilder from "./builder";
import { funnelStore } from "@/funnels/store";
import type { Funnel } from "@/funnels/types";
import { landingStore } from "@/landing/store";
import { listActiveProducts } from "@/catalog/server-read";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { FUNNEL_ADMIN_STRINGS } from "./strings";

// Funnel Builder admin — doc 34 L7.
// CartFlows-style funnels (landing → order+bump → upsell/downsell →
// thank-you) over the funnel store + admin API. Steps pick EXISTING
// landing pages (the landing store's list); offers pick REAL
// catalog products (ACTIVE, from the catalog DB — the same picker
// discipline as the landing builder). Permission convention mirrors
// the landing/CMS family: content.page (the API guards on it; the
// nav item uses it too).
//
// The Funnel table ships via a manually-applied Prisma migration
// (docs/RUNBOOK-LOCAL.md: migrate deploy is deliberately not in
// the build). Until it has run, the store read throws — the page
// degrades to an honest "table not ready" notice instead of a 500.
export const dynamic = "force-dynamic";

export default async function AdminFunnelsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, FUNNEL_ADMIN_STRINGS);
  let funnels: Funnel[] = [];
  let dbReady = true;
  try {
    funnels = await funnelStore.list();
  } catch {
    dbReady = false;
  }
  const pages = (await landingStore.list()).map((p) => ({
    id: p.id,
    titleBn: p.titleBn,
    titleEn: p.titleEn,
    slug: p.slug,
    status: p.status,
  }));
  const products = (await listActiveProducts(100)).map((p) => ({
    id: p.id,
    titleBn: p.title.bn,
    titleEn: p.title.en,
    variants: p.variants
      .filter((v) => v.isActive)
      .map((v) => ({
        id: v.id,
        label: Object.values(v.attributes).join(" / "),
        sku: v.sku,
        pricePoisha: v.pricePoisha,
        stock: v.stock,
      })),
  }));
  const published = funnels.filter((f) => f.status === "PUBLISHED").length;
  const drafts = funnels.filter((f) => f.status === "DRAFT").length;
  return (
    <main className="space-y-6">
      <PageHeader title={s.title} description={s.description} breadcrumb={s.breadcrumb} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label={s.statFunnels} value={String(funnels.length)} delta={s.deltaDb} icon="🛒" />
        <StatCard label={s.statPublished} value={String(published)} delta={s.deltaPublished} icon="✅" />
        <StatCard label={s.statDrafts} value={String(drafts)} delta={s.deltaDrafts} icon="📝" />
      </div>
      {!dbReady ? (
        <p className="rounded-xl bg-amber-50 p-4 font-medium text-amber-900" role="alert">
          {s.dbNotReady}
        </p>
      ) : (
        <FunnelBuilder initialFunnels={funnels} landingPages={pages} products={products} />
      )}
    </main>
  );
}

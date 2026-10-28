import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import LandingBuilder from "./builder";
import { landingStore } from "@/landing/store";
import { listActiveProducts } from "@/catalog/server-read";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { LANDING_STRINGS } from "./strings";

// Landing Page Builder admin — Agent 53.
// Campaign landing pages (ad -> landing -> COD order) for F-commerce
// sellers. Separate simpler section model from the CMS — see
// src/landing/types.ts. Pages persist in the DB (Prisma LandingPage via
// src/landing/store) and are passed to the builder as initial state;
// the builder saves through the landing API (POST creates, full-body
// PATCH updates, { status } PATCH transitions) — see builder.tsx.
// Permission convention mirrors CMS: content.page (the API guards on
// it; nav item uses it too). The product catalog is REAL: ACTIVE
// products from the catalog DB are passed to the builder.
export const dynamic = "force-dynamic";

export default async function AdminLandingPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, LANDING_STRINGS);
  const pages = await landingStore.list();
  const catalogProducts = await listActiveProducts(100);
  const published = pages.filter((p) => p.status === "PUBLISHED").length;
  const drafts = pages.filter((p) => p.status === "DRAFT").length;
  return (
    <main className="space-y-6">
      <PageHeader title={s.title} description={s.description} breadcrumb={s.breadcrumb} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label={s.statPages} value={String(pages.length)} delta={s.deltaDb} icon="🚀" />
        <StatCard label={s.statPublished} value={String(published)} delta={s.deltaPublished} icon="✅" />
        <StatCard label={s.statDrafts} value={String(drafts)} delta={s.deltaDrafts} icon="📝" />
      </div>
      <LandingBuilder catalogProducts={catalogProducts} initialPages={pages} />
    </main>
  );
}

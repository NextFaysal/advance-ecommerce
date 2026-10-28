import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cmsStore, type CmsPage } from "@/reports/cms";
import { readSiteContent } from "@/cms/site-content";
import SiteContentEditor from "./site-content-editor";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { CONTENT_STRINGS, type ContentStrings } from "./strings";

// Content / CMS admin — Step 29.
// The page/post list is REAL: the DB-backed CMS store (Prisma
// CmsPage/CmsPost, the same store the Pages API uses). An empty DB
// shows honest zeros and an empty table. Create/edit happens through
// /api/v1/admin/pages (slug rename records an SEO redirect there).
// Menus + homepage hero slides are REAL too: the site-content editor
// below is seeded from the DB (Setting table, cms.* keys —
// src/cms/site-content.ts) and saves through
// PUT /api/v1/admin/site-content; the storefront header/footer and
// the homepage hero read the same store. Unconfigured sections fall
// back to built-in defaults, labelled as defaults in the editor.
export const dynamic = "force-dynamic";

function seoSummary(p: CmsPage, s: ContentStrings): string {
  const hasTitle = p.seo.title.trim().length > 0;
  const descLen = p.seo.description.trim().length;
  if (!hasTitle && descLen === 0) return s.seoNone;
  return interpolate(s.seoSummary, { title: hasTitle ? s.seoTitleYes : s.seoTitleNo, len: descLen });
}

export default async function AdminContentPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, CONTENT_STRINGS);
  const all = await cmsStore.list();
  const redirects = await cmsStore.listRedirects();
  const siteContent = await readSiteContent();
  const pages = all.filter((p) => p.kind === "page");
  const posts = all.filter((p) => p.kind === "post");
  const published = all.filter((p) => p.status === "published").length;
  const drafts = all.filter((p) => p.status === "draft").length;

  const rows = all.map((p) => ({
    title: (
      <span>
        <span className="font-medium">{p.titleBn}</span>
        <span className="block text-xs text-text-muted">{p.titleEn}</span>
      </span>
    ),
    slug: <span className="font-mono">/{p.slug}</span>,
    kind: <Badge tone={p.kind === "page" ? "brand" : "info"}>{p.kind === "page" ? s.kindPage : s.kindPost}</Badge>,
    status: (
      <Badge tone={p.status === "published" ? "success" : p.status === "scheduled" ? "info" : "warning"}>
        {p.status === "published" ? s.statusPublished : p.status === "scheduled" ? s.statusScheduled : s.statusDraft}
      </Badge>
    ),
    seo: seoSummary(p, s),
    updated: <span className="tnum">{p.updatedAt.slice(0, 10)}</span>,
  }));

  return (
    <main className="space-y-6">
      <PageHeader title={s.title} description={s.description} breadcrumb={s.breadcrumb} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={s.statPages} value={String(pages.length)} delta={s.deltaDb} icon="📄" />
        <StatCard label={s.statPosts} value={String(posts.length)} delta={s.deltaDb} icon="✍️" />
        <StatCard label={s.statPublished} value={String(published)} delta={s.deltaLive} icon="✅" />
        <StatCard label={s.statDrafts} value={String(drafts)} delta={s.deltaUnpublished} deltaTone="down" icon="📝" />
      </div>

      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-text-main">{s.listTitle}</h2>
        {all.length === 0 ? (
          <Card>
            <p className="text-sm text-text-muted">{s.empty}</p>
          </Card>
        ) : (
          <DataTable
            caption={s.caption}
            columns={[
              { key: "title", header: s.colTitle },
              { key: "slug", header: s.colSlug },
              { key: "kind", header: s.colKind },
              { key: "status", header: s.colStatus },
              { key: "seo", header: s.colSeo },
              { key: "updated", header: s.colUpdated },
            ]}
            rows={rows}
          />
        )}
      </div>

      <Card>
        <p className="text-sm text-text-muted">
          {redirects.length === 0
            ? s.redirectsNone
            : interpolate(s.redirectsSome, { count: redirects.length, list: redirects.map((r) => `/${r.from} → /${r.to}`).join(" · ") })}
        </p>
      </Card>

      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-text-main">{s.menuHeroTitle}</h2>
        <SiteContentEditor initial={siteContent.content} configured={siteContent.configured} />
      </div>
    </main>
  );
}

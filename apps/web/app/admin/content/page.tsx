import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { buildMenu, cmsStore, type CmsPage, type MenuItem } from "@/reports/cms";

// Content / CMS admin — Step 29.
// The page/post list is REAL: the DB-backed CMS store (Prisma
// CmsPage/CmsPost, the same store the Pages API uses). An empty DB
// shows honest zeros and an empty table. Create/edit happens through
// /api/v1/admin/pages (slug rename records an SEO redirect there).
// Menu is still a builder stub: ordered items, at most one level of
// nesting for v1 — it is labelled as a stub in the UI.
export const dynamic = "force-dynamic";

const SAMPLE_MENU: MenuItem[] = buildMenu([
  { labelBn: "হোম", labelEn: "Home", href: "/", children: [] },
  { labelBn: "শপ", labelEn: "Shop", href: "/shop", children: [] },
  { labelBn: "আমাদের সম্পর্কে", labelEn: "About Us", href: "/about-us", children: [] },
  { labelBn: "ব্লগ", labelEn: "Blog", href: "/blog", children: [] },
]);

function seoSummary(p: CmsPage): string {
  const hasTitle = p.seo.title.trim().length > 0;
  const descLen = p.seo.description.trim().length;
  if (!hasTitle && descLen === 0) return "SEO শিরোনাম/বিবরণ নেই";
  return `${hasTitle ? "শিরোনাম ✓" : "শিরোনাম ✗"} · বিবরণ ${descLen} অক্ষর`;
}

export default async function AdminContentPage() {
  const all = await cmsStore.list();
  const redirects = await cmsStore.listRedirects();
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
    kind: <Badge tone={p.kind === "page" ? "brand" : "info"}>{p.kind === "page" ? "পেজ" : "পোস্ট"}</Badge>,
    status: (
      <Badge tone={p.status === "published" ? "success" : p.status === "scheduled" ? "info" : "warning"}>
        {p.status === "published" ? "প্রকাশিত" : p.status === "scheduled" ? "নির্ধারিত" : "খসড়া"}
      </Badge>
    ),
    seo: seoSummary(p),
    updated: p.updatedAt.slice(0, 10),
  }));

  return (
    <main>
      <PageHeader
        title="কন্টেন্ট (CMS)"
        description="ডাটাবেসের পেজ/পোস্ট তালিকা। তৈরি/সম্পাদনা Pages API দিয়ে হয়; স্লাগ বদলালে পুরনো URL-এর জন্য SEO রিডাইরেক্ট রেকর্ড হয়। (Content / CMS)"
        breadcrumb="Admin / Catalog"
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="পেজ" value={String(pages.length)} delta="ডাটাবেস" icon="📄" />
        <StatCard label="পোস্ট" value={String(posts.length)} delta="ডাটাবেস" icon="✍️" />
        <StatCard label="প্রকাশিত" value={String(published)} delta="লাইভ" icon="✅" />
        <StatCard label="খসড়া" value={String(drafts)} delta="অপ্রকাশিত" deltaTone="down" icon="📝" />
      </div>

      <h2 className="mb-3 text-lg font-semibold">পেজ ও পোস্ট</h2>
      {all.length === 0 ? (
        <Card>
          <p className="text-sm text-text-muted">এখনো কোনো পেজ বা পোস্ট তৈরি হয়নি — Pages API দিয়ে প্রথমটি তৈরি করুন।</p>
        </Card>
      ) : (
        <DataTable
          caption="CMS তালিকা — প্রতিটি আইটেমে বাংলা + ইংরেজি শিরোনাম, kebab-case স্লাগ, অবস্থা ও SEO সারাংশ"
          columns={[
            { key: "title", header: "শিরোনাম" },
            { key: "slug", header: "স্লাগ" },
            { key: "kind", header: "ধরন" },
            { key: "status", header: "অবস্থা" },
            { key: "seo", header: "SEO সারাংশ" },
            { key: "updated", header: "হালনাগাদ" },
          ]}
          rows={rows}
        />
      )}

      <div className="mt-6">
        <Card>
          <h3 className="mb-1 font-semibold">মেনু (স্টাব)</h3>
          <p className="mb-3 text-sm text-text-muted">
            মেনু বিল্ডার এখন স্টাব: সাজানো আইটেমের তালিকা, v1-এ সর্বোচ্চ এক স্তরের নেস্টিং
            (<code>buildMenu</code>, src/reports/cms.ts)। ড্র্যাগ-ড্রপ সম্পাদনা পরের ধাপে;
            আসল মেনু DB-তে সংরক্ষিত হবে।
          </p>
          <ul className="flex flex-wrap gap-2">
            {SAMPLE_MENU.map((item) => (
              <li key={item.href} className="rounded-full bg-surface-2 px-3 py-1 text-sm">
                {item.labelBn} <span className="font-mono text-xs text-text-muted">{item.href}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-text-muted">
            {redirects.length === 0
              ? "রিডাইরেক্ট: বর্তমানে কোনো রিডাইরেক্ট নেই — স্লাগ বদলালে API স্বয়ংক্রিয়ভাবে পুরনো → নতুন স্লাগের রিডাইরেক্ট রেকর্ড করে।"
              : `রিডাইরেক্ট (${redirects.length}): ${redirects.map((r) => `/${r.from} → /${r.to}`).join(" · ")}`}
          </p>
        </Card>
      </div>
    </main>
  );
}

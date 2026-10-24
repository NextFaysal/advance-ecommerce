import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { buildMenu, type CmsPage, type MenuItem } from "@/reports/cms";

// Content / CMS admin — Agent 25, Step 29.
// The CMS service (src/reports/cms.ts) keeps an in-memory store that the
// Pages API uses; it ships without seed rows, so the list below is
// page-local SAMPLE data typed as CmsPage, labelled TEMPORARY DEMO.
// Create/edit happens through /api/v1/admin/pages (slug rename records
// an SEO redirect there). Menu is a builder stub: ordered items, at
// most one level of nesting for v1.

const SAMPLE_PAGES: CmsPage[] = [
  {
    id: "pg_sample_about",
    kind: "page",
    slug: "about-us",
    titleBn: "আমাদের সম্পর্কে",
    titleEn: "About Us",
    bodyBn: "",
    bodyEn: "",
    status: "published",
    scheduledAt: null,
    tags: [],
    seo: { title: "আমাদের সম্পর্কে | SAMPLE Store", description: "SAMPLE SEO বিবরণ — দোকানের পরিচিতি ও যোগাযোগ।" },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-10-05T00:00:00.000Z",
  },
  {
    id: "pg_sample_delivery",
    kind: "page",
    slug: "delivery-policy",
    titleBn: "ডেলিভারি নীতিমালা",
    titleEn: "Delivery Policy",
    bodyBn: "",
    bodyEn: "",
    status: "draft",
    scheduledAt: null,
    tags: [],
    seo: { title: "", description: "" },
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
  },
  {
    id: "pg_sample_guide",
    kind: "post",
    slug: "new-arrival-guide",
    titleBn: "নতুন কালেকশন গাইড",
    titleEn: "New Arrival Guide",
    bodyBn: "",
    bodyEn: "",
    status: "scheduled",
    scheduledAt: "2026-10-26T04:00:00.000Z",
    category: "guide",
    tags: ["new", "guide"],
    seo: { title: "নতুন কালেকশন গাইড", description: "SAMPLE SEO বিবরণ — এই মৌসুমের নতুন পণ্য বেছে নেওয়ার গাইড।" },
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-21T00:00:00.000Z",
  },
  {
    id: "pg_sample_care",
    kind: "post",
    slug: "product-care-tips",
    titleBn: "পণ্যের যত্নের টিপস",
    titleEn: "Product Care Tips",
    bodyBn: "",
    bodyEn: "",
    status: "published",
    scheduledAt: null,
    category: "tips",
    tags: ["care"],
    seo: { title: "পণ্যের যত্নের টিপস", description: "" },
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:00.000Z",
  },
];

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

export default function AdminContentPage() {
  const pages = SAMPLE_PAGES.filter((p) => p.kind === "page");
  const posts = SAMPLE_PAGES.filter((p) => p.kind === "post");
  const published = SAMPLE_PAGES.filter((p) => p.status === "published").length;
  const drafts = SAMPLE_PAGES.filter((p) => p.status === "draft").length;

  const rows = SAMPLE_PAGES.map((p) => ({
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
        description="TEMPORARY DEMO — নমুনা (SAMPLE) পেজ/পোস্ট তালিকা। তৈরি/সম্পাদনা Pages API দিয়ে হয়; স্লাগ বদলালে পুরনো URL-এর জন্য SEO রিডাইরেক্ট রেকর্ড হয়। (Content / CMS)"
        breadcrumb="Admin / Catalog"
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="পেজ (নমুনা)" value={String(pages.length)} delta="ডেমো" icon="📄" />
        <StatCard label="পোস্ট (নমুনা)" value={String(posts.length)} delta="ডেমো" icon="✍️" />
        <StatCard label="প্রকাশিত" value={String(published)} delta="লাইভ (ডেমো)" icon="✅" />
        <StatCard label="খসড়া" value={String(drafts)} delta="অপ্রকাশিত" deltaTone="down" icon="📝" />
      </div>

      <h2 className="mb-3 text-lg font-semibold">পেজ ও পোস্ট (নমুনা)</h2>
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
            রিডাইরেক্ট: ডেমো স্টোরে বর্তমানে কোনো রিডাইরেক্ট নেই — স্লাগ বদলালে API স্বয়ংক্রিয়ভাবে
            পুরনো → নতুন স্লাগের রিডাইরেক্ট রেকর্ড করে।
          </p>
        </Card>
      </div>
    </main>
  );
}

import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import LandingBuilder from "./builder";
import { landingStore } from "@/landing/store";
import { listActiveProducts } from "@/catalog/server-read";

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
  const pages = await landingStore.list();
  const catalogProducts = await listActiveProducts(100);
  const published = pages.filter((p) => p.status === "PUBLISHED").length;
  const drafts = pages.filter((p) => p.status === "DRAFT").length;
  return (
    <main>
      <PageHeader
        title="ল্যান্ডিং পেজ বিল্ডার"
        description="ক্যাম্পেইন ল্যান্ডিং পেজ: সেকশন যোগ/সরানো/সাজানো, লাইভ প্রিভিউ, প্রকাশ টগল। যাচাই আসল validateLandingPage() দিয়ে হয়; 'সংরক্ষণ করুন' চাপলে সম্পাদনা ডাটাবেসে সেভ হয়। (Landing Page Builder)"
        breadcrumb="Admin / Marketing"
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="ল্যান্ডিং পেজ" value={String(pages.length)} delta="ডাটাবেস" icon="🚀" />
        <StatCard label="প্রকাশিত" value={String(published)} delta="পাবলিক /lp/<slug>" icon="✅" />
        <StatCard label="খসড়া" value={String(drafts)} delta="অপ্রকাশিত — পাবলিকে 404" icon="📝" />
      </div>
      <LandingBuilder catalogProducts={catalogProducts} initialPages={pages} />
    </main>
  );
}

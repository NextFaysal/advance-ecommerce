import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import LandingBuilder from "./builder";
import { landingStore } from "@/landing/store";

// Landing Page Builder admin — Agent 53.
// Campaign landing pages (ad -> landing -> COD order) for F-commerce
// sellers. Separate simpler section model from the CMS — see
// src/landing/types.ts. TEMPORARY DEMO: builder state is page-local,
// seeded from the in-memory demo store; the landing API carries the
// same contracts. Permission convention mirrors CMS: content.page
// (the API guards on it; nav item uses it too).

export default function AdminLandingPage() {
  const pages = landingStore.list();
  const published = pages.filter((p) => p.status === "PUBLISHED").length;
  const drafts = pages.filter((p) => p.status === "DRAFT").length;
  return (
    <main>
      <PageHeader
        title="ল্যান্ডিং পেজ বিল্ডার"
        description="TEMPORARY DEMO — ক্যাম্পেইন ল্যান্ডিং পেজ: সেকশন যোগ/সরানো/সাজানো, লাইভ প্রিভিউ, প্রকাশ টগল। যাচাই আসল validateLandingPage() দিয়ে হয়; সম্পাদনা এই পেজের স্টেটেই থাকে (রিলোডে হারাবে)। (Landing Page Builder)"
        breadcrumb="Admin / Marketing"
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="ল্যান্ডিং পেজ (ডেমো)" value={String(pages.length)} delta="ডেমো স্টোর" icon="🚀" />
        <StatCard label="প্রকাশিত" value={String(published)} delta="পাবলিক /lp/<slug>" icon="✅" />
        <StatCard label="খসড়া" value={String(drafts)} delta="অপ্রকাশিত — পাবলিকে 404" icon="📝" />
      </div>
      <LandingBuilder />
    </main>
  );
}

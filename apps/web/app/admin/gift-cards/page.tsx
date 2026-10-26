import { PageHeader } from "@/components/ui/page-header";
import { GiftCardsPanel } from "./gift-cards-panel";

// Gift cards admin (ADV-18A) — issue / list / disable. The page is a
// thin shell; the panel is a self-fetching client component over
// /api/v1/admin/gift-cards (reads marketing.coupon, writes
// marketing.campaign, module.marketing_mechanics gate — all enforced
// server-side; with the module OFF the API answers FEATURE_LOCKED
// and the panel says so plainly).
export const dynamic = "force-dynamic";

export default function AdminGiftCardsPage() {
  return (
    <main>
      <PageHeader
        title="গিফট কার্ড"
        description="গিফট কার্ড ইস্যু করুন, ব্যালেন্স দেখুন ও প্রয়োজনে নিষ্ক্রিয় করুন। ব্যালেন্স সবসময় লেজার (GiftCardTransaction) থেকে হিসাব করা হয় — কোডের পূর্ণ রূপ কখনো সংরক্ষিত হয় না, ইস্যুর সময় একবারই দেখা যায়।"
      />
      <GiftCardsPanel />
    </main>
  );
}

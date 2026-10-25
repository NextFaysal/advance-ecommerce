import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { isFlashSaleLive, type FlashSaleWithItems } from "@/marketing/flash-sale";
import { listCampaignsDb, listCouponsDb, listFlashSalesDb } from "@/marketing/repository";
import type { CouponRecord } from "@/marketing/service";
import type { Campaign } from "@/marketing/campaign";
import { listAllProducts } from "@/catalog/server-read";
import CouponForm from "./coupon-form";
import CouponManager from "./coupon-manager";
import CampaignEstimate from "./campaign-estimate";
import CampaignManager from "./campaign-manager";
import FlashSaleManager, { type FlashSalePickerProduct } from "./flash-sale-manager";

// Marketing admin — flash-sale data pipe added 2026-10-25; coupons,
// campaigns and the abandoned section made honest the same day.
// COUPONS ARE REAL: list + toggle read/write the Coupon table through
// src/marketing/repository + /api/v1/admin/coupons (create form posts
// to the same API). CAMPAIGNS ARE REAL RECORDS: list + create persist
// Campaign rows with a computed cost estimate — but NOTHING IS SENT:
// dispatch needs a BullMQ worker and a configured SMS/email gateway,
// neither of which exists yet, and the UI says so. FLASH SALES ARE
// REAL: listFlashSalesDb + /api/v1/admin/flash-sales, and a live sale
// surfaces on the storefront via getLiveFlashSale().
// ABANDONED CART: there is NO real data source — the storefront cart
// is a guest cart kept in the browser (localStorage), the public carts
// API is an in-memory stub the storefront does not use, and nothing
// ever writes the Cart table. So no abandoned checkouts are captured
// and the section below says exactly that instead of showing rows.

export const dynamic = "force-dynamic";

export default async function AdminMarketingPage() {
  const nowIso = new Date().toISOString();

  // Coupons: real DB read. A failed read renders the manager's honest
  // "database unavailable" state — never sample rows.
  let coupons: CouponRecord[] = [];
  let couponsDbReady = true;
  try {
    coupons = await listCouponsDb();
  } catch {
    couponsDbReady = false;
  }

  // Campaigns: real DB read, same honesty rule as coupons.
  let campaigns: Campaign[] = [];
  let campaignsDbReady = true;
  try {
    campaigns = await listCampaignsDb();
  } catch {
    campaignsDbReady = false;
  }

  // Flash sales: real DB read. A failed read renders the manager's
  // honest "database unavailable" state — never sample rows.
  let flashSales: FlashSaleWithItems[] = [];
  let flashDbReady = true;
  try {
    flashSales = await listFlashSalesDb();
  } catch {
    flashDbReady = false;
  }
  const liveSales = flashSales.filter((s) => isFlashSaleLive(s, nowIso)).length;

  // Item-picker catalogue: slimmed to display fields only — the admin
  // Product shape carries costPoisha, which must NOT be serialized
  // into this page's client payload (see src/catalog/server-read).
  const catalogProducts = await listAllProducts();
  const pickerProducts: FlashSalePickerProduct[] = catalogProducts.map((p) => ({
    id: p.id,
    titleBn: p.title.bn,
    titleEn: p.title.en,
    slug: p.slug,
    status: p.status,
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      attributesLabel: Object.values(v.attributes).filter(Boolean).join(" / "),
      pricePoisha: v.pricePoisha,
      stock: v.stock,
      isActive: v.isActive,
    })),
  }));

  const activeCoupons = coupons.filter((c) => c.isActive).length;
  const openCampaigns = campaigns.filter((c) => c.status === "draft" || c.status === "scheduled").length;

  return (
    <main>
      <PageHeader
        title="মার্কেটিং"
        description="কুপন, ক্যাম্পেইন ও ফ্ল্যাশ সেল আসল ডাটাবেস থেকে পরিচালিত হয়। ক্যাম্পেইন শুধু রেকর্ড ও খরচের হিসাব — কোনো মেসেজ পাঠানো হয় না (ওয়ার্কার ও গেটওয়ে এখনো নেই)। পরিত্যক্ত কার্টের কোনো ডেটা ধরা পড়ে না — কারণ নিচে দেওয়া আছে। (Marketing)"
        breadcrumb="Admin / Marketing"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="সক্রিয় কুপন"
          value={couponsDbReady ? String(activeCoupons) : "—"}
          delta={couponsDbReady ? "আসল ডেটা" : "ডাটাবেস নেই"}
          icon="🏷️"
        />
        <StatCard label="চলমান ফ্ল্যাশ সেল" value={flashDbReady ? String(liveSales) : "—"} delta={flashDbReady ? "আসল ডেটা" : "ডাটাবেস নেই"} icon="⚡" />
        <StatCard
          label="ক্যাম্পেইন (খসড়া/নির্ধারিত)"
          value={campaignsDbReady ? String(openCampaigns) : "—"}
          delta={campaignsDbReady ? "আসল ডেটা" : "ডাটাবেস নেই"}
          icon="📣"
        />
        <StatCard label="পরিত্যক্ত কার্ট ফলো-আপ" value="—" delta="ডেটা ধরা পড়ে না" deltaTone="down" icon="🛒" />
      </div>

      <h2 className="mb-3 text-lg font-semibold">কুপনসমূহ</h2>
      <CouponManager initialCoupons={coupons} dbReady={couponsDbReady} />

      <div className="mt-6">
        <CouponForm />
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">ফ্ল্যাশ সেল</h2>
      <FlashSaleManager initialSales={flashSales} dbReady={flashDbReady} products={pickerProducts} />

      <h2 className="mb-3 mt-8 text-lg font-semibold">ক্যাম্পেইন</h2>
      <CampaignManager initialCampaigns={campaigns} dbReady={campaignsDbReady} />

      <div className="mt-6">
        <CampaignEstimate />
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">পরিত্যক্ত কার্ট ফলো-আপ</h2>
      <Card>
        <h3 className="font-semibold">এখনো কোনো পরিত্যক্ত কার্ট ধরা পড়ে না</h3>
        <p className="mt-1 text-sm leading-relaxed text-text-muted">
          স্টোরফ্রন্টের কার্ট অতিথি কার্ট — ক্রেতার ব্রাউজারেই (localStorage) থাকে, সার্ভারে
          আসে না। পাবলিক carts API এখনো শুধু মেমোরি-ভিত্তিক এবং স্টোরফ্রন্ট সেটি ব্যবহার করে
          না; Cart টেবিলে কোনো সারি লেখাই হয় না। ফলে পরিত্যক্ত চেকআউটের কোনো রেকর্ড নেই
          এবং ফলো-আপের কোনো তালিকা দেখানো যাচ্ছে না — আগের নমুনা সারিগুলো সরিয়ে দেওয়া
          হয়েছে। কার্ট সার্ভারে সংরক্ষণ (লগইন-করা ক্রেতার জন্য) চালু হলে ফলো-আপ জব
          (abandoned-cart queue তৈরি আছে) সেই ডেটা থেকে কাজ করতে পারবে; পাঠানো হবে SMS/ইমেইল
          গেটওয়ে কনফিগার হওয়ার পর।
        </p>
      </Card>
    </main>
  );
}

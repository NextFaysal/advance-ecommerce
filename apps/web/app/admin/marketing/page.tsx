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
// ABANDONED CART (updated wave 22, doc 17 O4): checkout now CAPTURES
// abandoned checkouts for real (AbandonedCheckout rows via
// POST /api/v1/public/checkout/capture once a shopper enters a valid
// phone with a non-empty cart). Recovery work (call tasks, convert to
// order, dismiss) lives on its own page, /admin/abandoned; the section
// below points there instead of duplicating the list. The guest cart
// itself still lives in the browser — capture records the checkout
// attempt, not the cart.

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
        description="কুপন, ক্যাম্পেইন ও ফ্ল্যাশ সেল আসল ডাটাবেস থেকে পরিচালিত হয়। ক্যাম্পেইন শুধু রেকর্ড ও খরচের হিসাব — কোনো মেসেজ পাঠানো হয় না (ওয়ার্কার ও গেটওয়ে এখনো নেই)। পরিত্যক্ত চেকআউট এখন ধরা পড়ে — ফলো-আপের কাজ হয় /admin/abandoned পেজে। (Marketing)"
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
        <StatCard label="পরিত্যক্ত কার্ট ফলো-আপ" value="—" delta="/admin/abandoned পেজে" deltaTone="up" icon="🛒" />
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
        <h3 className="font-semibold">পরিত্যক্ত চেকআউট এখন ধরা পড়ে</h3>
        <p className="mt-1 text-sm leading-relaxed text-text-muted">
          ক্রেতা চেকআউটে সঠিক ফোন নম্বর দিয়ে কার্ট ফেলে চলে গেলে সেই চেষ্টাটি সংরক্ষিত
          হয় (৭ দিন মেয়াদে)। ফলো-আপের তালিকা, কল টাস্ক তৈরি, সরাসরি অর্ডারে রূপান্তর ও
          বাতিল — সব কাজ আলাদা পেজে হয়:{" "}
          <a href="/admin/abandoned" className="font-semibold text-brand-700 hover:underline">
            পরিত্যক্ত চেকআউট পেজে যান
          </a>
          । SMS/ইমেইল দিয়ে স্বয়ংক্রিয় ফলো-আপ পাঠানো হবে ওয়ার্কার ও গেটওয়ে চালু হওয়ার পর।
        </p>
      </Card>
    </main>
  );
}

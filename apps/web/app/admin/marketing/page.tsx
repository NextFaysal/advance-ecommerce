import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Money, formatPoisha } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import type { CouponRecord } from "@/marketing/service";
import { estimateCampaignCost } from "@/marketing/service";
import type { Campaign, AbandonedCheckoutFollowUp } from "@/marketing/campaign";
import {
  isFlashSaleLive,
  remainingFlashStock,
  type FlashSale,
} from "@/marketing/flash-sale";
import CouponForm from "./coupon-form";
import CampaignEstimate from "./campaign-estimate";

// Marketing admin — Agent 25.
// The marketing services (src/marketing) have API routes but no shared
// demo store with rows, so the rows below are page-local SAMPLE data,
// labelled TEMPORARY DEMO everywhere. Coupon figures follow the DB seed
// sample (WELCOME10: 10%, cap ৳500.00). Nothing here sends a message:
// the campaign panel is a cost estimate only, and coupon create posts
// to the existing API and shows its answer as-is.

const SAMPLE_COUPONS: CouponRecord[] = [
  {
    id: "cpn_sample_welcome10",
    code: "WELCOME10",
    type: "percent",
    valuePercent: 10,
    valuePoisha: null,
    minCartPoisha: null,
    maxDiscountPoisha: 50000,
    usageLimit: null,
    perUserLimit: 1,
    startsAt: null,
    endsAt: null,
    stackable: false,
    isActive: true,
    usedCount: 132,
    usedByUser: {},
  },
  {
    id: "cpn_sample_fixed200",
    code: "SAMPLE-FIXED200",
    type: "fixed",
    valuePercent: null,
    valuePoisha: 20000,
    minCartPoisha: 100000,
    maxDiscountPoisha: null,
    usageLimit: 500,
    perUserLimit: null,
    startsAt: null,
    endsAt: null,
    stackable: false,
    isActive: true,
    usedCount: 41,
    usedByUser: {},
  },
  {
    id: "cpn_sample_freeship",
    code: "SAMPLE-FREESHIP",
    type: "free_shipping",
    valuePercent: null,
    valuePoisha: null,
    minCartPoisha: 150000,
    maxDiscountPoisha: null,
    usageLimit: null,
    perUserLimit: null,
    startsAt: null,
    endsAt: null,
    stackable: true,
    isActive: false,
    usedCount: 0,
    usedByUser: {},
  },
];

function buildSampleFlashSales(): FlashSale[] {
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  return [
    {
      id: "fs_sample_live",
      name: "SAMPLE — সাপ্তাহিক ফ্ল্যাশ সেল",
      startsAt: iso(now - 60 * 60 * 1000),
      endsAt: iso(now + 24 * 60 * 60 * 1000),
      stockCap: 100,
      soldCount: 37,
      isActive: true,
    },
    {
      id: "fs_sample_upcoming",
      name: "SAMPLE — আসন্ন মেগা সেল",
      startsAt: iso(now + 24 * 60 * 60 * 1000),
      endsAt: iso(now + 48 * 60 * 60 * 1000),
      stockCap: 250,
      soldCount: 0,
      isActive: true,
    },
    {
      id: "fs_sample_ended",
      name: "SAMPLE — শেষ হওয়া সেল",
      startsAt: iso(now - 72 * 60 * 60 * 1000),
      endsAt: iso(now - 48 * 60 * 60 * 1000),
      stockCap: 50,
      soldCount: 50,
      isActive: true,
    },
  ];
}

const SAMPLE_CAMPAIGN_ESTIMATE = estimateCampaignCost({
  channel: "sms",
  segmentRef: "all-customers",
  templateKey: "offer-bn",
  messageText: "অফার! আজ সব পণ্যে ১০% ছাড়। WELCOME10 কোড ব্যবহার করুন।",
  recipientCount: 1200,
  pricePerSegmentPoisha: 45,
  scheduledAt: null,
});

const SAMPLE_CAMPAIGNS: Campaign[] = [
  {
    id: "cmp_sample_1",
    channel: "sms",
    segmentRef: "all-customers",
    templateKey: "offer-bn",
    scheduledAt: null,
    recipientCount: 1200,
    sentCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    costEstimatePoisha: SAMPLE_CAMPAIGN_ESTIMATE.costEstimatePoisha,
    status: "draft",
  },
  {
    id: "cmp_sample_2",
    channel: "email",
    segmentRef: "repeat-buyers",
    templateKey: "new-arrival",
    scheduledAt: "2026-10-26T04:00:00.000Z",
    recipientCount: 340,
    sentCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    costEstimatePoisha: 0,
    status: "scheduled",
  },
];

const SAMPLE_ABANDONED: AbandonedCheckoutFollowUp[] = [
  {
    checkoutId: "chk_sample_1",
    customerPhone: "+8801700000001",
    channel: "sms",
    attempt: 1,
    status: "pending",
  },
  {
    checkoutId: "chk_sample_2",
    customerPhone: "+8801700000002",
    channel: "sms",
    attempt: 2,
    status: "sent",
  },
  {
    checkoutId: "chk_sample_3",
    customerPhone: "+8801700000003",
    channel: "email",
    attempt: 1,
    status: "recovered",
  },
];

function couponDiscountLabel(c: CouponRecord): string {
  if (c.type === "percent") {
    const cap = c.maxDiscountPoisha !== null ? ` (সর্বোচ্চ ${formatPoisha(c.maxDiscountPoisha)})` : "";
    return `${c.valuePercent ?? 0}%${cap}`;
  }
  if (c.type === "fixed") return formatPoisha(c.valuePoisha ?? 0);
  if (c.type === "free_shipping") return "ডেলিভারি ফ্রি";
  return "প্রথম অর্ডারে বিশেষ ছাড়";
}

export default function AdminMarketingPage() {
  const nowIso = new Date().toISOString();
  const flashSales = buildSampleFlashSales();
  const liveSales = flashSales.filter((s) => isFlashSaleLive(s, nowIso)).length;

  const couponRows = SAMPLE_COUPONS.map((c) => ({
    code: <span className="font-mono font-semibold">{c.code}</span>,
    type: c.type,
    discount: couponDiscountLabel(c),
    minCart: c.minCartPoisha !== null ? <Money poisha={c.minCartPoisha} /> : "শর্ত নেই",
    used:
      c.usageLimit !== null ? `${c.usedCount} / ${c.usageLimit}` : `${c.usedCount}`,
    status: c.isActive ? (
      <Badge tone="success">সক্রিয়</Badge>
    ) : (
      <Badge tone="neutral">বন্ধ</Badge>
    ),
  }));

  const flashRows = flashSales.map((s) => {
    const live = isFlashSaleLive(s, nowIso);
    const upcoming = s.isActive && s.startsAt > nowIso;
    return {
      name: s.name,
      window: `${s.startsAt.slice(0, 16).replace("T", " ")} → ${s.endsAt.slice(0, 16).replace("T", " ")}`,
      stock: `${s.soldCount} / ${s.stockCap} (বাকি ${remainingFlashStock(s)})`,
      status: live ? (
        <Badge tone="success">চলমান</Badge>
      ) : upcoming ? (
        <Badge tone="info">আসন্ন</Badge>
      ) : (
        <Badge tone="neutral">শেষ</Badge>
      ),
    };
  });

  const campaignRows = SAMPLE_CAMPAIGNS.map((c) => ({
    template: <span className="font-mono">{c.templateKey}</span>,
    channel: c.channel.toUpperCase(),
    segment: c.segmentRef,
    recipients: c.recipientCount,
    estimate:
      c.costEstimatePoisha !== null ? <Money poisha={c.costEstimatePoisha} /> : "—",
    status: (
      <Badge tone={c.status === "scheduled" ? "info" : "warning"}>{c.status}</Badge>
    ),
  }));

  const abandonedRows = SAMPLE_ABANDONED.map((f) => ({
    checkout: <span className="font-mono">{f.checkoutId}</span>,
    phone: <Phone phone={f.customerPhone} />,
    channel: f.channel.toUpperCase(),
    attempt: f.attempt,
    status: (
      <Badge
        tone={
          f.status === "recovered"
            ? "success"
            : f.status === "sent"
              ? "info"
              : f.status === "expired"
                ? "danger"
                : "warning"
        }
      >
        {f.status}
      </Badge>
    ),
  }));

  return (
    <main>
      <PageHeader
        title="মার্কেটিং"
        description="TEMPORARY DEMO — কুপন, ফ্ল্যাশ সেল, ক্যাম্পেইন ও পরিত্যক্ত কার্টের নমুনা তালিকা। ক্যাম্পেইন প্যানেল শুধু খরচের হিসাব দেখায়, কোনো মেসেজ পাঠায় না। (Marketing)"
        breadcrumb="Admin / Marketing"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="সক্রিয় কুপন (নমুনা)" value={String(SAMPLE_COUPONS.filter((c) => c.isActive).length)} delta="ডেমো" icon="🏷️" />
        <StatCard label="চলমান ফ্ল্যাশ সেল" value={String(liveSales)} delta="ডেমো" icon="⚡" />
        <StatCard label="ক্যাম্পেইন (খসড়া/নির্ধারিত)" value={String(SAMPLE_CAMPAIGNS.length)} delta="ডেমো" icon="📣" />
        <StatCard label="পরিত্যক্ত কার্ট ফলো-আপ" value={String(SAMPLE_ABANDONED.filter((f) => f.status === "pending" || f.status === "sent").length)} delta="অপেক্ষমাণ" deltaTone="down" icon="🛒" />
      </div>

      <h2 className="mb-3 text-lg font-semibold">কুপনসমূহ (নমুনা)</h2>
      <DataTable
        caption="কুপন তালিকা — TEMPORARY DEMO সারি; আসল তালিকা Coupons API / DB থেকে আসবে"
        columns={[
          { key: "code", header: "কোড" },
          { key: "type", header: "ধরন" },
          { key: "discount", header: "ছাড়" },
          { key: "minCart", header: "ন্যূনতম কার্ট" },
          { key: "used", header: "ব্যবহৃত / সীমা" },
          { key: "status", header: "অবস্থা" },
        ]}
        rows={couponRows}
      />

      <div className="mt-6">
        <CouponForm />
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">ফ্ল্যাশ সেল (নমুনা)</h2>
      <DataTable
        caption="ফ্ল্যাশ সেল — বিক্রি কখনো stockCap ছাড়ায় না (সার্ভিস নিয়ম); সময়গুলো এখন থেকে আপেক্ষিক ডেমো"
        columns={[
          { key: "name", header: "নাম" },
          { key: "window", header: "সময় (UTC)" },
          { key: "stock", header: "বিক্রি / ক্যাপ" },
          { key: "status", header: "অবস্থা" },
        ]}
        rows={flashRows}
      />

      <h2 className="mb-3 mt-8 text-lg font-semibold">ক্যাম্পেইন (নমুনা)</h2>
      <DataTable
        caption="ক্যাম্পেইন তালিকা — পাঠানো হয়নি; খরচ শুধু আনুমানিক"
        columns={[
          { key: "template", header: "টেমপ্লেট" },
          { key: "channel", header: "চ্যানেল" },
          { key: "segment", header: "সেগমেন্ট" },
          { key: "recipients", header: "প্রাপক" },
          { key: "estimate", header: "আনুমানিক খরচ" },
          { key: "status", header: "অবস্থা" },
        ]}
        rows={campaignRows}
      />

      <div className="mt-6">
        <CampaignEstimate />
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">পরিত্যক্ত কার্ট ফলো-আপ (নমুনা)</h2>
      <DataTable
        caption="পরিত্যক্ত কার্ট — ফোন মুখোশ করা (masked); ফলো-আপ পাঠানো জব কিউ দিয়ে হয়, এই পেজ থেকে নয়"
        columns={[
          { key: "checkout", header: "চেকআউট" },
          { key: "phone", header: "ফোন" },
          { key: "channel", header: "চ্যানেল" },
          { key: "attempt", header: "চেষ্টা" },
          { key: "status", header: "অবস্থা" },
        ]}
        rows={abandonedRows}
      />
    </main>
  );
}

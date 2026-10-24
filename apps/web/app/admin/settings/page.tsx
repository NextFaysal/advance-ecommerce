import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

// Settings index — Agent 25.
// Landing page for Admin > Settings: a general summary (the built-in
// defaults from src/lib/settings SETTING_DEFAULTS — bn / BDT /
// Asia/Dhaka) plus cards into each subpage. Status on the cards is a
// DEMO boolean set, labelled as such: the real per-provider status
// comes from GET /api/v1/admin/settings, which returns only
// { enabled, configured } booleans — credential values are NEVER shown
// on any settings page (they live encrypted in the DB, server-side).

interface SettingsCardInfo {
  href: string;
  icon: string;
  titleBn: string;
  titleEn: string;
  description: string;
  /** TEMPORARY DEMO boolean — replaced by the Settings API status. */
  demoConfigured: boolean;
}

const CARDS: SettingsCardInfo[] = [
  {
    href: "/admin/settings/payments",
    icon: "💳",
    titleBn: "পেমেন্ট",
    titleEn: "Payments",
    description: "COD, bKash, Nagad, Rocket, Upay, SSLCommerz, AamarPay, ShurjoPay — পদ্ধতি চালু/বন্ধ, sandbox/live মোড।",
    demoConfigured: false,
  },
  {
    href: "/admin/settings/shipping",
    icon: "🚚",
    titleBn: "কুরিয়ার / শিপিং",
    titleEn: "Courier / Shipping",
    description: "Steadfast, Pathao, RedX, Paperfly, eCourier — জোন ও চার্জ, কুরিয়ার অ্যাকাউন্ট সংযোগ।",
    demoConfigured: false,
  },
  {
    href: "/admin/settings/notifications",
    icon: "🔔",
    titleBn: "নোটিফিকেশন",
    titleEn: "Notifications",
    description: "SMS (BulkSMSBD, SSL Wireless, Greenweb) ও ইমেইল (Resend + SMTP) প্রোভাইডার এবং টেমপ্লেট।",
    demoConfigured: false,
  },
  {
    href: "/admin/settings/integrations",
    icon: "🔌",
    titleBn: "ইন্টিগ্রেশন",
    titleEn: "Integrations",
    description: "স্টোরেজ (Cloudflare R2), সার্চ (Meilisearch) ও অন্যান্য বাইরের সেবার সংযোগ অবস্থা।",
    demoConfigured: false,
  },
  {
    href: "/admin/settings/tracking",
    icon: "📈",
    titleBn: "ট্র্যাকিং",
    titleEn: "Tracking",
    description: "Meta Pixel + CAPI, GA4, TikTok — পিক্সেল আইডি ও সার্ভার-সাইড ইভেন্ট সেটিংস।",
    demoConfigured: false,
  },
];

export default function AdminSettingsPage() {
  return (
    <main>
      <PageHeader
        title="সেটিংস"
        description="সব ইন্টিগ্রেশন অ্যাডমিন থেকেই কনফিগার করা যায়: env শুধু ডিফল্ট/ফলব্যাক, DB-তে এনক্রিপ্ট করা Settings মানই চূড়ান্ত (override)। (Settings)"
        breadcrumb="Admin / System"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="ভাষা (ডিফল্ট)" value="বাংলা (bn)" delta="fallback: English" icon="🌐" />
        <StatCard label="মুদ্রা" value="BDT (৳)" delta="পয়সা (integer) হিসাব" icon="৳" />
        <StatCard label="সময় অঞ্চল" value="Asia/Dhaka" delta="সব তারিখ/সময়" icon="🕐" />
        <StatCard label="সাব-পেজ" value={String(CARDS.length)} delta="নিচে কার্ড আকারে" icon="🧩" />
      </div>

      <Card className="mb-6">
        <h2 className="mb-1 font-semibold">সাধারণ সেটিংস সারাংশ</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-text-muted">ডিফল্ট ভাষা — <code>general.locale</code></dt>
            <dd className="font-semibold">bn (বাংলা), fallback en</dd>
          </div>
          <div>
            <dt className="text-text-muted">মুদ্রা — <code>general.currency</code></dt>
            <dd className="font-semibold">BDT — সব টাকা integer পয়সায় সংরক্ষিত</dd>
          </div>
          <div>
            <dt className="text-text-muted">সময় অঞ্চল — <code>general.timezone</code></dt>
            <dd className="font-semibold">Asia/Dhaka</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-text-muted">
          গোপন মান (API key, পাসওয়ার্ড) কখনো এই পেজে দেখানো হয় না — কার্ডগুলোতে শুধু
          কনফিগার হয়েছে/হয়নি (boolean) অবস্থা থাকে।
        </p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((card) => (
          <Card key={card.href}>
            <div className="flex items-start justify-between">
              <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-brand-50 text-xl">
                {card.icon}
              </span>
              <Badge tone={card.demoConfigured ? "success" : "warning"}>
                {card.demoConfigured ? "কনফিগার হয়েছে" : "কনফিগার হয়নি (ডেমো)"}
              </Badge>
            </div>
            <h3 className="mt-3 font-semibold">
              {card.titleBn} <span className="text-sm font-normal text-text-muted">· {card.titleEn}</span>
            </h3>
            <p className="mt-1 text-sm text-text-muted">{card.description}</p>
            <a href={card.href} className="mt-3 inline-block text-sm font-medium text-brand-700">
              খুলুন →
            </a>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-sm text-text-muted">
        নোট: কার্ডের অবস্থা এখন TEMPORARY DEMO boolean — আসল অবস্থা Settings API থেকে আসবে
        (শুধু enabled/configured boolean, কোনো credential মান নয়)।
      </p>
    </main>
  );
}

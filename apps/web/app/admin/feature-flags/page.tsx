import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { FlagList, type FlagListItem } from "./flag-list";
import { featureFlags } from "@/lib/feature-flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";

export const dynamic = "force-dynamic";

// Feature Flags admin.
// The catalogue below mirrors the FEATURE_FLAGS catalogue in
// packages/db/prisma/seed.ts (19 module.* keys, all seeded OFF) — the
// English descriptions are copied verbatim from the seed; Bangla text
// and module-page links are presentation only.
// REAL STATE (rewired 2026-10-25): each flag's ON/OFF state is read
// from the DB feature_flags table on every load (the same unified
// reader the modules use), and the toggles write through
// PATCH /api/v1/admin/feature-flags — persisted, reason-required and
// audit-logged. The API enforces settings.view (read) / settings.edit
// (change); the audit action recorded is feature_flags.manage.

const FLAG_CATALOGUE: Omit<FlagListItem, "enabled">[] = [
  {
    key: "module.reseller",
    descriptionEn: "Reseller panel (v2 add-on)",
    descriptionBn: "রিসেলার প্যানেল — রিসেলারদের জন্য আলাদা দাম, ওয়ালেট ও কমিশন",
    linkPath: "/admin/resellers",
    linkLabel: "রিসেলার",
  },
  {
    key: "module.call_center",
    descriptionEn: "Call center (v2 add-on)",
    descriptionBn: "কল সেন্টার — অর্ডার যাচাই কল, কিউ ও কলব্যাক",
    linkPath: "/admin/call-center",
    linkLabel: "কল সেন্টার",
  },
  {
    key: "module.pos",
    descriptionEn: "POS (v2 add-on)",
    descriptionBn: "POS — দোকানের কাউন্টার বিক্রি",
    linkPath: null,
    linkLabel: null,
  },
  {
    key: "module.multi_vendor",
    descriptionEn: "Multi-vendor (v2 add-on)",
    descriptionBn: "মাল্টি-ভেন্ডর — একাধিক বিক্রেতা, কমিশন ও পেআউট",
    linkPath: "/admin/vendors",
    linkLabel: "ভেন্ডর",
  },
  {
    key: "module.automation",
    descriptionEn: "Automation engine (v2 add-on)",
    descriptionBn: "অটোমেশন ইঞ্জিন — নিয়মভিত্তিক স্বয়ংক্রিয় কাজ",
    linkPath: "/admin/automation",
    linkLabel: "অটোমেশন",
  },
  {
    key: "module.fraud_scoring",
    descriptionEn: "Fraud / risk scoring (v2 add-on)",
    descriptionBn: "ফ্রড / ঝুঁকি স্কোরিং — অর্ডারের ঝুঁকি মূল্যায়ন",
    linkPath: "/admin/fraud",
    linkLabel: "ফ্রড যাচাই",
  },
  {
    key: "module.rider",
    descriptionEn: "Own rider management (v2 add-on)",
    descriptionBn: "নিজস্ব রাইডার ব্যবস্থাপনা — ডেলিভারি অ্যাসাইন ও COD হস্তান্তর",
    linkPath: "/admin/riders",
    linkLabel: "রাইডার",
  },
  {
    key: "module.f_commerce",
    descriptionEn: "F-commerce inbox (v2 add-on)",
    descriptionBn: "এফ-কমার্স ইনবক্স — Messenger/WhatsApp থেকে অর্ডার",
    linkPath: null,
    linkLabel: null,
  },
  {
    key: "module.ai_assist",
    descriptionEn: "AI assist (v2 add-on)",
    descriptionBn: "AI সহায়তা — বর্ণনা/SEO খসড়া (টেমপ্লেট ফলব্যাকসহ)",
    linkPath: null,
    linkLabel: null,
  },
  {
    key: "module.advanced_analytics",
    descriptionEn: "Advanced analytics (v2 add-on)",
    descriptionBn: "উন্নত অ্যানালিটিক্স — RFM, কোহর্ট, LTV/CAC",
    linkPath: "/admin/analytics",
    linkLabel: "অ্যানালিটিক্স",
  },
  {
    key: "module.b2b",
    descriptionEn: "B2B / wholesale (v2 add-on)",
    descriptionBn: "B2B / পাইকারি — টিয়ার দাম, কোটেশন ও ক্রেডিট",
    linkPath: "/admin/b2b",
    linkLabel: "B2B / পাইকারি",
  },
  {
    key: "module.fashion",
    descriptionEn: "Fashion pack (v2 add-on)",
    descriptionBn: "ফ্যাশন প্যাক — সাইজ চার্ট ও সাইজ গাইড",
    linkPath: "/admin/modules",
    linkLabel: "মডিউলসমূহ",
  },
  {
    key: "module.electronics",
    descriptionEn: "Electronics pack (v2 add-on)",
    descriptionBn: "ইলেকট্রনিক্স প্যাক — ওয়ারেন্টি ও EMI হিসাব",
    linkPath: "/admin/modules",
    linkLabel: "মডিউলসমূহ",
  },
  {
    key: "module.grocery",
    descriptionEn: "Grocery pack (v2 add-on)",
    descriptionBn: "গ্রোসারি প্যাক — ওজনভিত্তিক দাম ও ডেলিভারি স্লট",
    linkPath: "/admin/modules",
    linkLabel: "মডিউলসমূহ",
  },
  {
    key: "module.pharmacy",
    descriptionEn: "Pharmacy pack (v2 add-on)",
    descriptionBn: "ফার্মেসি প্যাক — প্রেসক্রিপশন গেট ও মেয়াদ সতর্কতা",
    linkPath: "/admin/modules",
    linkLabel: "মডিউলসমূহ",
  },
  {
    key: "module.digital_goods",
    descriptionEn: "Digital goods pack (v2 add-on)",
    descriptionBn: "ডিজিটাল পণ্য প্যাক — লাইসেন্স কী ও ডাউনলোড সীমা",
    linkPath: "/admin/modules",
    linkLabel: "মডিউলসমূহ",
  },
  {
    key: "module.erp_lite",
    descriptionEn: "ERP-lite accounting (v2 add-on)",
    descriptionBn: "ERP-লাইট হিসাব — জার্নাল, খতিয়ান ও VAT রিপোর্ট",
    linkPath: "/admin/erp",
    linkLabel: "ERP হিসাব",
  },
  {
    key: "module.loyalty",
    descriptionEn: "Loyalty, referral & affiliate (v2 add-on)",
    descriptionBn: "লয়্যালটি, রেফারেল ও অ্যাফিলিয়েট — পয়েন্ট, রেফারেল পুরস্কার ও অ্যাফিলিয়েট কমিশন",
    linkPath: "/admin/loyalty",
    linkLabel: "লয়্যালটি",
  },
  {
    key: "module.advanced_orders",
    descriptionEn: "Advanced orders: split, partial, exchange, pre-order (v2 add-on)",
    descriptionBn: "অ্যাডভান্সড অর্ডার — স্প্লিট শিপমেন্ট, আংশিক পেমেন্ট, এক্সচেঞ্জ ও প্রি-অর্ডার",
    linkPath: "/admin/advanced-orders",
    linkLabel: "অ্যাডভান্সড অর্ডার",
  },
];

export default async function AdminFeatureFlagsPage() {
  let states: Map<string, boolean> | null = null;
  try {
    await ensureDbFeatureFlags();
    states = new Map(featureFlags.listFeatureFlags().map((f) => [f.key, f.enabled]));
  } catch {
    states = null;
  }

  const items: FlagListItem[] = FLAG_CATALOGUE.map((f) => ({
    ...f,
    enabled: states?.get(f.key) ?? false,
  }));
  const withPage = FLAG_CATALOGUE.filter((f) => f.linkPath !== null).length;
  const onCount = items.filter((f) => f.enabled).length;

  return (
    <main>
      <PageHeader
        title="ফিচার ফ্ল্যাগ"
        description="আসল ফ্ল্যাগ অবস্থা — DB-র feature_flags টেবিল থেকে পড়া। টগল বদলালে তা সংরক্ষিত হয় এবং অডিট লগে কারণসহ থাকে। (Feature Flags — feature_flags.manage)"
        breadcrumb="Admin / System"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="মোট ফ্ল্যাগ (seed ক্যাটালগ)" value={String(FLAG_CATALOGUE.length)} delta="seed.ts FEATURE_FLAGS" icon={<Icon name="grid" size={22} />} />
        <StatCard label="এখন চালু আছে" value={states === null ? "—" : String(onCount)} delta="আসল DB অবস্থা" icon={<Icon name="check" size={22} />} />
        <StatCard label="মডিউল পেজ আছে" value={String(withPage)} delta="বাকিগুলো API দিয়ে" icon={<Icon name="package" size={22} />} />
        <StatCard label="বদলের অনুমতি" value="settings.edit" delta="কারণ + অডিট লগ আবশ্যক" icon={<Icon name="shield" size={22} />} />
      </div>

      <Card className="mb-6 border-sky-200 bg-sky-50">
        <p className="text-sm font-medium text-sky-900">এই টগলগুলো আসল — বদল সংরক্ষিত হয়</p>
        <p className="mt-1 text-sm text-sky-800">
          সুইচ বদলালে কারণ চাওয়া হবে, তারপর বদলটি DB-র{" "}
          <code className="font-mono text-xs">feature_flags</code> টেবিলে সংরক্ষিত হয় এবং
          সংশ্লিষ্ট মডিউল সঙ্গে সঙ্গে নতুন অবস্থা দেখে। প্রতিটি বদল অডিট লগে{" "}
          <code className="font-mono text-xs">feature_flags.manage</code> নামে কারণসহ থাকে।
          প্রতিটি অ্যাড-অন পেইড মডিউল — ক্লায়েন্ট অনুযায়ী আলাদা করে খোলা হয়, একবারে সব নয়।
        </p>
      </Card>

      <h2 className="mb-3 text-lg font-semibold">সব ফ্ল্যাগ — seed ক্যাটালগ (অবস্থা DB থেকে)</h2>
      {states === null ? (
        <Card className="border-rose-300 bg-rose-50 text-sm text-rose-900">
          ডাটাবেস থেকে ফ্ল্যাগের অবস্থা পড়া যায়নি — তাই টগল দেখানো হচ্ছে না (ভুয়া অবস্থা
          দেখানোর চেয়ে এটাই সৎ)। ডাটাবেস সংযোগ ঠিক করে পেজটি আবার লোড করুন।
        </Card>
      ) : (
        <Card>
          <FlagList items={items} />
        </Card>
      )}
    </main>
  );
}

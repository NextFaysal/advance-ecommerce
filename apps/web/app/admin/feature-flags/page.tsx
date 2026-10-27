import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { FlagList, type FlagListItem } from "./flag-list";
import { featureFlags } from "@/lib/feature-flags";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { FEATURE_FLAGS_STRINGS, type FeatureFlagsStrings } from "./strings";
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

interface CatalogueEntry {
  key: string;
  descriptionEn: string;
  descriptionBn: string;
  linkPath: string | null;
  linkLabelKey: keyof FeatureFlagsStrings | null;
}

const FLAG_CATALOGUE: CatalogueEntry[] = [
  {
    key: "module.reseller",
    descriptionEn: "Reseller panel (v2 add-on)",
    descriptionBn: "রিসেলার প্যানেল — রিসেলারদের জন্য আলাদা দাম, ওয়ালেট ও কমিশন",
    linkPath: "/admin/resellers",
    linkLabelKey: "linkResellers",
  },
  {
    key: "module.call_center",
    descriptionEn: "Call center (v2 add-on)",
    descriptionBn: "কল সেন্টার — অর্ডার যাচাই কল, কিউ ও কলব্যাক",
    linkPath: "/admin/call-center",
    linkLabelKey: "linkCallCenter",
  },
  {
    key: "module.pos",
    descriptionEn: "POS (v2 add-on)",
    descriptionBn: "POS — দোকানের কাউন্টার বিক্রি",
    linkPath: null,
    linkLabelKey: null,
  },
  {
    key: "module.multi_vendor",
    descriptionEn: "Multi-vendor (v2 add-on)",
    descriptionBn: "মাল্টি-ভেন্ডর — একাধিক বিক্রেতা, কমিশন ও পেআউট",
    linkPath: "/admin/vendors",
    linkLabelKey: "linkVendors",
  },
  {
    key: "module.automation",
    descriptionEn: "Automation engine (v2 add-on)",
    descriptionBn: "অটোমেশন ইঞ্জিন — নিয়মভিত্তিক স্বয়ংক্রিয় কাজ",
    linkPath: "/admin/automation",
    linkLabelKey: "linkAutomation",
  },
  {
    key: "module.fraud_scoring",
    descriptionEn: "Fraud / risk scoring (v2 add-on)",
    descriptionBn: "ফ্রড / ঝুঁকি স্কোরিং — অর্ডারের ঝুঁকি মূল্যায়ন",
    linkPath: "/admin/fraud",
    linkLabelKey: "linkFraud",
  },
  {
    key: "module.rider",
    descriptionEn: "Own rider management (v2 add-on)",
    descriptionBn: "নিজস্ব রাইডার ব্যবস্থাপনা — ডেলিভারি অ্যাসাইন ও COD হস্তান্তর",
    linkPath: "/admin/riders",
    linkLabelKey: "linkRiders",
  },
  {
    key: "module.f_commerce",
    descriptionEn: "F-commerce inbox (v2 add-on)",
    descriptionBn: "এফ-কমার্স ইনবক্স — Messenger/WhatsApp থেকে অর্ডার",
    linkPath: null,
    linkLabelKey: null,
  },
  {
    key: "module.ai_assist",
    descriptionEn: "AI assist (v2 add-on)",
    descriptionBn: "AI সহায়তা — বর্ণনা/SEO খসড়া (টেমপ্লেট ফলব্যাকসহ)",
    linkPath: null,
    linkLabelKey: null,
  },
  {
    key: "module.advanced_analytics",
    descriptionEn: "Advanced analytics (v2 add-on)",
    descriptionBn: "উন্নত অ্যানালিটিক্স — RFM, কোহর্ট, LTV/CAC",
    linkPath: "/admin/analytics",
    linkLabelKey: "linkAnalytics",
  },
  {
    key: "module.b2b",
    descriptionEn: "B2B / wholesale (v2 add-on)",
    descriptionBn: "B2B / পাইকারি — টিয়ার দাম, কোটেশন ও ক্রেডিট",
    linkPath: "/admin/b2b",
    linkLabelKey: "linkB2b",
  },
  {
    key: "module.fashion",
    descriptionEn: "Fashion pack (v2 add-on)",
    descriptionBn: "ফ্যাশন প্যাক — সাইজ চার্ট ও সাইজ গাইড",
    linkPath: "/admin/modules",
    linkLabelKey: "linkModules",
  },
  {
    key: "module.electronics",
    descriptionEn: "Electronics pack (v2 add-on)",
    descriptionBn: "ইলেকট্রনিক্স প্যাক — ওয়ারেন্টি ও EMI হিসাব",
    linkPath: "/admin/modules",
    linkLabelKey: "linkModules",
  },
  {
    key: "module.grocery",
    descriptionEn: "Grocery pack (v2 add-on)",
    descriptionBn: "গ্রোসারি প্যাক — ওজনভিত্তিক দাম ও ডেলিভারি স্লট",
    linkPath: "/admin/modules",
    linkLabelKey: "linkModules",
  },
  {
    key: "module.pharmacy",
    descriptionEn: "Pharmacy pack (v2 add-on)",
    descriptionBn: "ফার্মেসি প্যাক — প্রেসক্রিপশন গেট ও মেয়াদ সতর্কতা",
    linkPath: "/admin/modules",
    linkLabelKey: "linkModules",
  },
  {
    key: "module.digital_goods",
    descriptionEn: "Digital goods pack (v2 add-on)",
    descriptionBn: "ডিজিটাল পণ্য প্যাক — লাইসেন্স কী ও ডাউনলোড সীমা",
    linkPath: "/admin/modules",
    linkLabelKey: "linkModules",
  },
  {
    key: "module.erp_lite",
    descriptionEn: "ERP-lite accounting (v2 add-on)",
    descriptionBn: "ERP-লাইট হিসাব — জার্নাল, খতিয়ান ও VAT রিপোর্ট",
    linkPath: "/admin/erp",
    linkLabelKey: "linkErp",
  },
  {
    key: "module.loyalty",
    descriptionEn: "Loyalty, referral & affiliate (v2 add-on)",
    descriptionBn: "লয়্যালটি, রেফারেল ও অ্যাফিলিয়েট — পয়েন্ট, রেফারেল পুরস্কার ও অ্যাফিলিয়েট কমিশন",
    linkPath: "/admin/loyalty",
    linkLabelKey: "linkLoyalty",
  },
  {
    key: "module.advanced_orders",
    descriptionEn: "Advanced orders: split, partial, exchange, pre-order (v2 add-on)",
    descriptionBn: "অ্যাডভান্সড অর্ডার — স্প্লিট শিপমেন্ট, আংশিক পেমেন্ট, এক্সচেঞ্জ ও প্রি-অর্ডার",
    linkPath: "/admin/advanced-orders",
    linkLabelKey: "linkAdvancedOrders",
  },
];

export default async function AdminFeatureFlagsPage() {
  const locale = await getRequestLocale();
  const t = pick(locale, FEATURE_FLAGS_STRINGS);
  let states: Map<string, boolean> | null = null;
  try {
    await ensureDbFeatureFlags();
    states = new Map(featureFlags.listFeatureFlags().map((f) => [f.key, f.enabled]));
  } catch {
    states = null;
  }

  const items: FlagListItem[] = FLAG_CATALOGUE.map((f) => ({
    key: f.key,
    description: locale === "bn" ? f.descriptionBn : f.descriptionEn,
    linkPath: f.linkPath,
    linkLabel: f.linkLabelKey ? t[f.linkLabelKey] : null,
    enabled: states?.get(f.key) ?? false,
  }));
  const withPage = FLAG_CATALOGUE.filter((f) => f.linkPath !== null).length;
  const onCount = items.filter((f) => f.enabled).length;

  return (
    <main>
      <PageHeader title={t.title} description={t.description} breadcrumb={t.breadcrumb} />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t.statTotal} value={String(FLAG_CATALOGUE.length)} delta={t.statTotalDelta} icon={<Icon name="grid" size={22} />} />
        <StatCard label={t.statOn} value={states === null ? "—" : String(onCount)} delta={t.statOnDelta} icon={<Icon name="check" size={22} />} />
        <StatCard label={t.statWithPage} value={String(withPage)} delta={t.statWithPageDelta} icon={<Icon name="package" size={22} />} />
        <StatCard label={t.statPermission} value="settings.edit" delta={t.statPermissionDelta} icon={<Icon name="shield" size={22} />} />
      </div>

      <Card className="mb-6 border-sky-200 bg-sky-50">
        <p className="text-sm font-medium text-sky-900">{t.realTogglesTitle}</p>
        <p className="mt-1 text-sm text-sky-800">
          {t.realTogglesA}
          <code className="font-mono text-xs">feature_flags</code>
          {t.realTogglesB}
          <code className="font-mono text-xs">feature_flags.manage</code>
          {t.realTogglesC}
        </p>
      </Card>

      <h2 className="mb-3 text-lg font-semibold">{t.allFlagsTitle}</h2>
      {states === null ? (
        <Card className="border-rose-300 bg-rose-50 text-sm text-rose-900">{t.dbReadFailed}</Card>
      ) : (
        <Card>
          <FlagList items={items} />
        </Card>
      )}
    </main>
  );
}

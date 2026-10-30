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
    key: "module.reseller_portal",
    descriptionEn: "Reseller self-service portal (v2 add-on, ADV-12)",
    descriptionBn: "রিসেলার সেলফ-সার্ভিস পোর্টাল",
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
    key: "module.call_center_automation",
    descriptionEn: "Call center follow-up automation — auto SMS + retry backoff (v2 add-on)",
    descriptionBn: "কল সেন্টার ফলো-আপ অটোমেশন — অটো এসএমএস ও রিট্রাই ব্যাকঅফ",
    linkPath: "/admin/call-center",
    linkLabelKey: "linkCallCenter",
  },
  {
    key: "module.pos",
    descriptionEn: "POS (v2 add-on)",
    descriptionBn: "POS — দোকানের কাউন্টার বিক্রি",
    linkPath: "/admin/pos",
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
    key: "module.vendor_portal",
    descriptionEn: "Vendor self-service portal (v2 add-on, ADV-13)",
    descriptionBn: "ভেন্ডর সেলফ-সার্ভিস পোর্টাল",
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
    linkPath: "/admin/inbox",
    linkLabelKey: null,
  },
  {
    key: "module.ai_assist",
    descriptionEn: "AI assist (v2 add-on)",
    descriptionBn: "AI সহায়তা — বর্ণনা/SEO খসড়া (টেমপ্লেট ফলব্যাকসহ)",
    linkPath: "/admin/ai-assist",
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
    key: "module.b2b_portal",
    descriptionEn: "B2B buyer portal (v2 add-on, ADV-14)",
    descriptionBn: "B2B ক্রেতা পোর্টাল",
    linkPath: "/admin/b2b",
    linkLabelKey: "linkB2b",
  },
  {
    key: "module.marketing_mechanics",
    descriptionEn: "Marketing mechanics: gift cards, membership tiers, spin wheel, A/B tests, bundle builder, EMI display, WhatsApp broadcast (v2 add-on, ADV-18)",
    descriptionBn: "মার্কেটিং মেকানিক্স — গিফট কার্ড, মেম্বারশিপ টায়ার, স্পিন হুইল, A/B টেস্ট, বান্ডেল বিল্ডার",
    linkPath: "/admin/marketing",
    linkLabelKey: "linkMarketing",
  },
  {
    key: "module.subscriptions",
    descriptionEn: "Customer subscriptions / auto-replenish (v2 add-on, ADV-18)",
    descriptionBn: "কাস্টমার সাবস্ক্রিপশন / অটো-রিপ্লেনিশ — নিয়মিত পুনরাবৃত্তিমূলক অর্ডার ইঞ্জিন",
    linkPath: "/admin/subscriptions",
    linkLabelKey: "linkSubscriptions",
  },
  {
    key: "module.subscription_boxes",
    descriptionEn: "Subscription boxes: curated recurring boxes with per-cycle rotating contents on the subscription engine (v2 add-on, ADV-23)",
    descriptionBn: "সাবস্ক্রিপশন বক্স — নির্দিষ্ট সাইকেল অনুযায়ী আবর্তিত পণ্যসহ কিউরেটেড রিকারিং বক্স",
    linkPath: "/admin/boxes",
    linkLabelKey: "linkSubscriptionBoxes",
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
  {
    key: "module.product_types",
    descriptionEn: "Product types: digital, bundle & pre-order products (v2 add-on)",
    descriptionBn: "প্রোডাক্ট টাইপস — ডিজিটাল, বান্ডেল ও প্রি-অর্ডার প্রোডাক্ট",
    linkPath: "/admin/products",
    linkLabelKey: null,
  },
  {
    key: "module.sourcing",
    descriptionEn: "Sourcing import + landed-cost calculator (v2 add-on)",
    descriptionBn: "সোর্সিং ইমপোর্ট ও ল্যান্ডেড-কস্ট ক্যালকুলেটর",
    linkPath: "/admin/sourcing",
    linkLabelKey: "linkSourcing",
  },
  {
    key: "module.product_extras",
    descriptionEn: "Product extras: 360° view + barcode labels (v2 add-on)",
    descriptionBn: "প্রোডাক্ট এক্সট্রাস — ৩৬০° ভিউ ও বারকোড লেবেল",
    linkPath: "/admin/products",
    linkLabelKey: null,
  },
  {
    key: "module.inventory_depth",
    descriptionEn: "Inventory depth: batch/expiry, serial/IMEI, ABC + dead-stock, auto-reorder (v2 add-on, ADV-20)",
    descriptionBn: "ইনভেন্টরি ডেপথ — ব্যাচ/এক্সপায়ারি, সিরিয়াল/IMEI, ডেড-স্টক ও অটো-রিঅর্ডার",
    linkPath: "/admin/inventory",
    linkLabelKey: null,
  },
  {
    key: "module.warehouse_ops",
    descriptionEn: "Warehouse ops: pick, pack & ship scanning (v2 add-on, ADV-21)",
    descriptionBn: "ওয়্যারহাউস অপস — পিক, প্যাক ও শিপ বারকোড স্ক্যানিং",
    linkPath: "/admin/warehouse",
    linkLabelKey: "linkWarehouse",
  },
  {
    key: "module.social_proof",
    descriptionEn: "Social proof — honest variants only: real recent-orders ticker + real low-stock lines (v2 add-on, P11)",
    descriptionBn: "সোশ্যাল প্রুফ — রিয়েল সাম্প্রতিক অর্ডার টিকার ও লো-স্টক সতর্কতা",
    linkPath: null,
    linkLabelKey: null,
  },
  {
    key: "module.restaurant",
    descriptionEn: "Restaurant + kitchen display (KDS): dine-in tables & takeaway tickets (v2 add-on, ADV-23)",
    descriptionBn: "রেস্তোরাঁ ও কিচেন ডিসপ্লে (KDS) — ডাইন-ইন টেবিল ও টেকঅ্যাওয়ে টিকেট",
    linkPath: "/admin/restaurant",
    linkLabelKey: "linkRestaurant",
  },
  {
    key: "module.services",
    descriptionEn: "Services + appointment booking: bookable service variants, slot calendar + bookings board (v2 add-on, ADV-23)",
    descriptionBn: "সার্ভিস ও অ্যাপয়েন্টমেন্ট বুকিং — বুকিং স্লট ক্যালেন্ডার ও বোর্ড",
    linkPath: "/admin/services",
    linkLabelKey: "linkServices",
  },
  {
    key: "module.rental",
    descriptionEn: "Rental: rentable variants, date-range booking with stock-overlap availability + security deposit (v2 add-on, ADV-23)",
    descriptionBn: "রেন্টাল — তারিখ-সীমা অনুযায়ী ভাড়া, স্টক প্রাপ্যতা ও সিকিউরিটি ডিপোজিট",
    linkPath: "/admin/rental",
    linkLabelKey: "linkRental",
  },
  {
    key: "module.print_on_demand",
    descriptionEn: "Print-on-demand: custom print text + colour on listed variants, per-item print fee, admin print queue (v2 add-on, ADV-23)",
    descriptionBn: "প্রিন্ট অন ডিমান্ড — কাস্টম টেক্সট/কালার প্রিন্ট ও প্রিন্ট কিউ",
    linkPath: "/admin/print-on-demand",
    linkLabelKey: "linkPrintOnDemand",
  },
  {
    key: "module.courses",
    descriptionEn: "Courses / LMS-lite: sell DIGITAL course variants, buyers get order-derived access to module/lesson content (v2 add-on, ADV-23)",
    descriptionBn: "কোর্স / LMS — ডিজিটাল কোর্স বিক্রি ও লেসন কনটেন্ট অ্যাক্সেস",
    linkPath: "/admin/courses",
    linkLabelKey: "linkCourses",
  },
  {
    key: "module.ai_content",
    descriptionEn: "AI content: provider-backed bilingual product description + SEO drafts for the product editor (v2 add-on, ADV-24)",
    descriptionBn: "AI কনটেন্ট — প্রোডাক্টের দ্বৈতভাষিক বিবরণ ও SEO ড্রাফট",
    linkPath: null,
    linkLabelKey: null,
  },
  {
    key: "module.workflow_stages",
    descriptionEn: "Custom order workflow stages: merchant labels anchored to canonical order statuses, shown as chips + tracking step (v2 add-on, ADV-26)",
    descriptionBn: "কাস্টম অর্ডার ওয়ার্কফ্লো স্টেজ — নিজস্ব স্টেজ লেবেল ও ট্র্যাকিং ধাপ",
    linkPath: "/admin/settings/orders",
    linkLabelKey: null,
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
    <main className="space-y-6">
      <PageHeader title={t.title} description={t.description} breadcrumb={t.breadcrumb} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t.statTotal} value={String(FLAG_CATALOGUE.length)} delta={t.statTotalDelta} icon={<Icon name="grid" size={22} />} />
        <StatCard label={t.statOn} value={states === null ? "—" : String(onCount)} delta={t.statOnDelta} icon={<Icon name="check" size={22} />} />
        <StatCard label={t.statWithPage} value={String(withPage)} delta={t.statWithPageDelta} icon={<Icon name="package" size={22} />} />
        <StatCard label={t.statPermission} value="settings.edit" delta={t.statPermissionDelta} icon={<Icon name="shield" size={22} />} />
      </div>

      <Card className="border-border/60 bg-surface-2/60">
        <p className="text-sm font-medium text-text-main">{t.realTogglesTitle}</p>
        <p className="mt-1 text-sm text-text-muted">
          {t.realTogglesA}
          <code className="font-mono text-xs">feature_flags</code>
          {t.realTogglesB}
          <code className="font-mono text-xs">feature_flags.manage</code>
          {t.realTogglesC}
        </p>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-main">{t.allFlagsTitle}</h2>
        {states === null ? (
          <Card className="border-danger/30 bg-danger-soft text-sm text-danger">{t.dbReadFailed}</Card>
        ) : (
          <Card>
            <FlagList items={items} />
          </Card>
        )}
      </section>
    </main>
  );
}

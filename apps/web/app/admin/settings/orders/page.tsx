import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Icon } from "@/components/ui/icon";
import { getSetting } from "@/lib/settings";
import { loadOrderRules, PERMISSIVE_ORDER_RULES } from "@/checkout/order-rules";
import {
  DEFAULT_DELIVERY_SLOTS,
  DEFAULT_DELIVERY_SLOTS_JSON,
  loadDeliverySlots,
} from "@/checkout/delivery-slots";
import { FULL_GEO_DICTIONARY } from "@/bd/geo-dictionary";
import { listCategoriesAdmin } from "@/catalog/taxonomy-admin";
import { loadPickupPoints, loadRetailLocations, type PickupPoint } from "@/checkout/pickup-points";
import { OrderRulesCard, type CategoryOption, type DistrictGroup } from "./order-rules-card";
import { DeliverySlotsCard } from "./delivery-slots-card";
import { PickupPointsCard } from "./pickup-points-card";
import { WorkflowStagesCard } from "./workflow-stages-card";
import { isWorkflowStagesEnabled, loadWorkflowStagesConfig } from "@/orders/stages";

// Admin > Settings > Orders — order rules + delivery slots (doc 18,
// F2-1). Until now the `orders.rules.*` keys (wave 20) and
// `orders.delivery_slots` (wave 27) could only be changed by writing
// the Settings store through the generic API — no UI existed, the
// same gap the wave-16 VAT card closed for accounting. This page is
// that UI: it reads the effective values server-side through the very
// loaders checkout enforces (loadOrderRules / loadDeliverySlots, both
// fail-open), and the cards save through the standard Settings API,
// which requires a reason and writes the settings.update audit row.
// No rule or slot behaviour changes here — only who can edit them.
export const dynamic = "force-dynamic";

/** District picker data: the canonical geo tree (the same dataset
 *  GET /api/v1/public/geo serves checkout), flattened to names only —
 *  orders store the nameEn strings and the rule matches them
 *  case-insensitively; nameBn is the display label. */
function buildDistrictGroups(): DistrictGroup[] {
  return FULL_GEO_DICTIONARY.divisions.map((division) => ({
    divisionEn: division.nameEn,
    divisionBn: division.nameBn,
    districts: FULL_GEO_DICTIONARY.districts
      .filter((d) => d.divisionEn === division.nameEn)
      .map((d) => ({ nameEn: d.nameEn, nameBn: d.nameBn })),
  }));
}

export default async function OrderSettingsPage() {
  let dbReady = true;
  let workflowStages: Awaited<ReturnType<typeof loadWorkflowStagesConfig>> = {
    config: { stages: [] },
    source: "default",
  };
  let workflowStagesEnabled = false;
  let rules = PERMISSIVE_ORDER_RULES;
  let slots = DEFAULT_DELIVERY_SLOTS;
  let slotsCustomized = false;
  let categories: CategoryOption[] = [];
  let pickupPoints: PickupPoint[] = [];
  let pickupConfigured = false;
  let retailLocations: PickupPoint[] = [];
  let retailConfigured = false;
  try {
    const [loadedRules, loadedSlots, rawSlots, adminCategories, loadedPickup, rawPickup, loadedRetail, rawRetail] = await Promise.all([
      loadOrderRules(),
      loadDeliverySlots(),
      getSetting("orders.delivery_slots"),
      listCategoriesAdmin(),
      loadPickupPoints(),
      getSetting("stores.pickup_points"),
      loadRetailLocations(),
      getSetting("stores.retail_locations"),
    ]);
    rules = loadedRules;
    // ADV-26 (BUILD-LITE): workflow-stages document + flag state for
    // the editor card below (fail-soft loader — defaults on error,
    // and the surrounding catch still owns dbReady).
    workflowStages = await loadWorkflowStagesConfig();
    workflowStagesEnabled = isWorkflowStagesEnabled();
    slots = loadedSlots;
    pickupPoints = loadedPickup;
    // Display copy only: a stored non-empty document is unmistakably
    // "configured"; an empty one is indistinguishable from the
    // registered default through getSetting, and reads as such.
    pickupConfigured = rawPickup !== null && rawPickup !== "[]";
    retailLocations = loadedRetail;
    retailConfigured = rawRetail !== null && rawRetail !== "[]";
    // getSetting falls back to the registered default when no row is
    // stored, so "customized" = a stored value that differs from the
    // built-in default JSON (saving the defaults back reads the same).
    slotsCustomized = rawSlots !== null && rawSlots !== DEFAULT_DELIVERY_SLOTS_JSON;
    categories = adminCategories.map((c) => ({
      slug: c.slug,
      nameBn: c.nameBn,
      nameEn: c.nameEn,
      isActive: c.isActive,
    }));
  } catch {
    dbReady = false;
  }

  return (
    <main className="min-w-0">
      <PageHeader
        title="অর্ডার — নিয়ম ও ডেলিভারি স্লট"
        description="চেকআউটে কোন নিয়ম চলবে (সর্বনিম্ন অর্ডার, অগ্রিম, COD বন্ধের তালিকা) আর ক্রেতা কোন কোন ডেলিভারি সময় বেছে নিতে পারবেন — সব এই পেজ থেকে। প্রতিটি পরিবর্তন কারণসহ অডিট লগে থাকে।"
        breadcrumb="সেটিংস / অর্ডার"
        actions={
          <Link
            href="/admin/settings"
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300"
          >
            ← সব সেটিংস
          </Link>
        }
      />

      <section className="mt-4 rounded-lg border border-border/70 bg-card p-5 shadow-card">
        <h2 className="flex items-center gap-2.5 font-display text-base font-semibold text-text-main">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
            <Icon name="info" size={17} />
          </span>
          এই পেজের নিয়মগুলো দিয়ে কী হয়?
        </h2>
        <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-text-muted">
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              <strong>সর্বনিম্ন অর্ডার:</strong> পণ্যের উপমোট এর কম হলে পাবলিক চেকআউটে অর্ডার নেওয়া হয় না।
              খালি/0 মানে নিয়ম বন্ধ — যেকোনো পরিমাণের অর্ডার চলবে।
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              <strong>অগ্রিম নিয়ম:</strong> COD অর্ডারের মোট দাম সীমার বেশি হলে মোটের নির্ধারিত শতকরা অংশ
              অগ্রিম হিসেবে চিহ্নিত হয় — অগ্রিম সংগ্রহ ও কনফার্ম-গেট অগ্রিম ব্যবস্থা (পেমেন্ট লিংক/OTP) দিয়ে হয়,
              এই পেজ শুধু সীমা ও হার ঠিক করে।
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              <strong>COD বন্ধের তালিকা:</strong> নির্বাচিত জেলার ঠিকানায়, অথবা নির্বাচিত ক্যাটাগরির পণ্য
              থাকলে, ক্যাশ অন ডেলিভারি দেওয়া হয় না — ক্রেতাকে আগাম পেমেন্ট করতে হয়।
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              <strong>ডেলিভারি স্লট:</strong> অর্ডারে স্লটের আইডি সংরক্ষিত থাকে, লেবেল দেখানো হয় বর্তমান
              তালিকা থেকে — তাই লেবেল বদলালে পুরনো অর্ডারেও নতুন লেবেল দেখাবে, কিন্তু আইডি বদলালে পুরনো
              অর্ডারের স্লট মিলবে না (এ কারণেই সংরক্ষিত আইডি এখানে বদলানো যায় না)।
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              সব নিয়মই <strong>বন্ধ রাখা যায়</strong> — কিছু সেট না করলে চেকআউট আগের মতোই চলবে। সেটিংস পড়া
              না গেলেও চেকআউট কখনো আটকায় না (নিয়মগুলো fail-open)।
            </span>
          </li>
        </ul>
      </section>

      <div className="mt-4">
        <OrderRulesCard
          initial={{
            minOrderPoisha: rules.minOrderPoisha,
            advanceRequiredAbovePoisha: rules.advanceRequiredAbovePoisha,
            advancePercent: rules.advancePercent,
            codDisabledDistricts: [...rules.codDisabledDistricts],
            codDisabledCategories: [...rules.codDisabledCategories],
          }}
          districtGroups={buildDistrictGroups()}
          categories={categories}
          dbReady={dbReady}
        />
      </div>

      <div className="mt-4">
        <DeliverySlotsCard initialSlots={slots} storedCustomized={slotsCustomized} dbReady={dbReady} />
      </div>

      {/* ADV-19: click & collect pickup points + store locations.
          Pickup points are offered at checkout; retail locations only
          appear on the /stores page. */}
      <div className="mt-4">
        <PickupPointsCard
          settingKey="stores.pickup_points"
          title="পিকআপ পয়েন্ট (ক্লিক অ্যান্ড কালেক্ট)"
          description="চেকআউটে ক্রেতা পিকআপ বেছে নিলে এই পয়েন্টগুলো থেকে একটি বেছে নিতে পারবেন; পছন্দটি অর্ডারের নোটে পয়েন্টের নাম-ঠিকানাসহ সংরক্ষিত থাকে। এই পয়েন্টগুলো /stores পেজেও দেখানো হয়।"
          initialPoints={pickupPoints}
          storedConfigured={pickupConfigured}
          dbReady={dbReady}
        />
      </div>

      {/* ADV-26 (BUILD-LITE): merchant workflow stages — labels
          anchored at canonical statuses (orders.workflow_stages
          document; src/orders/stages.ts). */}
      <div className="mt-4">
        <WorkflowStagesCard
          initialStages={workflowStages.config.stages}
          storedConfigured={workflowStages.source === "saved"}
          moduleEnabled={workflowStagesEnabled}
          dbReady={dbReady}
        />
      </div>

      <div className="mt-4">
        <PickupPointsCard
          settingKey="stores.retail_locations"
          title="স্টোর লোকেশন (/stores পেজ)"
          description="শুধু /stores পেজে দেখানোর জন্য — এই লোকেশনগুলো চেকআউটে পিকআপ পয়েন্ট হিসেবে দেওয়া হয় না।"
          initialPoints={retailLocations}
          storedConfigured={retailConfigured}
          dbReady={dbReady}
        />
      </div>

      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-text-muted">
        সেটিং কী:
        <code className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 font-mono text-xs ring-1 ring-inset ring-black/5">orders.rules.*</code>
        <code className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 font-mono text-xs ring-1 ring-inset ring-black/5">orders.delivery_slots</code>
        <code className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 font-mono text-xs ring-1 ring-inset ring-black/5">stores.pickup_points</code>
        <code className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 font-mono text-xs ring-1 ring-inset ring-black/5">stores.retail_locations</code>
        <code className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 font-mono text-xs ring-1 ring-inset ring-black/5">orders.workflow_stages</code>
        — টাকার মান পয়সায় (integer), জেলা/ক্যাটাগরি তালিকা কমা দিয়ে আলাদা করে, স্লট JSON আকারে সংরক্ষিত হয়।
        প্রতিটি পরিবর্তন কারণসহ অডিট লগে (<span className="font-mono text-xs">settings.update</span>) লেখা থাকে।
      </p>
    </main>
  );
}

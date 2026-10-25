/**
 * Admin navigation — single source of truth (Agent 23).
 *
 * Pure data + helpers, safe to import from server or client components.
 * Every item points at a page that exists on disk under `app/admin/**`
 * (verified 2026-10-24). Sub-routes that are not destinations of their own
 * (`/admin/orders/[id]`, `/admin/products/new`) are intentionally NOT nav
 * items — they are reached from their parent pages, and the dashboard
 * quick actions link to `/admin/products/new` directly.
 *
 * Conventions (matching the rest of the build):
 * - `permission` is a key from `src/lib/rbac.ts` PERMISSIONS; `null` means
 *   "any signed-in staff member" (dashboard home only). Nav visibility is
 *   a UX gate only — every API route still enforces its own permission.
 * - `featureFlag` is the seeded `feature_flags` key for paid add-on
 *   modules. All flags seed OFF, so a flagged item carries
 *   `badge: "locked-add-on"`: it stays LISTED (never hidden) with a lock
 *   badge, and its page renders a lock panel while the flag is off —
 *   the same pattern as the modules / riders / automation pages.
 * - `icon` is a Lucide component name (string) so this file stays free of
 *   component imports; the shell maps names to components when it adopts
 *   this config.
 */
import type { PermissionKey } from "../lib/rbac";

export type AdminNavSectionId =
  | "overview"
  | "sales"
  | "catalog"
  | "customers"
  | "marketing"
  | "insights"
  | "addons"
  | "system";

export interface AdminNavSection {
  id: AdminNavSectionId;
  labelBn: string;
  labelEn: string;
}

/** Sections in display order. groupBySection skips any section that has
 *  no items, so a section never renders empty. */
export const ADMIN_NAV_SECTIONS: readonly AdminNavSection[] = [
  { id: "overview", labelBn: "ওভারভিউ", labelEn: "Overview" },
  { id: "sales", labelBn: "বিক্রয়", labelEn: "Sales" },
  { id: "catalog", labelBn: "ক্যাটালগ", labelEn: "Catalog" },
  { id: "customers", labelBn: "গ্রাহক", labelEn: "Customers" },
  { id: "marketing", labelBn: "মার্কেটিং", labelEn: "Marketing" },
  { id: "insights", labelBn: "ইনসাইট", labelEn: "Insights" },
  { id: "addons", labelBn: "অ্যাড-অন মডিউল", labelEn: "Add-on Modules" },
  { id: "system", labelBn: "সিস্টেম", labelEn: "System" },
];

export interface AdminNavItem {
  id: string;
  path: string;
  labelBn: string;
  labelEn: string;
  /** Lucide icon component name, e.g. "ShoppingCart". */
  icon: string;
  section: AdminNavSectionId;
  /** PERMISSIONS key required to see the item; null = any signed-in staff. */
  permission: PermissionKey | null;
  /** Seeded feature-flag key for paid add-ons; null = core module. */
  featureFlag: string | null;
  /** Non-null exactly when `featureFlag` is set: the module is a locked
   *  add-on until the flag is enabled per client. */
  badge: "locked-add-on" | null;
}

export const ADMIN_NAV: readonly AdminNavItem[] = [
  // ---- Overview ---------------------------------------------------------
  {
    id: "dashboard",
    path: "/admin",
    labelBn: "ড্যাশবোর্ড",
    labelEn: "Dashboard",
    icon: "LayoutDashboard",
    section: "overview",
    permission: null,
    featureFlag: null,
    badge: null,
  },

  // ---- Sales ------------------------------------------------------------
  {
    id: "orders",
    path: "/admin/orders",
    labelBn: "অর্ডার",
    labelEn: "Orders",
    icon: "ShoppingCart",
    section: "sales",
    permission: "orders.view",
    featureFlag: null,
    badge: null,
  },
  {
    id: "abandoned",
    path: "/admin/abandoned",
    labelBn: "পরিত্যক্ত চেকআউট",
    labelEn: "Abandoned Checkouts",
    icon: "ShoppingCart",
    section: "sales",
    // The abandoned API guards list/call-task on orders.view and
    // convert on orders.create; nav uses orders.view like the other
    // sales-section entries.
    permission: "orders.view",
    featureFlag: null,
    badge: null,
  },
  {
    id: "payments",
    path: "/admin/payments",
    labelBn: "পেমেন্ট",
    labelEn: "Payments",
    icon: "CreditCard",
    section: "sales",
    permission: "payments.view",
    featureFlag: null,
    badge: null,
  },
  {
    id: "shipments",
    path: "/admin/shipments",
    labelBn: "শিপমেন্ট",
    labelEn: "Shipments",
    icon: "Truck",
    section: "sales",
    // The shipments API guards on its own shipments.view/book/cancel
    // permissions; nav uses orders.view as the shared read permission
    // for the sales section (same pattern as call-center / POS / inbox).
    permission: "orders.view",
    featureFlag: null,
    badge: null,
  },
  {
    id: "call-center",
    path: "/admin/call-center",
    labelBn: "কল সেন্টার",
    labelEn: "Call Center",
    icon: "PhoneCall",
    section: "sales",
    // No dedicated call-center permission exists in PERMISSIONS; the
    // call-center API guards on orders.view (the queue is order-based).
    permission: "orders.view",
    featureFlag: "module.call_center",
    badge: "locked-add-on",
  },
  {
    id: "riders",
    path: "/admin/riders",
    labelBn: "রাইডার",
    labelEn: "Riders",
    icon: "Bike",
    section: "sales",
    permission: "riders.view",
    featureFlag: "module.rider",
    badge: "locked-add-on",
  },
  {
    id: "pos",
    path: "/admin/pos",
    labelBn: "পয়েন্ট অব সেল (POS)",
    labelEn: "POS",
    icon: "Store",
    section: "sales",
    // Dedicated POS permissions (Agent 60): the POS API guards on
    // pos.view (register state, scan) / pos.manage (shifts, sales).
    permission: "pos.view",
    featureFlag: "module.pos",
    badge: "locked-add-on",
  },
  {
    id: "inbox",
    path: "/admin/inbox",
    labelBn: "ইনবক্স (F-commerce)",
    labelEn: "Inbox (F-commerce)",
    icon: "Inbox",
    section: "sales",
    // No dedicated inbox permission exists in PERMISSIONS; the inbox API
    // guards on orders.view.
    permission: "orders.view",
    featureFlag: "module.f_commerce",
    badge: "locked-add-on",
  },
  {
    id: "bd-tools",
    path: "/admin/bd-tools",
    labelBn: "বিডি টুলস",
    labelEn: "BD Tools",
    icon: "MapPin",
    section: "sales",
    // Core BD differentiators (E1/E2/E4), not a paid add-on — no flag.
    // The bd API routes guard per tool (orders.create / payments.view /
    // payments.verify_manual / reports.accounting); nav uses
    // payments.view as the closest shared read permission.
    permission: "payments.view",
    featureFlag: null,
    badge: null,
  },
  {
    id: "advanced-orders",
    path: "/admin/advanced-orders",
    labelBn: "অ্যাডভান্সড অর্ডার",
    labelEn: "Advanced Orders",
    icon: "Split",
    section: "sales",
    permission: "orders.view",
    // `module.advanced_orders` was added to the seed FEATURE_FLAGS by the
    // main agent on 2026-10-24 (after Agent 43 flagged the gap).
    featureFlag: "module.advanced_orders",
    badge: "locked-add-on",
  },

  // ---- Catalog ----------------------------------------------------------
  {
    id: "products",
    path: "/admin/products",
    labelBn: "পণ্য",
    labelEn: "Products",
    icon: "Package",
    section: "catalog",
    permission: "products.view",
    featureFlag: null,
    badge: null,
  },
  {
    // Wave P2a: categories get their first admin surface (previously
    // seed-only). API guards on the products permission family — no
    // separate taxonomy permission exists in the seed.
    id: "categories",
    path: "/admin/categories",
    labelBn: "ক্যাটাগরি",
    labelEn: "Categories",
    icon: "Blocks",
    section: "catalog",
    permission: "products.view",
    featureFlag: null,
    badge: null,
  },
  {
    // Wave P2a: brands admin (previously find-or-create only, inside
    // product create). Same products permission family as categories.
    id: "brands",
    path: "/admin/brands",
    labelBn: "ব্র্যান্ড",
    labelEn: "Brands",
    icon: "Flag",
    section: "catalog",
    permission: "products.view",
    featureFlag: null,
    badge: null,
  },
  {
    // Wave 13-2: attribute-set library (ProductAttribute) — reusable
    // key/value sets (size, colour…) managed as a library; wiring the
    // sets into the product editor is a later wave. Same products
    // permission family as categories/brands.
    id: "attributes",
    path: "/admin/attributes",
    labelBn: "অ্যাট্রিবিউট",
    labelEn: "Attributes",
    icon: "ListOrdered",
    section: "catalog",
    permission: "products.view",
    featureFlag: null,
    badge: null,
  },
  {
    // Wave 15-3: sourcing import + landed-cost calculator (Part H).
    id: "sourcing",
    path: "/admin/sourcing",
    labelBn: "সোর্সিং",
    labelEn: "Sourcing",
    icon: "Truck",
    section: "catalog",
    permission: "products.view",
    featureFlag: "module.sourcing",
    badge: null,
  },
  {
    // Wave 15-3: barcode label print sheet (module.product_extras).
    id: "product-labels",
    path: "/admin/products/labels",
    labelBn: "লেবেল প্রিন্ট",
    labelEn: "Labels",
    icon: "ScrollText",
    section: "catalog",
    permission: "products.view",
    featureFlag: "module.product_extras",
    badge: null,
  },
  {
    id: "inventory",
    path: "/admin/inventory",
    labelBn: "ইনভেন্টরি",
    labelEn: "Inventory",
    icon: "Warehouse",
    section: "catalog",
    permission: "inventory.view",
    featureFlag: null,
    badge: null,
  },

  {
    id: "content",
    path: "/admin/content",
    labelBn: "কন্টেন্ট (CMS)",
    labelEn: "Content (CMS)",
    icon: "FileText",
    section: "catalog",
    permission: "content.page",
    featureFlag: null,
    badge: null,
  },
  {
    // Review moderation queue (Review table). The admin reviews API
    // guards on content.page — the same convention as the CMS APIs.
    id: "reviews",
    path: "/admin/reviews",
    labelBn: "রিভিউ",
    labelEn: "Reviews",
    icon: "Star",
    section: "catalog",
    permission: "content.page",
    featureFlag: null,
    badge: null,
  },

  // ---- Customers ----------------------------------------------------------
  {
    id: "customers",
    path: "/admin/customers",
    labelBn: "গ্রাহক",
    labelEn: "Customers",
    icon: "Users",
    section: "customers",
    permission: "customers.view",
    featureFlag: null,
    badge: null,
  },
  {
    id: "resellers",
    path: "/admin/resellers",
    labelBn: "রিসেলার",
    labelEn: "Resellers",
    icon: "Store",
    section: "customers",
    // Dedicated reseller permissions: read routes guard on
    // resellers.view; withdrawal create/review guard on resellers.manage.
    permission: "resellers.view",
    featureFlag: "module.reseller",
    badge: "locked-add-on",
  },

  // ---- Marketing ----------------------------------------------------------
  {
    id: "marketing",
    path: "/admin/marketing",
    labelBn: "মার্কেটিং",
    labelEn: "Marketing",
    icon: "Megaphone",
    section: "marketing",
    permission: "marketing.coupon",
    featureFlag: null,
    badge: null,
  },
  {
    // Newsletter subscribers (wave 7): the admin list over the
    // NewsletterSubscriber table that the storefront form has filled
    // since wave 3a. Permission matches the page's API guard
    // (GET /api/v1/admin/newsletter/subscribers, marketing.coupon).
    id: "newsletter",
    path: "/admin/newsletter",
    labelBn: "নিউজলেটার",
    labelEn: "Newsletter",
    icon: "Inbox",
    section: "marketing",
    permission: "marketing.coupon",
    featureFlag: null,
    badge: null,
  },
  {
    // Landing Page Builder (Agent 53): core marketing, no feature flag.
    // Permission mirrors the CMS convention: content.page — the landing
    // API guards on content.page, same as the CMS Pages API.
    id: "landing",
    path: "/admin/landing",
    labelBn: "ল্যান্ডিং পেজ",
    labelEn: "Landing Pages",
    icon: "Rocket",
    section: "marketing",
    permission: "content.page",
    featureFlag: null,
    badge: null,
  },
  {
    // NOTE: featureFlag is "module.loyalty" but that flag is NOT in the
    // seed FEATURE_FLAGS yet (seed gap, Agent 36) — the loyalty page uses
    // a labelled page-local demo flag until the seed owner adds it.
    id: "loyalty",
    path: "/admin/loyalty",
    labelBn: "লয়্যালটি ও রেফারেল",
    labelEn: "Loyalty & Referral",
    icon: "Gift",
    section: "marketing",
    permission: "marketing.coupon",
    featureFlag: "module.loyalty",
    badge: "locked-add-on",
  },
  {
    // AI Assist tools page (Agent 45) over src/ai (Agent 15). No
    // dedicated AI permission exists in PERMISSIONS; reports.view is
    // used per the page brief (nav visibility is UX only — the AI API
    // routes enforce their own permission, products.edit).
    id: "ai-assist",
    path: "/admin/ai-assist",
    labelBn: "AI সহায়ক",
    labelEn: "AI Assist",
    icon: "Sparkles",
    section: "marketing",
    permission: "reports.view",
    featureFlag: "module.ai_assist",
    badge: "locked-add-on",
  },

  // ---- Insights -----------------------------------------------------------
  {
    id: "reports",
    path: "/admin/reports",
    labelBn: "রিপোর্ট",
    labelEn: "Reports",
    icon: "BarChart3",
    section: "insights",
    permission: "reports.view",
    featureFlag: null,
    badge: null,
  },
  {
    id: "analytics",
    path: "/admin/analytics",
    labelBn: "উন্নত অ্যানালিটিক্স",
    labelEn: "Advanced Analytics",
    icon: "TrendingUp",
    section: "insights",
    permission: "reports.view",
    featureFlag: "module.advanced_analytics",
    badge: "locked-add-on",
  },

  // ---- Add-on Modules -----------------------------------------------------
  {
    id: "automation",
    path: "/admin/automation",
    labelBn: "অটোমেশন",
    labelEn: "Automation",
    icon: "Workflow",
    section: "addons",
    permission: "automation.view",
    featureFlag: "module.automation",
    badge: "locked-add-on",
  },
  {
    id: "fraud",
    path: "/admin/fraud",
    labelBn: "ফ্রড যাচাই",
    labelEn: "Fraud Scoring",
    icon: "ShieldAlert",
    section: "addons",
    permission: "fraud.view",
    featureFlag: "module.fraud_scoring",
    badge: "locked-add-on",
  },
  {
    id: "modules",
    path: "/admin/modules",
    labelBn: "মডিউলসমূহ",
    labelEn: "Modules",
    icon: "Blocks",
    section: "addons",
    permission: "settings.integrations",
    featureFlag: null,
    badge: null,
  },
  {
    id: "erp",
    path: "/admin/erp",
    labelBn: "ERP হিসাব",
    labelEn: "ERP-lite",
    icon: "Calculator",
    section: "addons",
    permission: "reports.accounting",
    featureFlag: "module.erp_lite",
    badge: "locked-add-on",
  },

  {
    id: "b2b",
    path: "/admin/b2b",
    labelBn: "B2B / পাইকারি",
    labelEn: "B2B / Wholesale",
    icon: "Building2",
    section: "addons",
    permission: "b2b.view",
    featureFlag: "module.b2b",
    badge: "locked-add-on",
  },
  {
    id: "vendors",
    path: "/admin/vendors",
    labelBn: "ভেন্ডর",
    labelEn: "Vendors",
    icon: "Briefcase",
    section: "addons",
    permission: "vendors.view",
    featureFlag: "module.multi_vendor",
    badge: "locked-add-on",
  },

  // ---- System -------------------------------------------------------------
  // /admin/settings is the index/landing page; each subpage also keeps
  // its own nav item below.
  {
    id: "settings",
    path: "/admin/settings",
    labelBn: "সেটিংস",
    labelEn: "Settings",
    icon: "Settings",
    section: "system",
    permission: "settings.view",
    featureFlag: null,
    badge: null,
  },
  {
    id: "settings-payments",
    path: "/admin/settings/payments",
    labelBn: "পেমেন্ট সেটিংস",
    labelEn: "Payment Settings",
    icon: "CreditCard",
    section: "system",
    permission: "settings.view",
    featureFlag: null,
    badge: null,
  },
  {
    id: "settings-shipping",
    path: "/admin/settings/shipping",
    labelBn: "কুরিয়ার / শিপিং",
    labelEn: "Courier / Shipping",
    icon: "Truck",
    section: "system",
    permission: "settings.view",
    featureFlag: null,
    badge: null,
  },
  {
    id: "settings-notifications",
    path: "/admin/settings/notifications",
    labelBn: "নোটিফিকেশন",
    labelEn: "Notifications",
    icon: "Bell",
    section: "system",
    permission: "settings.view",
    featureFlag: null,
    badge: null,
  },
  {
    id: "settings-integrations",
    path: "/admin/settings/integrations",
    labelBn: "ইন্টিগ্রেশন",
    labelEn: "Integrations",
    icon: "Plug",
    section: "system",
    permission: "settings.integrations",
    featureFlag: null,
    badge: null,
  },
  {
    id: "settings-tracking",
    path: "/admin/settings/tracking",
    labelBn: "ট্র্যাকিং",
    labelEn: "Tracking",
    icon: "LineChart",
    section: "system",
    permission: "settings.view",
    featureFlag: null,
    badge: null,
  },
  {
    // Wave 16: the VAT-rate card — accounting.vat_rate_bps finally has
    // a UI (the ERP sales-VAT report has read the key since wave 7).
    id: "settings-accounting",
    path: "/admin/settings/accounting",
    labelBn: "হিসাব / VAT",
    labelEn: "Accounting / VAT",
    icon: "Calculator",
    section: "system",
    permission: "settings.view",
    featureFlag: null,
    badge: null,
  },
  {
    id: "staff",
    path: "/admin/staff",
    labelBn: "স্টাফ ও ভূমিকা",
    labelEn: "Staff & Roles",
    icon: "Users",
    section: "system",
    permission: "staff.view",
    featureFlag: null,
    badge: null,
  },
  {
    // Self-service: every signed-in staff member manages their OWN 2FA
    // here, so no permission gate (the API enforces the session and
    // only ever touches the caller's own account).
    id: "security",
    path: "/admin/security",
    labelBn: "নিরাপত্তা (2FA)",
    labelEn: "Security (2FA)",
    icon: "Lock",
    section: "system",
    permission: null,
    featureFlag: null,
    badge: null,
  },
  {
    id: "audit",
    path: "/admin/audit",
    labelBn: "অডিট লগ",
    labelEn: "Audit Log",
    icon: "ScrollText",
    section: "system",
    permission: "audit.view",
    featureFlag: null,
    badge: null,
  },
  {
    id: "feature-flags",
    path: "/admin/feature-flags",
    labelBn: "ফিচার ফ্ল্যাগ",
    labelEn: "Feature Flags",
    icon: "Flag",
    section: "system",
    permission: "feature_flags.manage",
    featureFlag: null,
    badge: null,
  },
  {
    id: "queues",
    path: "/admin/queues",
    labelBn: "কিউ মনিটর",
    labelEn: "Queue Monitor",
    icon: "ListOrdered",
    section: "system",
    permission: "settings.view",
    featureFlag: null,
    badge: null,
  },
  {
    id: "design-system",
    path: "/admin/design-system",
    labelBn: "ডিজাইন সিস্টেম (dev)",
    labelEn: "Design System (dev)",
    icon: "Palette",
    section: "system",
    permission: "settings.view",
    featureFlag: null,
    badge: null,
  },
];

export interface AdminNavGroup {
  section: AdminNavSection;
  items: AdminNavItem[];
}

/** Group items by section, in ADMIN_NAV_SECTIONS order. Sections with no
 *  items (currently `marketing`) are skipped, never rendered empty. */
export function groupBySection(
  items: readonly AdminNavItem[] = ADMIN_NAV,
): AdminNavGroup[] {
  const groups: AdminNavGroup[] = [];
  for (const section of ADMIN_NAV_SECTIONS) {
    const sectionItems = items.filter((item) => item.section === section.id);
    if (sectionItems.length > 0) groups.push({ section, items: sectionItems });
  }
  return groups;
}

/**
 * Items a staff member may see: `permission: null` items are always
 * visible; other items require the granted permission. Flag-gated add-ons
 * are NOT hidden by this filter — they stay listed with their lock badge
 * and their pages render a lock panel while the flag is off.
 */
export function filterNavByPermissions(
  granted: readonly PermissionKey[],
  items: readonly AdminNavItem[] = ADMIN_NAV,
): AdminNavItem[] {
  const grantedSet = new Set<string>(granted);
  return items.filter(
    (item) => item.permission === null || grantedSet.has(item.permission),
  );
}

/** True while the item's add-on flag is set (flags seed OFF per client). */
export function isLockedAddOn(item: AdminNavItem): boolean {
  return item.badge === "locked-add-on";
}

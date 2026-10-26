/**
 * Phase 1 seed — idempotent (safe to re-run).
 *
 * Seeds:
 *  - Permission catalogue (must stay in sync with apps/web/src/lib/rbac.ts)
 *  - Default roles with their permissions (Owner = all permissions)
 *  - Default feature flags (all v2 modules OFF)
 *  - Default non-secret settings only (general/storage/email provider names
 *    and flags — NO credential values are seeded here, ever)
 *  - BD geo: the verified full dataset at prisma/data/bd-geo.json
 *    (8 divisions / 64 districts / 504 upazilas / 4,964 unions from
 *    bd-divisions-to-unions@1.0.4, ISC — validated 2026-10-24; see
 *    prisma/data/README.md). A small SAMPLE is used only if that file is
 *    missing. See loadGeoData() below.
 *
 * What this seed deliberately does NOT do:
 *  - It does NOT create a staff user with a known password. The first Owner
 *    must be created by the setup wizard / a one-off CLI that reads the
 *    password from the local environment, never from a committed file.
 *
 * Run: pnpm --filter @advance-ecommerce/db db:seed
 * (requires DATABASE_URL in .env.local; do not commit that file)
 */
import { PrismaClient } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const prisma = new PrismaClient();

/* ------------------------------------------------------------------ */
/* Permissions — mirror of apps/web/src/lib/rbac.ts PERMISSIONS       */
/* ------------------------------------------------------------------ */

const PERMISSIONS: Array<{ key: string; module: string; action: string }> = [
  { key: "orders.view", module: "orders", action: "view" },
  { key: "orders.create", module: "orders", action: "create" },
  { key: "orders.update_status", module: "orders", action: "update_status" },
  { key: "orders.edit", module: "orders", action: "edit" },
  { key: "orders.delete", module: "orders", action: "delete" },
  { key: "orders.export", module: "orders", action: "export" },
  { key: "orders.print", module: "orders", action: "print" },
  { key: "orders.override_advance", module: "orders", action: "override_advance" },
  { key: "returns.view", module: "returns", action: "view" },
  { key: "returns.manage", module: "returns", action: "manage" },
  { key: "products.view", module: "products", action: "view" },
  { key: "products.create", module: "products", action: "create" },
  { key: "products.edit", module: "products", action: "edit" },
  { key: "products.delete", module: "products", action: "delete" },
  { key: "products.edit_cost_price", module: "products", action: "edit_cost_price" },
  { key: "products.import", module: "products", action: "import" },
  { key: "products.export", module: "products", action: "export" },
  { key: "customers.view", module: "customers", action: "view" },
  { key: "customers.edit", module: "customers", action: "edit" },
  { key: "customers.view_full_phone", module: "customers", action: "view_full_phone" },
  { key: "customers.export", module: "customers", action: "export" },
  { key: "customers.block", module: "customers", action: "block" },
  { key: "inventory.view", module: "inventory", action: "view" },
  { key: "inventory.adjust", module: "inventory", action: "adjust" },
  { key: "inventory.purchase_order", module: "inventory", action: "purchase_order" },
  { key: "payments.view", module: "payments", action: "view" },
  { key: "payments.verify_manual", module: "payments", action: "verify_manual" },
  { key: "payments.refund", module: "payments", action: "refund" },
  { key: "payments.export", module: "payments", action: "export" },
  { key: "payments.remit", module: "payments", action: "remit" },
  { key: "shipments.view", module: "shipments", action: "view" },
  { key: "shipments.book", module: "shipments", action: "book" },
  { key: "shipments.cancel", module: "shipments", action: "cancel" },
  { key: "marketing.coupon", module: "marketing", action: "coupon" },
  { key: "marketing.campaign", module: "marketing", action: "campaign" },
  { key: "marketing.banner", module: "marketing", action: "banner" },
  { key: "content.page", module: "content", action: "page" },
  { key: "content.blog", module: "content", action: "blog" },
  { key: "content.media", module: "content", action: "media" },
  { key: "reports.view", module: "reports", action: "view" },
  { key: "reports.export", module: "reports", action: "export" },
  { key: "reports.accounting", module: "reports", action: "accounting" },
  { key: "staff.view", module: "staff", action: "view" },
  { key: "staff.manage", module: "staff", action: "manage" },
  { key: "roles.manage", module: "roles", action: "manage" },
  { key: "audit.view", module: "audit", action: "view" },
  { key: "settings.view", module: "settings", action: "view" },
  { key: "settings.edit", module: "settings", action: "edit" },
  { key: "settings.integrations", module: "settings", action: "integrations" },
  { key: "settings.branding", module: "settings", action: "branding" },
  { key: "feature_flags.manage", module: "feature_flags", action: "manage" },
  { key: "automation.view", module: "automation", action: "view" },
  { key: "automation.manage", module: "automation", action: "manage" },
  { key: "fraud.view", module: "fraud", action: "view" },
  { key: "fraud.manage", module: "fraud", action: "manage" },
  { key: "b2b.view", module: "b2b", action: "view" },
  { key: "b2b.manage", module: "b2b", action: "manage" },
  { key: "vendors.view", module: "vendors", action: "view" },
  { key: "vendors.manage", module: "vendors", action: "manage" },
  { key: "riders.view", module: "riders", action: "view" },
  { key: "riders.manage", module: "riders", action: "manage" },
  { key: "resellers.view", module: "resellers", action: "view" },
  { key: "resellers.manage", module: "resellers", action: "manage" },
  { key: "pos.view", module: "pos", action: "view" },
  { key: "pos.manage", module: "pos", action: "manage" },
];

const ROLE_PERMISSIONS: Record<string, string[]> = {
  Manager: [
    "orders.view", "orders.create", "orders.update_status", "orders.edit", "orders.export", "orders.print", "orders.override_advance",
    "returns.view", "returns.manage",
    "products.view", "products.create", "products.edit", "products.import", "products.export",
    "customers.view", "customers.edit", "customers.view_full_phone",
    "inventory.view", "inventory.adjust", "inventory.purchase_order",
    "payments.view", "payments.verify_manual", "payments.remit",
    "shipments.view", "shipments.book", "shipments.cancel",
    "marketing.coupon", "marketing.campaign", "marketing.banner",
    "content.page", "content.blog", "content.media",
    "reports.view", "reports.export",
    "staff.view", "audit.view",
    "settings.view",
    "pos.view", "pos.manage",
  ],
  "Order Processor": [
    "orders.view", "orders.create", "orders.update_status", "orders.print",
    "returns.view", "returns.manage",
    "products.view", "customers.view", "payments.view",
    "shipments.view", "shipments.book",
    "pos.view", "pos.manage",
  ],
  Inventory: ["products.view", "inventory.view", "inventory.adjust", "inventory.purchase_order", "orders.view"],
  Support: ["orders.view", "customers.view", "returns.view", "content.page"],
  Accountant: [
    "orders.view", "orders.export", "returns.view", "payments.view", "payments.refund", "payments.export", "payments.remit",
    "shipments.view", "reports.view", "reports.export", "reports.accounting",
  ],
  "Content Editor": ["products.view", "products.create", "products.edit", "content.page", "content.blog", "content.media"],
};

const FEATURE_FLAGS: Array<{ key: string; description: string }> = [
  { key: "module.reseller", description: "Reseller panel (v2 add-on)" },
  { key: "module.reseller_portal", description: "Reseller self-service portal (v2 add-on, ADV-12)" },
  { key: "module.call_center", description: "Call center (v2 add-on)" },
  { key: "module.call_center_automation", description: "Call center follow-up automation — auto SMS + retry backoff (v2 add-on)" },
  { key: "module.pos", description: "POS (v2 add-on)" },
  { key: "module.multi_vendor", description: "Multi-vendor (v2 add-on)" },
  { key: "module.vendor_portal", description: "Vendor self-service portal (v2 add-on, ADV-13)" },
  { key: "module.automation", description: "Automation engine (v2 add-on)" },
  { key: "module.fraud_scoring", description: "Fraud / risk scoring (v2 add-on)" },
  { key: "module.rider", description: "Own rider management (v2 add-on)" },
  { key: "module.f_commerce", description: "F-commerce inbox (v2 add-on)" },
  { key: "module.ai_assist", description: "AI assist (v2 add-on)" },
  { key: "module.advanced_analytics", description: "Advanced analytics (v2 add-on)" },
  { key: "module.b2b", description: "B2B / wholesale (v2 add-on)" },
  { key: "module.b2b_portal", description: "B2B buyer portal (v2 add-on, ADV-14)" },
  { key: "module.marketing_mechanics", description: "Marketing mechanics: gift cards, membership tiers, spin wheel, A/B tests, bundle builder, EMI display, WhatsApp broadcast (v2 add-on, ADV-18)" },
  { key: "module.subscriptions", description: "Customer subscriptions / auto-replenish (v2 add-on, ADV-18)" },
  { key: "module.fashion", description: "Fashion pack (v2 add-on)" },
  { key: "module.electronics", description: "Electronics pack (v2 add-on)" },
  { key: "module.grocery", description: "Grocery pack (v2 add-on)" },
  { key: "module.pharmacy", description: "Pharmacy pack (v2 add-on)" },
  { key: "module.digital_goods", description: "Digital goods pack (v2 add-on)" },
  { key: "module.erp_lite", description: "ERP-lite accounting (v2 add-on)" },
  { key: "module.loyalty", description: "Loyalty, referral & affiliate (v2 add-on)" },
  { key: "module.advanced_orders", description: "Advanced orders: split, partial, exchange, pre-order (v2 add-on)" },
  { key: "module.product_types", description: "Product types: digital, bundle & pre-order products (v2 add-on)" },
  { key: "module.sourcing", description: "Sourcing import + landed-cost calculator (v2 add-on)" },
  { key: "module.product_extras", description: "Product extras: 360° view + barcode labels (v2 add-on)" },
  { key: "module.inventory_depth", description: "Inventory depth: batch/expiry, serial/IMEI, ABC + dead-stock, auto-reorder (v2 add-on, ADV-20)" },
  { key: "module.warehouse_ops", description: "Warehouse ops: pick, pack & ship scanning (v2 add-on, ADV-21)" },
];

const DEFAULT_SETTINGS: Array<{ key: string; value: string; category: string; isPublic: boolean }> = [
  { key: "general.locale", value: "bn", category: "general", isPublic: true },
  { key: "general.currency", value: "BDT", category: "general", isPublic: true },
  { key: "general.timezone", value: "Asia/Dhaka", category: "general", isPublic: true },
  { key: "storage.provider", value: "r2", category: "storage", isPublic: false },
  { key: "email.provider", value: "resend", category: "email", isPublic: false },
  // Provider enabled flags default OFF. Admin enables a provider in
  // Admin > Settings and enters its credential there (encrypted) — the
  // credential itself is never seeded.
  { key: "payment.cod.enabled", value: "true", category: "payment", isPublic: false },
  { key: "payment.bkash.enabled", value: "false", category: "payment", isPublic: false },
  { key: "payment.nagad.enabled", value: "false", category: "payment", isPublic: false },
  { key: "payment.sslcommerz.enabled", value: "false", category: "payment", isPublic: false },
  { key: "courier.steadfast.enabled", value: "false", category: "courier", isPublic: false },
  { key: "courier.pathao.enabled", value: "false", category: "courier", isPublic: false },
  { key: "courier.redx.enabled", value: "false", category: "courier", isPublic: false },
];

/* ------------------------------------------------------------------ */
/* BD geo                                                             */
/* ------------------------------------------------------------------ */

interface GeoSample {
  division: { nameEn: string; nameBn: string; code?: string };
  districts: Array<{
    nameEn: string;
    nameBn: string;
    code?: string;
    upazilas: Array<{
      nameEn: string;
      nameBn: string;
      code?: string;
      unions: Array<{ nameEn: string; nameBn: string; code?: string }>;
    }>;
  }>;
}

/**
 * BD GEO — the full dataset lives at prisma/data/bd-geo.json in this
 * shape: { divisions: [{ division: { nameEn, nameBn, code }, districts:
 * [{ nameEn, nameBn, code, upazilas: [{ nameEn, nameBn, code, unions:
 * [{ nameEn, nameBn, code }] }] }] }] }.
 *
 * Source: bd-divisions-to-unions@1.0.4 (npm, ISC, Azim Uddin Ahamed),
 * fetched and VALIDATED on 2026-10-24 — 8 divisions / 64 districts /
 * 504 upazilas / 4,964 unions, referential integrity and bn/en
 * completeness checked, spot-checks passed. Provenance, normalizations
 * (Chattogram/Barishal renames, municipality disambiguation) and known
 * source issues (Shayestaganj has 0 unions upstream; Bhuapur
 * Municipality is listed twice upstream) are documented in
 * prisma/data/README.md.
 *
 * GEO_SAMPLE below is a minimal fallback used ONLY when bd-geo.json is
 * missing, so checkout dropdowns can still be developed/tested. It is
 * NOT the full dataset and must not be presented as one.
 */
const GEO_SAMPLE: GeoSample[] = [
  {
    division: { nameEn: "Dhaka", nameBn: "ঢাকা" },
    districts: [
      {
        nameEn: "Dhaka",
        nameBn: "ঢাকা",
        upazilas: [{ nameEn: "Savar", nameBn: "সাভার", unions: [{ nameEn: "Savar", nameBn: "সাভার" }] }],
      },
    ],
  },
  {
    division: { nameEn: "Chattogram", nameBn: "চট্টগ্রাম" },
    districts: [
      {
        nameEn: "Chattogram",
        nameBn: "চট্টগ্রাম",
        upazilas: [{ nameEn: "Hathazari", nameBn: "হাটহাজারী", unions: [{ nameEn: "Hathazari", nameBn: "হাটহাজারী" }] }],
      },
    ],
  },
];

function loadGeoData(): GeoSample[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const dataPath = join(here, "data", "bd-geo.json");
  if (!existsSync(dataPath)) {
    console.warn("bd-geo.json not found — seeding SAMPLE geo data only (2 divisions). Restore the verified full dataset (see prisma/data/README.md).");
    return GEO_SAMPLE;
  }
  const parsed = JSON.parse(readFileSync(dataPath, "utf8")) as { divisions: GeoSample[] };
  console.log(`Using full geo dataset from ${dataPath}: ${parsed.divisions.length} divisions.`);
  return parsed.divisions;
}

/* ------------------------------------------------------------------ */
/* Seed                                                                */
/* ------------------------------------------------------------------ */

async function seedPermissionsAndRoles(): Promise<void> {
  const permissionByKey = new Map<string, string>();
  for (const perm of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { key: perm.key },
      create: perm,
      update: { module: perm.module, action: perm.action },
    });
    permissionByKey.set(perm.key, row.id);
  }

  const owner = await prisma.role.upsert({
    where: { name: "Owner" },
    create: { name: "Owner", description: "Full access to all modules" },
    update: {},
  });
  await prisma.rolePermission.deleteMany({ where: { roleId: owner.id } });
  await prisma.rolePermission.createMany({
    data: [...permissionByKey.values()].map((permissionId) => ({ roleId: owner.id, permissionId })),
    skipDuplicates: true,
  });

  for (const [roleName, keys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      create: { name: roleName },
      update: {},
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: keys
        .map((key) => permissionByKey.get(key))
        .filter((id): id is string => id !== undefined)
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }
  console.log(`Seeded ${PERMISSIONS.length} permissions and ${Object.keys(ROLE_PERMISSIONS).length + 1} roles.`);
}

async function seedGeo(): Promise<void> {
  for (const geo of loadGeoData()) {
    let division = await prisma.division.findFirst({ where: { nameEn: geo.division.nameEn } });
    if (division === null) {
      division = await prisma.division.create({ data: geo.division });
    }
    for (const districtData of geo.districts) {
      let district = await prisma.district.findFirst({
        where: { nameEn: districtData.nameEn, divisionId: division.id },
      });
      if (district === null) {
        district = await prisma.district.create({
          data: { nameEn: districtData.nameEn, nameBn: districtData.nameBn, code: districtData.code, divisionId: division.id },
        });
      }
      for (const upazilaData of districtData.upazilas) {
        let upazila = await prisma.upazila.findFirst({
          where: { nameEn: upazilaData.nameEn, districtId: district.id },
        });
        if (upazila === null) {
          upazila = await prisma.upazila.create({
            data: { nameEn: upazilaData.nameEn, nameBn: upazilaData.nameBn, code: upazilaData.code, districtId: district.id },
          });
        }
        for (const unionData of upazilaData.unions) {
          const existing = await prisma.union.findFirst({
            where: { nameEn: unionData.nameEn, upazilaId: upazila.id },
          });
          if (existing === null) {
            // Explicit fields: the Union model has no `code` column, so the
            // dataset's union code must not be spread into the create.
            await prisma.union.create({
              data: { nameEn: unionData.nameEn, nameBn: unionData.nameBn, upazilaId: upazila.id },
            });
          }
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Merged models — minimal, idempotent, SAMPLE/DEMO only               */
/* No orders, payments, customers with real data, and NO credentials.  */
/* ------------------------------------------------------------------ */
async function seedMerged(): Promise<void> {
  const category = await prisma.category.upsert({
    where: { slug: "general" },
    create: { slug: "general", nameBn: "সাধারণ", nameEn: "General" },
    update: {},
  });
  const brand = await prisma.brand.upsert({
    where: { slug: "sample-brand" },
    create: { slug: "sample-brand", name: "Sample Brand" },
    update: {},
  });
  const product = await prisma.product.upsert({
    where: { slug: "sample-product" },
    create: {
      slug: "sample-product",
      titleBn: "নমুনা পণ্য (SAMPLE ONLY)",
      titleEn: "Sample Product (SAMPLE ONLY)",
      descriptionBn: "SAMPLE ONLY — demo product, not a real listing.",
      descriptionEn: "SAMPLE ONLY — demo product, not a real listing.",
      categoryId: category.id,
      brandId: brand.id,
      status: "DRAFT",
      tags: ["sample"],
    },
    update: {},
  });
  const variant = await prisma.productVariant.upsert({
    where: { sku: "SAMPLE-001" },
    create: {
      productId: product.id,
      attributes: { size: "M" },
      sku: "SAMPLE-001",
      pricePoisha: 100000,
      costPoisha: null,
      stock: 0,
    },
    update: {},
  });
  const warehouse = await prisma.warehouse.upsert({
    where: { id: "sample-main-warehouse" },
    create: { id: "sample-main-warehouse", name: "Main Warehouse (SAMPLE)" },
    update: {},
  });
  await prisma.inventoryItem.upsert({
    where: { variantId_warehouseId: { variantId: variant.id, warehouseId: warehouse.id } },
    create: { variantId: variant.id, warehouseId: warehouse.id, quantityOnHand: 0, quantityReserved: 0 },
    update: {},
  });
  const inside = await prisma.shippingZone.upsert({
    where: { id: "zone-inside-dhaka" },
    create: { id: "zone-inside-dhaka", name: "inside_dhaka", district: "Dhaka" },
    update: {},
  });
  const outside = await prisma.shippingZone.upsert({
    where: { id: "zone-outside-dhaka" },
    create: { id: "zone-outside-dhaka", name: "outside_dhaka" },
    update: {},
  });
  // ShippingRate has no unique key, so seed idempotently by checking first.
  for (const [zoneId, charge] of [[inside.id, 6000], [outside.id, 12000]] as const) {
    const existing = await prisma.shippingRate.findFirst({ where: { zoneId, chargePoisha: charge } });
    if (existing === null) {
      await prisma.shippingRate.create({ data: { zoneId, chargePoisha: charge } });
    }
  }
  await prisma.coupon.upsert({
    where: { code: "WELCOME10" },
    create: { code: "WELCOME10", type: "PERCENT", valuePercent: 10, maxDiscountPoisha: 50000, isActive: true },
    update: {},
  });
  console.log("Seeded merged sample: 1 category, 1 brand, 1 DRAFT sample product/variant, 1 warehouse, 2 shipping zones, 1 sample coupon. No real orders/payments/customers seeded.");
}

async function main(): Promise<void> {
  await seedPermissionsAndRoles();
  await seedMerged();
  for (const flag of FEATURE_FLAGS) {
    await prisma.featureFlag.upsert({
      where: { key: flag.key },
      create: { ...flag, enabled: false },
      update: { description: flag.description },
    });
  }
  for (const setting of DEFAULT_SETTINGS) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      create: { ...setting, valueEncrypted: false },
      update: { value: setting.value, category: setting.category, isPublic: setting.isPublic },
    });
  }
  await seedGeo();
  console.log("Seed complete. No staff user was created — create the first Owner via the setup wizard / CLI (env password, never committed).");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

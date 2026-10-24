/**
 * DEMO data seed — idempotent, with a --clean mode.
 *
 * Seeds a realistic-looking demo store so the owner can evaluate the
 * storefront + admin end to end: 6 categories, 18 ACTIVE products,
 * 10 customers, 30 backdated orders, 3 invited (never login-able) demo
 * staff, and one live flash sale.
 *
 * Every demo row is identifiable and removable:
 *  - variant SKUs start with "DEMO-", product/category slugs with "demo-"
 *  - customers use the reserved demo phone range +88019000000XX and the
 *    "demo" tag; demo orders carry the note "DEMO ORDER" and
 *    idempotency keys "demo-seed-order-*"
 *  - staff names carry "(Demo)" and example.com emails; they are
 *    INACTIVE with an invite-token hash of a random token and an
 *    unusable random password hash — no known credential can log in
 *  - order numbers keep the app's own format (ORD-<epochMs of the
 *    backdated createdAt>) and totals are computed exactly like the
 *    orders repository does (integer poisha, zone delivery charges)
 *
 * SAFETY: this script refuses to run against a non-localhost
 * DATABASE_URL unless DEMO_SEED_ALLOW_REMOTE=1 is set explicitly.
 * That flag is set ONLY inside the RUN_DEMO_SEED step of
 * scripts/bootstrap.mjs (the gated production deploy path) — never set
 * it by hand against a database you do not intend to demo-seed.
 *
 * Usage (local):
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/advance_ecommerce \
 *   pnpm --filter @advance-ecommerce/db exec tsx scripts/seed-demo.ts [--clean]
 */
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/* ------------------------------------------------------------------ */
/* Safety gate                                                         */
/* ------------------------------------------------------------------ */

const databaseUrl = process.env["DATABASE_URL"] ?? "";
let dbHost = "";
try {
  dbHost = new URL(databaseUrl).hostname;
} catch {
  throw new Error("DATABASE_URL is missing or not a valid URL — refusing to run.");
}
const isLocal = dbHost === "localhost" || dbHost === "127.0.0.1" || dbHost === "::1";
if (!isLocal && process.env["DEMO_SEED_ALLOW_REMOTE"] !== "1") {
  throw new Error(
    `Refusing to demo-seed a non-localhost database (host: ${dbHost}). ` +
      "Set DEMO_SEED_ALLOW_REMOTE=1 only for the gated RUN_DEMO_SEED production deploy.",
  );
}

const prisma = new PrismaClient();
const CLEAN = process.argv.includes("--clean");

/* ------------------------------------------------------------------ */
/* Deterministic RNG (stable order composition across runs)            */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Catalogue data                                                      */
/* ------------------------------------------------------------------ */

interface DemoVariant {
  sku: string;
  attributes: Record<string, string>;
  pricePoisha: number;
  compareAtPoisha?: number;
  stock: number;
}

interface DemoProduct {
  slug: string;
  categorySlug: string;
  titleBn: string;
  titleEn: string;
  descriptionBn: string;
  descriptionEn: string;
  variants: DemoVariant[];
}

const DEMO_NOTE =
  "এটি একটি ডেমো পণ্য — দোকানটি মূল্যায়নের জন্য তালিকাভুক্ত করা হয়েছে, আসল পণ্য নয়।";
const DEMO_NOTE_EN =
  "Demo product — listed so the store can be evaluated end to end; not a real listing.";

const CATEGORIES: Array<{ slug: string; nameBn: string; nameEn: string; sortOrder: number }> = [
  { slug: "demo-fashion", nameBn: "ফ্যাশন", nameEn: "Fashion", sortOrder: 1 },
  { slug: "demo-electronics", nameBn: "ইলেকট্রনিক্স", nameEn: "Electronics", sortOrder: 2 },
  { slug: "demo-grocery", nameBn: "মুদি বাজার", nameEn: "Grocery", sortOrder: 3 },
  { slug: "demo-beauty-care", nameBn: "রূপচর্চা", nameEn: "Beauty & Care", sortOrder: 4 },
  { slug: "demo-home-living", nameBn: "ঘর সাজানো", nameEn: "Home & Living", sortOrder: 5 },
  { slug: "demo-sports", nameBn: "খেলাধুলা", nameEn: "Sports", sortOrder: 6 },
];

function v(
  sku: string,
  attributes: Record<string, string>,
  pricePoisha: number,
  stock: number,
  compareAtPoisha?: number,
): DemoVariant {
  return { sku, attributes, pricePoisha, stock, compareAtPoisha };
}

const PRODUCTS: DemoProduct[] = [
  {
    slug: "demo-cotton-panjabi",
    categorySlug: "demo-fashion",
    titleBn: "সুতি পাঞ্জাবি — অফ হোয়াইট",
    titleEn: "Cotton Panjabi — Off White",
    descriptionBn: `খাঁটি সুতি কাপড়ের আরামদায়ক পাঞ্জাবি, হাতে করা বোতাম ও সূক্ষ্ম গলার কাজ। ${DEMO_NOTE}`,
    descriptionEn: `Comfortable pure-cotton panjabi with hand-finished buttons and a detailed collar. ${DEMO_NOTE_EN}`,
    variants: [
      v("DEMO-PAN-M", { size: "M" }, 185000, 40, 240000),
      v("DEMO-PAN-L", { size: "L" }, 185000, 35, 240000),
      v("DEMO-PAN-XL", { size: "XL" }, 195000, 25, 250000),
    ],
  },
  {
    slug: "demo-three-piece-set",
    categorySlug: "demo-fashion",
    titleBn: "জর্জেট থ্রি-পিস সেট",
    titleEn: "Georgette Three-Piece Set",
    descriptionBn: `হালকা জর্জেট কাপড়ের থ্রি-পিস সেট — কামিজ, সালোয়ার ও ওড়না একসাথে। ${DEMO_NOTE}`,
    descriptionEn: `Lightweight georgette three-piece set — kamiz, salwar and orna included. ${DEMO_NOTE_EN}`,
    variants: [
      v("DEMO-TPC-M", { size: "M" }, 245000, 30, 320000),
      v("DEMO-TPC-L", { size: "L" }, 245000, 22, 320000),
    ],
  },
  {
    slug: "demo-polo-tshirt",
    categorySlug: "demo-fashion",
    titleBn: "প্রিমিয়াম পোলো টি-শার্ট",
    titleEn: "Premium Polo T-Shirt",
    descriptionBn: `পিকে সুতির প্রিমিয়াম পোলো, অফিস ও ক্যাজুয়াল — দুই লুকেই মানানসই। ${DEMO_NOTE}`,
    descriptionEn: `Premium pique-cotton polo that works for office and casual wear alike. ${DEMO_NOTE_EN}`,
    variants: [
      v("DEMO-POLO-M", { size: "M" }, 95000, 60),
      v("DEMO-POLO-L", { size: "L" }, 95000, 80),
      v("DEMO-POLO-XL", { size: "XL" }, 95000, 45),
    ],
  },
  {
    slug: "demo-wireless-earbuds",
    categorySlug: "demo-electronics",
    titleBn: "ওয়্যারলেস ইয়ারবাডস (ব্লুটুথ ৫.৩)",
    titleEn: "Wireless Earbuds (Bluetooth 5.3)",
    descriptionBn: `ব্লুটুথ ৫.৩, ৩০ ঘণ্টা ব্যাটারি ব্যাকআপ ও পরিষ্কার কলের জন্য ENC মাইক। ${DEMO_NOTE}`,
    descriptionEn: `Bluetooth 5.3, 30-hour total battery and an ENC mic for clear calls. ${DEMO_NOTE_EN}`,
    variants: [
      v("DEMO-BUD-BLK", { color: "Black" }, 215000, 90, 299000),
      v("DEMO-BUD-WHT", { color: "White" }, 215000, 65, 299000),
    ],
  },
  {
    slug: "demo-smart-watch",
    categorySlug: "demo-electronics",
    titleBn: "স্মার্ট ওয়াচ — AMOLED ডিসপ্লে",
    titleEn: "Smart Watch — AMOLED Display",
    descriptionBn: `AMOLED ডিসপ্লে, হার্ট-রেট ও SpO2 সেন্সর, ১০ দিনের ব্যাটারি। ${DEMO_NOTE}`,
    descriptionEn: `AMOLED display, heart-rate and SpO2 sensors, 10-day battery life. ${DEMO_NOTE_EN}`,
    variants: [v("DEMO-WATCH-BLK", { color: "Black" }, 345000, 40, 450000)],
  },
  {
    slug: "demo-power-bank-20000",
    categorySlug: "demo-electronics",
    titleBn: "পাওয়ার ব্যাংক ২০০০০mAh (22.5W)",
    titleEn: "Power Bank 20000mAh (22.5W Fast Charge)",
    descriptionBn: `২০০০০mAh পাওয়ার ব্যাংক, 22.5W ফাস্ট চার্জিং ও LED চার্জ ইন্ডিকেটর। ${DEMO_NOTE}`,
    descriptionEn: `20000mAh power bank with 22.5W fast charging and an LED charge indicator. ${DEMO_NOTE_EN}`,
    variants: [v("DEMO-PB-20K", { capacity: "20000mAh" }, 165000, 120)],
  },
  {
    slug: "demo-miniket-rice-5kg",
    categorySlug: "demo-grocery",
    titleBn: "মিনিকেট চাল — ৫ কেজি",
    titleEn: "Miniket Rice — 5kg",
    descriptionBn: `ঝরঝরে ও সুগন্ধি প্রিমিয়াম মিনিকেট চাল, প্রতিদিনের ভাতের জন্য সেরা। ${DEMO_NOTE}`,
    descriptionEn: `Premium miniket rice — fluffy and fragrant, ideal for everyday meals. ${DEMO_NOTE_EN}`,
    variants: [v("DEMO-RICE-5KG", { weight: "5kg" }, 42500, 100)],
  },
  {
    slug: "demo-mustard-oil-1l",
    categorySlug: "demo-grocery",
    titleBn: "খাঁটি সরিষার তেল — ১ লিটার",
    titleEn: "Pure Mustard Oil — 1 Litre",
    descriptionBn: `ঘানি ভাঙা খাঁটি সরিষার তেল, কোনো ভেজাল ছাড়া। ${DEMO_NOTE}`,
    descriptionEn: `Cold-pressed pure mustard oil with no adulteration. ${DEMO_NOTE_EN}`,
    variants: [v("DEMO-OIL-1L", { volume: "1L" }, 34000, 85, 39500)],
  },
  {
    slug: "demo-ajwa-dates-500g",
    categorySlug: "demo-grocery",
    titleBn: "আজওয়া খেজুর — ৫০০ গ্রাম",
    titleEn: "Ajwa Dates — 500g",
    descriptionBn: `মদিনার আজওয়া খেজুর, প্রিমিয়াম প্যাকে সংরক্ষিত। ${DEMO_NOTE}`,
    descriptionEn: `Ajwa dates from Madinah, sealed in a premium pack. ${DEMO_NOTE_EN}`,
    variants: [v("DEMO-DATE-500", { weight: "500g" }, 65000, 55)],
  },
  {
    slug: "demo-herbal-facewash",
    categorySlug: "demo-beauty-care",
    titleBn: "হারবাল ফেসওয়াশ — নিম ও অ্যালো",
    titleEn: "Herbal Facewash — Neem & Aloe",
    descriptionBn: `নিম ও অ্যালোভেরার হারবাল ফেসওয়াশ, সব ধরনের ত্বকের জন্য উপযোগী। ${DEMO_NOTE}`,
    descriptionEn: `Herbal facewash with neem and aloe vera, suitable for all skin types. ${DEMO_NOTE_EN}`,
    variants: [v("DEMO-FW-100", { size: "100ml" }, 35000, 110, 45000)],
  },
  {
    slug: "demo-hair-oil",
    categorySlug: "demo-beauty-care",
    titleBn: "হেয়ার অয়েল — আর্গান / নারিকেল",
    titleEn: "Hair Oil — Argan / Coconut",
    descriptionBn: `চুলের যত্নে পুষ্টিকর হেয়ার অয়েল, আর্গান ও নারিকেল — দুই variant-এ পাওয়া যাচ্ছে। ${DEMO_NOTE}`,
    descriptionEn: `Nourishing hair oil in two variants — argan and coconut. ${DEMO_NOTE_EN}`,
    variants: [
      v("DEMO-HO-ARG", { type: "Argan" }, 55000, 70),
      v("DEMO-HO-COC", { type: "Coconut" }, 45000, 64),
    ],
  },
  {
    slug: "demo-sunscreen-spf50",
    categorySlug: "demo-beauty-care",
    titleBn: "সানস্ক্রিন SPF 50 PA+++",
    titleEn: "Sunscreen SPF 50 PA+++",
    descriptionBn: `SPF 50 PA+++ সানস্ক্রিন, হালকা ও নন-গ্রিসি ফর্মুলা। ${DEMO_NOTE}`,
    descriptionEn: `SPF 50 PA+++ sunscreen with a light, non-greasy formula. ${DEMO_NOTE_EN}`,
    variants: [v("DEMO-SUN-50", { size: "50ml" }, 68000, 48, 85000)],
  },
  {
    slug: "demo-ceramic-dinner-set",
    categorySlug: "demo-home-living",
    titleBn: "সিরামিক ডিনার সেট — ২৪ পিস",
    titleEn: "Ceramic Dinner Set — 24 Pieces",
    descriptionBn: `২৪ পিসের সিরামিক ডিনার সেট, ৬ জনের পরিবারের জন্য। ${DEMO_NOTE}`,
    descriptionEn: `24-piece ceramic dinner set that serves a family of six. ${DEMO_NOTE_EN}`,
    variants: [v("DEMO-DIN-24", { pieces: "24" }, 285000, 18, 360000)],
  },
  {
    slug: "demo-cotton-bedsheet",
    categorySlug: "demo-home-living",
    titleBn: "সুতি বেডশিট — ডাবল",
    titleEn: "Cotton Bedsheet — Double",
    descriptionBn: `নরম সুতির বেডশিট, দুটি বালিশের কভারসহ। ${DEMO_NOTE}`,
    descriptionEn: `Soft cotton bedsheet with two matching pillow covers. ${DEMO_NOTE_EN}`,
    variants: [
      v("DEMO-BED-KING", { size: "King" }, 135000, 33),
      v("DEMO-BED-QUEEN", { size: "Queen" }, 125000, 27),
    ],
  },
  {
    slug: "demo-led-table-lamp",
    categorySlug: "demo-home-living",
    titleBn: "LED টেবিল ল্যাম্প — রিচার্জেবল",
    titleEn: "LED Table Lamp — Rechargeable",
    descriptionBn: `রিচার্জেবল LED টেবিল ল্যাম্প, তিন ধাপের উজ্জ্বলতা ও চোখের জন্য আরামদায়ক আলো। ${DEMO_NOTE}`,
    descriptionEn: `Rechargeable LED table lamp with three brightness levels and eye-friendly light. ${DEMO_NOTE_EN}`,
    variants: [v("DEMO-LAMP-WW", { color: "Warm White" }, 145000, 42, 180000)],
  },
  {
    slug: "demo-cricket-bat",
    categorySlug: "demo-sports",
    titleBn: "ক্রিকেট ব্যাট — ইংলিশ উইলো",
    titleEn: "Cricket Bat — English Willow",
    descriptionBn: `ইংলিশ উইলো ক্রিকেট ব্যাট, পেশাদার গ্রিপ ও ভারসাম্যপূর্ণ ওজন। ${DEMO_NOTE}`,
    descriptionEn: `English willow cricket bat with a professional grip and balanced weight. ${DEMO_NOTE_EN}`,
    variants: [v("DEMO-BAT-SH", { size: "SH" }, 225000, 15)],
  },
  {
    slug: "demo-yoga-mat",
    categorySlug: "demo-sports",
    titleBn: "যোগা ম্যাট — ৬mm অ্যান্টি-স্কিড",
    titleEn: "Yoga Mat — 6mm Anti-Skid",
    descriptionBn: `৬mm পুরু অ্যান্টি-স্কিড যোগা ম্যাট, ক্যারি স্ট্র্যাপসহ। ${DEMO_NOTE}`,
    descriptionEn: `6mm anti-skid yoga mat with a carry strap included. ${DEMO_NOTE_EN}`,
    variants: [
      v("DEMO-YOGA-BLU", { color: "Blue" }, 85000, 58, 110000),
      v("DEMO-YOGA-PUR", { color: "Purple" }, 85000, 39, 110000),
    ],
  },
  {
    slug: "demo-football-size5",
    categorySlug: "demo-sports",
    titleBn: "ফুটবল — সাইজ ৫",
    titleEn: "Football — Size 5",
    descriptionBn: `মেশিনে সেলাই করা টেকসই ফুটবল, সব আবহাওয়ায় খেলার উপযোগী। ${DEMO_NOTE}`,
    descriptionEn: `Machine-stitched durable football for all-weather play. ${DEMO_NOTE_EN}`,
    variants: [v("DEMO-FB-5", { size: "5" }, 135000, 44)],
  },
];

/* Flash sale: 3 demo variants at ~25% off. Keyed by variant SKU. */
const FLASH_SALE_NAME = "ডেমো ফ্ল্যাশ সেল / Demo Flash Sale";
const FLASH_ITEMS: Array<{ sku: string; salePricePoisha: number; stockCap: number; soldCount: number }> = [
  { sku: "DEMO-BUD-BLK", salePricePoisha: 159000, stockCap: 30, soldCount: 7 },
  { sku: "DEMO-SUN-50", salePricePoisha: 51000, stockCap: 40, soldCount: 12 },
  { sku: "DEMO-YOGA-BLU", salePricePoisha: 65000, stockCap: 25, soldCount: 5 },
];

/* ------------------------------------------------------------------ */
/* Customers — geo names are resolved from the seeded DB at runtime    */
/* ------------------------------------------------------------------ */

interface DemoCustomer {
  name: string;
  phone: string; // normalized +8801XXXXXXXXX
  email?: string;
  divisionEn: string;
  districtEn?: string;
  house: string;
}

const CUSTOMERS: DemoCustomer[] = [
  { name: "মোঃ আরিফুল ইসলাম", phone: "+8801900000001", email: "demo.ariful@example.com", divisionEn: "Dhaka", districtEn: "Dhaka", house: "House 12, Road 5, Dhanmondi (Demo Address)" },
  { name: "নুসরাত জাহান", phone: "+8801900000002", divisionEn: "Dhaka", districtEn: "Gazipur", house: "Holding 88, Joydebpur (Demo Address)" },
  { name: "মোঃ রাকিবুল হাসান", phone: "+8801900000003", divisionEn: "Chattogram", districtEn: "Chattogram", house: "House 7, GEC Circle (Demo Address)" },
  { name: "শারমিন আক্তার", phone: "+8801900000004", email: "demo.sharmin@example.com", divisionEn: "Khulna", districtEn: "Khulna", house: "House 21, Sonadanga (Demo Address)" },
  { name: "মোঃ সাকিব হোসেন", phone: "+8801900000005", divisionEn: "Rajshahi", districtEn: "Rajshahi", house: "House 3, Shaheb Bazar (Demo Address)" },
  { name: "তানিয়া সুলতানা", phone: "+8801900000006", divisionEn: "Dhaka", districtEn: "Narayanganj", house: "House 45, Chashara (Demo Address)" },
  { name: "মোঃ ইমরান হোসেন", phone: "+8801900000007", divisionEn: "Sylhet", districtEn: "Sylhet", house: "House 9, Zindabazar (Demo Address)" },
  { name: "রুমানা পারভীন", phone: "+8801900000008", email: "demo.rumana@example.com", divisionEn: "Barishal", districtEn: "Barishal", house: "House 16, Sadar Road (Demo Address)" },
  { name: "মোঃ ফরহাদ হোসেন", phone: "+8801900000009", divisionEn: "Rangpur", districtEn: "Rangpur", house: "House 2, Jahaj Company Mor (Demo Address)" },
  { name: "আয়েশা সিদ্দিকা", phone: "+8801900000010", divisionEn: "Mymensingh", districtEn: "Mymensingh", house: "House 27, Ganginar Par (Demo Address)" },
];

/* ------------------------------------------------------------------ */
/* Orders — explicit plan: 30 orders, DELIVERED 12 / SHIPPED 5 /       */
/* CONFIRMED 5 / PENDING 5 / CANCELLED 3                               */
/* ------------------------------------------------------------------ */

type DemoStatus = "PENDING" | "CONFIRMED" | "SHIPPED" | "DELIVERED" | "CANCELLED";

const ORDER_PLAN: Array<{ dayOffset: number; hourDhaka: number; status: DemoStatus; bkash?: boolean }> = [
  { dayOffset: 0, hourDhaka: 11, status: "PENDING" },
  { dayOffset: 0, hourDhaka: 9, status: "CONFIRMED" },
  { dayOffset: 0, hourDhaka: 13, status: "PENDING" },
  { dayOffset: 1, hourDhaka: 10, status: "CONFIRMED", bkash: true },
  { dayOffset: 1, hourDhaka: 8, status: "SHIPPED" },
  { dayOffset: 1, hourDhaka: 15, status: "CONFIRMED" },
  { dayOffset: 2, hourDhaka: 12, status: "DELIVERED" },
  { dayOffset: 2, hourDhaka: 9, status: "SHIPPED", bkash: true },
  { dayOffset: 3, hourDhaka: 14, status: "DELIVERED", bkash: true },
  { dayOffset: 3, hourDhaka: 16, status: "CANCELLED" },
  { dayOffset: 4, hourDhaka: 11, status: "DELIVERED" },
  { dayOffset: 5, hourDhaka: 10, status: "DELIVERED" },
  { dayOffset: 5, hourDhaka: 17, status: "CONFIRMED" },
  { dayOffset: 6, hourDhaka: 12, status: "DELIVERED", bkash: true },
  { dayOffset: 7, hourDhaka: 13, status: "PENDING" },
  { dayOffset: 8, hourDhaka: 11, status: "DELIVERED" },
  { dayOffset: 9, hourDhaka: 9, status: "SHIPPED" },
  { dayOffset: 10, hourDhaka: 15, status: "DELIVERED" },
  { dayOffset: 12, hourDhaka: 10, status: "CANCELLED" },
  { dayOffset: 13, hourDhaka: 12, status: "DELIVERED", bkash: true },
  { dayOffset: 14, hourDhaka: 16, status: "CONFIRMED" },
  { dayOffset: 16, hourDhaka: 11, status: "DELIVERED" },
  { dayOffset: 18, hourDhaka: 9, status: "SHIPPED" },
  { dayOffset: 20, hourDhaka: 14, status: "DELIVERED", bkash: true },
  { dayOffset: 22, hourDhaka: 10, status: "PENDING" },
  { dayOffset: 24, hourDhaka: 12, status: "DELIVERED" },
  { dayOffset: 25, hourDhaka: 15, status: "CANCELLED" },
  { dayOffset: 27, hourDhaka: 11, status: "SHIPPED" },
  { dayOffset: 28, hourDhaka: 13, status: "PENDING" },
  { dayOffset: 29, hourDhaka: 10, status: "DELIVERED" },
];

const ORDER_NOTE_TEXT = "DEMO ORDER — seeded demo data for evaluation, not a real customer order.";

const STAFF: Array<{ name: string; email: string; roleName: string }> = [
  { name: "Rahim Uddin (Demo)", email: "demo.manager@example.com", roleName: "Manager" },
  { name: "Fatema Akter (Demo)", email: "demo.orders@example.com", roleName: "Order Processor" },
  { name: "Tanvir Hasan (Demo)", email: "demo.support@example.com", roleName: "Support" },
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function dhakaTimeDaysAgo(dayOffset: number, hourDhaka: number, minute: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - dayOffset);
  // Dhaka is UTC+6 year-round (no DST).
  d.setUTCHours(hourDhaka - 6, minute, 0, 0);
  return d;
}

function costFor(pricePoisha: number): number {
  return Math.round(pricePoisha * 0.68);
}

/* ------------------------------------------------------------------ */
/* Clean                                                               */
/* ------------------------------------------------------------------ */

async function clean(): Promise<void> {
  console.log(`[demo-seed] cleaning demo data (db host: ${dbHost})`);

  const sale = await prisma.flashSale.findFirst({ where: { name: FLASH_SALE_NAME } });
  if (sale) {
    await prisma.flashSaleItem.deleteMany({ where: { flashSaleId: sale.id } });
    await prisma.flashSale.delete({ where: { id: sale.id } });
  }

  const demoOrders = await prisma.order.findMany({
    where: { idempotencyKey: { startsWith: "demo-seed-order-" } },
    select: { id: true },
  });
  const orderIds = demoOrders.map((o) => o.id);
  if (orderIds.length > 0) {
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderNote.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  }

  const demoCustomers = await prisma.customer.findMany({
    where: { phone: { startsWith: "+88019000000" } },
    select: { id: true },
  });
  const customerIds = demoCustomers.map((c) => c.id);
  if (customerIds.length > 0) {
    await prisma.address.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }

  const demoVariants = await prisma.productVariant.findMany({
    where: { sku: { startsWith: "DEMO-" } },
    select: { id: true },
  });
  const variantIds = demoVariants.map((x) => x.id);
  if (variantIds.length > 0) {
    await prisma.inventoryItem.deleteMany({ where: { variantId: { in: variantIds } } });
    await prisma.productVariant.deleteMany({ where: { id: { in: variantIds } } });
  }
  const demoProducts = await prisma.product.findMany({
    where: { slug: { startsWith: "demo-" } },
    select: { id: true },
  });
  const productIds = demoProducts.map((p) => p.id);
  if (productIds.length > 0) {
    await prisma.productImage.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }
  await prisma.category.deleteMany({ where: { slug: { in: CATEGORIES.map((c) => c.slug) } } });
  await prisma.user.deleteMany({ where: { email: { in: STAFF.map((s) => s.email) } } });

  console.log(
    `[demo-seed] clean done: removed ${orderIds.length} orders, ${customerIds.length} customers, ` +
      `${productIds.length} products, ${variantIds.length} variants, ${CATEGORIES.length} categories (if present), ${STAFF.length} staff (if present).`,
  );
}

/* ------------------------------------------------------------------ */
/* Seed                                                                */
/* ------------------------------------------------------------------ */

async function seedCategories(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const cat of CATEGORIES) {
    const row = await prisma.category.upsert({
      where: { slug: cat.slug },
      create: {
        slug: cat.slug,
        nameBn: cat.nameBn,
        nameEn: cat.nameEn,
        sortOrder: cat.sortOrder,
        imageUrl: `https://picsum.photos/seed/${cat.slug}/800/600`,
        isActive: true,
      },
      update: { nameBn: cat.nameBn, nameEn: cat.nameEn, sortOrder: cat.sortOrder, isActive: true, deletedAt: null },
    });
    ids.set(cat.slug, row.id);
  }
  return ids;
}

interface SeededVariant {
  id: string;
  sku: string;
  productNameEn: string;
  pricePoisha: number;
}

async function seedProducts(categoryIds: Map<string, string>): Promise<SeededVariant[]> {
  const warehouse = await prisma.warehouse.findUnique({ where: { id: "sample-main-warehouse" } });
  const seeded: SeededVariant[] = [];
  for (const p of PRODUCTS) {
    const categoryId = categoryIds.get(p.categorySlug);
    if (!categoryId) throw new Error(`Category missing for product ${p.slug}`);
    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      create: {
        slug: p.slug,
        titleBn: p.titleBn,
        titleEn: p.titleEn,
        descriptionBn: p.descriptionBn,
        descriptionEn: p.descriptionEn,
        categoryId,
        status: "ACTIVE",
        tags: ["demo"],
      },
      update: {
        titleBn: p.titleBn,
        titleEn: p.titleEn,
        descriptionBn: p.descriptionBn,
        descriptionEn: p.descriptionEn,
        categoryId,
        status: "ACTIVE",
        tags: ["demo"],
        deletedAt: null,
      },
    });
    // Images: exactly two per product, keyed deterministically by URL.
    const imageUrls = [
      `https://picsum.photos/seed/${p.slug}/900/1100`,
      `https://picsum.photos/seed/${p.slug}-alt/900/1100`,
    ];
    for (const [i, url] of imageUrls.entries()) {
      const existing = await prisma.productImage.findFirst({ where: { productId: product.id, url } });
      if (!existing) {
        await prisma.productImage.create({
          data: { productId: product.id, url, altBn: p.titleBn, altEn: p.titleEn, sortOrder: i },
        });
      }
    }
    for (const [vi, variant] of p.variants.entries()) {
      const row = await prisma.productVariant.upsert({
        where: { sku: variant.sku },
        create: {
          productId: product.id,
          attributes: variant.attributes,
          sku: variant.sku,
          pricePoisha: variant.pricePoisha,
          compareAtPoisha: variant.compareAtPoisha ?? null,
          costPoisha: costFor(variant.pricePoisha),
          stock: variant.stock,
          imageUrl: vi === 0 ? imageUrls[0] : null,
          isActive: true,
        },
        update: {
          productId: product.id,
          attributes: variant.attributes,
          pricePoisha: variant.pricePoisha,
          compareAtPoisha: variant.compareAtPoisha ?? null,
          costPoisha: costFor(variant.pricePoisha),
          stock: variant.stock,
          isActive: true,
          deletedAt: null,
        },
      });
      seeded.push({ id: row.id, sku: row.sku, productNameEn: p.titleEn, pricePoisha: row.pricePoisha });
      if (warehouse) {
        await prisma.inventoryItem.upsert({
          where: { variantId_warehouseId: { variantId: row.id, warehouseId: warehouse.id } },
          create: { variantId: row.id, warehouseId: warehouse.id, quantityOnHand: variant.stock, quantityReserved: 0 },
          update: { quantityOnHand: variant.stock },
        });
      }
    }
  }
  return seeded;
}

interface SeededCustomer {
  id: string;
  name: string;
  phone: string;
  division: string;
  district: string;
  upazila: string;
  union: string | null;
  addressLine: string;
}

async function seedCustomers(): Promise<SeededCustomer[]> {
  const out: SeededCustomer[] = [];
  for (const [i, c] of CUSTOMERS.entries()) {
    // Geo names come from the seeded DB — never invented here.
    const division = await prisma.division.findFirst({ where: { nameEn: c.divisionEn } });
    if (!division) throw new Error(`Geo division not found in DB: ${c.divisionEn} (run the base seed first)`);
    const district = c.districtEn
      ? await prisma.district.findFirst({ where: { nameEn: c.districtEn, divisionId: division.id } })
      : await prisma.district.findFirst({ where: { divisionId: division.id }, orderBy: { nameEn: "asc" } });
    if (!district) throw new Error(`Geo district not found in DB: ${c.districtEn ?? "(first)"} / ${c.divisionEn}`);
    const upazila = await prisma.upazila.findFirst({
      where: { districtId: district.id },
      orderBy: { nameEn: "asc" },
    });
    if (!upazila) throw new Error(`Geo upazila not found in DB for district ${district.nameEn}`);
    const union = await prisma.union.findFirst({ where: { upazilaId: upazila.id }, orderBy: { nameEn: "asc" } });

    // Always older than the oldest demo order (29 days) so no customer
    // appears to order before their account existed.
    const createdAt = dhakaTimeDaysAgo(40 - i, 10, 15);
    const customer = await prisma.customer.upsert({
      where: { phone: c.phone },
      create: {
        name: c.name,
        phone: c.phone,
        email: c.email ?? null,
        tags: ["demo"],
        createdAt,
      },
      update: { name: c.name, email: c.email ?? null, tags: ["demo"], deletedAt: null },
    });
    const addressCount = await prisma.address.count({ where: { customerId: customer.id } });
    if (addressCount === 0) {
      await prisma.address.create({
        data: {
          customerId: customer.id,
          label: "Home",
          division: division.nameEn,
          district: district.nameEn,
          upazila: upazila.nameEn,
          union: union?.nameEn ?? null,
          addressLine: c.house,
          isDefault: true,
        },
      });
    }
    out.push({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      division: division.nameEn,
      district: district.nameEn,
      upazila: upazila.nameEn,
      union: union?.nameEn ?? null,
      addressLine: c.house,
    });
  }
  return out;
}

async function seedOrders(customers: SeededCustomer[], variants: SeededVariant[]): Promise<void> {
  const rand = mulberry32(20261025);
  const statusChain: DemoStatus[] = ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED"];

  for (const [i, plan] of ORDER_PLAN.entries()) {
    const idempotencyKey = `demo-seed-order-${String(i + 1).padStart(2, "0")}`;
    const existing = await prisma.order.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) continue;

    const customer = customers[i % customers.length];
    if (!customer) throw new Error("No demo customers seeded");
    const createdAt = dhakaTimeDaysAgo(plan.dayOffset, plan.hourDhaka, 5 + ((i * 7) % 50));
    if (createdAt.getTime() > Date.now()) createdAt.setTime(Date.now() - (i + 1) * 60_000);

    // 1–3 distinct items at the variants' real prices.
    const itemCount = 1 + (rand() < 0.55 ? 1 : 0) + (rand() < 0.22 ? 1 : 0);
    const picked = new Map<string, { variant: SeededVariant; quantity: number }>();
    let guard = 0;
    while (picked.size < itemCount && guard < 20) {
      guard += 1;
      const variant = variants[Math.floor(rand() * variants.length)];
      if (!variant || picked.has(variant.id)) continue;
      picked.set(variant.id, { variant, quantity: 1 + (rand() < 0.3 ? 1 : 0) });
    }
    const items = [...picked.values()];
    const subtotalPoisha = items.reduce((sum, it) => sum + it.variant.pricePoisha * it.quantity, 0);
    const shippingPoisha = customer.division === "Dhaka" ? 6000 : 12000;
    const totalPoisha = subtotalPoisha + shippingPoisha;

    const method = plan.bkash ? "BKASH" : "COD";
    const paid = plan.bkash === true || plan.status === "DELIVERED";

    // Order number in the app's own format: ORD-<epochMs of creation>.
    const base = `ORD-${createdAt.getTime()}`;
    let orderNo = base;
    let suffix = 2;
    while (await prisma.order.findUnique({ where: { orderNo }, select: { id: true } })) {
      orderNo = `${base}-${suffix}`;
      suffix += 1;
    }

    // Status history: fractions of the elapsed window, always in the past.
    const now = Date.now();
    const span = Math.max(now - createdAt.getTime(), 3_600_000);
    const history: Array<{ from: DemoStatus | null; to: DemoStatus; at: Date }> = [
      { from: null, to: "PENDING", at: createdAt },
    ];
    if (plan.status === "CANCELLED") {
      history.push({ from: "PENDING", to: "CANCELLED", at: new Date(createdAt.getTime() + span * 0.3) });
    } else {
      const finalIdx = statusChain.indexOf(plan.status);
      const fractions = [0.2, 0.5, 0.8];
      for (let s = 1; s <= finalIdx; s += 1) {
        const to = statusChain[s];
        const from = statusChain[s - 1];
        if (!to || !from) continue;
        history.push({ from, to, at: new Date(createdAt.getTime() + span * (fractions[s - 1] ?? 0.5)) });
      }
    }

    await prisma.order.create({
      data: {
        orderNo,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        division: customer.division,
        district: customer.district,
        upazila: customer.upazila,
        union: customer.union,
        addressLine: customer.addressLine,
        status: plan.status,
        paymentMethod: method,
        paymentStatus: paid ? "PAID" : "UNPAID",
        subtotalPoisha,
        discountPoisha: 0,
        shippingPoisha,
        codFeePoisha: 0,
        taxPoisha: 0,
        totalPoisha,
        riskScore: Math.floor(rand() * 20),
        source: "website",
        idempotencyKey,
        createdAt,
        items: {
          create: items.map((it) => ({
            variantId: it.variant.id,
            productName: it.variant.productNameEn,
            sku: it.variant.sku,
            unitPricePoisha: it.variant.pricePoisha,
            quantity: it.quantity,
            createdAt,
          })),
        },
        history: {
          create: history.map((h) => ({ from: h.from, to: h.to, changedById: null, createdAt: h.at })),
        },
        notes: { create: { authorId: null, text: ORDER_NOTE_TEXT, createdAt } },
        payments: {
          create: {
            method,
            amountPoisha: totalPoisha,
            paidPoisha: paid ? totalPoisha : 0,
            status: paid ? "PAID" : "UNPAID",
            gatewayTransactionId: plan.bkash ? `DEMO-BKASH-${String(i + 1).padStart(3, "0")}` : null,
            createdAt,
          },
        },
      },
    });
  }
}

async function seedStaff(): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: { role: { name: "Owner" }, deletedAt: null },
    select: { id: true },
  });
  for (const s of STAFF) {
    const role = await prisma.role.findUnique({ where: { name: s.roleName } });
    if (!role) {
      console.warn(`[demo-seed] role not found, skipping staff: ${s.roleName}`);
      continue;
    }
    const existing = await prisma.user.findUnique({ where: { email: s.email }, select: { id: true } });
    if (existing) continue;
    // Unusable by construction: the password is a scrypt hash of random
    // bytes nobody knows, the account is inactive, and the invite token
    // is random — only its SHA-256 hash is stored.
    const unusablePasswordHash = `scrypt:${randomBytes(16).toString("hex")}:${scryptSync(randomBytes(32), randomBytes(16).toString("hex"), 64).toString("hex")}`;
    const inviteTokenHash = createHash("sha256").update(randomBytes(32)).digest("hex");
    await prisma.user.create({
      data: {
        email: s.email,
        name: s.name,
        passwordHash: unusablePasswordHash,
        roleId: role.id,
        isActive: false,
        inviteTokenHash,
        inviteExpiresAt: new Date(Date.now() + 72 * 3_600_000),
        invitedById: owner?.id ?? null,
      },
    });
  }
}

async function seedFlashSale(variants: SeededVariant[]): Promise<void> {
  const bySku = new Map(variants.map((x) => [x.sku, x]));
  const existing = await prisma.flashSale.findFirst({
    where: { name: FLASH_SALE_NAME, deletedAt: null },
    include: { items: true },
  });
  const now = new Date();
  const startsAt = new Date(now.getTime() - 24 * 3_600_000);
  const endsAt = new Date(now.getTime() + 48 * 3_600_000);
  let sale = existing;
  if (!sale) {
    sale = await prisma.flashSale.create({
      data: { name: FLASH_SALE_NAME, startsAt, endsAt, isActive: true },
      include: { items: true },
    });
  }
  for (const item of FLASH_ITEMS) {
    const variant = bySku.get(item.sku);
    if (!variant) throw new Error(`Flash sale variant missing: ${item.sku}`);
    const variantRow = await prisma.productVariant.findUnique({
      where: { sku: item.sku },
      select: { productId: true },
    });
    if (!variantRow) throw new Error(`Flash sale variant row missing: ${item.sku}`);
    const already = sale.items.some((it) => it.variantId === variant.id);
    if (!already) {
      await prisma.flashSaleItem.create({
        data: {
          flashSaleId: sale.id,
          productId: variantRow.productId,
          variantId: variant.id,
          salePricePoisha: item.salePricePoisha,
          stockCap: item.stockCap,
          soldCount: item.soldCount,
        },
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function reportCounts(label: string): Promise<void> {
  const [categories, products, variantCount, customers, orders, staff, sales] = await Promise.all([
    prisma.category.count({ where: { slug: { startsWith: "demo-" } } }),
    prisma.product.count({ where: { slug: { startsWith: "demo-" } } }),
    prisma.productVariant.count({ where: { sku: { startsWith: "DEMO-" } } }),
    prisma.customer.count({ where: { phone: { startsWith: "+88019000000" } } }),
    prisma.order.count({ where: { idempotencyKey: { startsWith: "demo-seed-order-" } } }),
    prisma.user.count({ where: { email: { in: STAFF.map((s) => s.email) } } }),
    prisma.flashSale.count({ where: { name: FLASH_SALE_NAME, deletedAt: null } }),
  ]);
  console.log(
    `[demo-seed] ${label}: categories=${categories} products=${products} variants=${variantCount} ` +
      `customers=${customers} orders=${orders} staff=${staff} flashSales=${sales}`,
  );
}

async function main(): Promise<void> {
  if (CLEAN) {
    await clean();
    await reportCounts("after clean");
    return;
  }
  console.log(`[demo-seed] seeding demo data (db host: ${dbHost})`);
  const categoryIds = await seedCategories();
  const variants = await seedProducts(categoryIds);
  const customers = await seedCustomers();
  await seedOrders(customers, variants);
  await seedStaff();
  await seedFlashSale(variants);
  await reportCounts("after seed");
  console.log("[demo-seed] done. Remove everything with: tsx scripts/seed-demo.ts --clean");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

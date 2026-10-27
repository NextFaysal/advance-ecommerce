/**
 * BAZAAR DEMO PACK — local/dev only, standalone (doc 24 wave T8 /
 * doc 25 wave S4b).
 *
 * Creates a small grocery catalogue so the "Bazaar" theme package
 * (home rails, category tiles, product cards, PDP, drawer) can be
 * evaluated with grocery-shaped content: 4 categories and 10
 * products with 1–2 variants each. All product names and
 * descriptions are ORIGINAL copy written for this demo pack; the
 * prices are illustrative; images are picsum placeholders (the
 * platform's established demo pattern).
 *
 * Every row is identifiable and removable:
 *  - product/category slugs start with "demo-bazaar-"
 *  - variant SKUs start with "DEMO-BZ-"
 *  - products carry the "demo" tag and a demo disclaimer line in
 *    both descriptions
 *  - `--clean` deletes exactly this pack's rows (products,
 *    variants, images, inventory rows, categories)
 *
 * SAFETY — two gates, both must pass:
 *  1. NODE_ENV=production → the script refuses outright.
 *  2. A non-localhost DATABASE_URL is refused unless
 *     DEMO_SEED_ALLOW_REMOTE=1 (the same escape the main demo seed
 *     uses, reserved for gated bootstrap runs — never set it by
 *     hand against a database you do not intend to demo-seed).
 *
 * This script is NOT wired into seed.ts / bootstrap — run it by
 * hand, locally:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/advance_ecommerce \
 *     pnpm --filter @advance-ecommerce/db exec tsx scripts/seed-bazaar-demo.ts [--clean]
 */
import { PrismaClient } from "@prisma/client";

/* ------------------------------------------------------------------ */
/* Safety gates                                                        */
/* ------------------------------------------------------------------ */

if (process.env["NODE_ENV"] === "production") {
  throw new Error("Refusing to run the Bazaar demo pack with NODE_ENV=production.");
}
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
      "Set DEMO_SEED_ALLOW_REMOTE=1 only for a gated demo run.",
  );
}

const prisma = new PrismaClient();
const CLEAN = process.argv.includes("--clean");

/* ------------------------------------------------------------------ */
/* Catalogue data — original names + descriptions                      */
/* ------------------------------------------------------------------ */

interface PackVariant {
  sku: string;
  attributes: Record<string, string>;
  pricePoisha: number;
  compareAtPoisha?: number;
  stock: number;
}

interface PackProduct {
  slug: string;
  categorySlug: string;
  titleBn: string;
  titleEn: string;
  descriptionBn: string;
  descriptionEn: string;
  variants: PackVariant[];
}

const DISCLAIMER_BN =
  "এটি একটি ডেমো পণ্য — থিম মূল্যায়নের জন্য তালিকাভুক্ত; আসল পণ্যের তালিকা নয়।";
const DISCLAIMER_EN =
  "Demo product — listed so the theme can be evaluated end to end; not a real listing.";

const CATEGORIES: ReadonlyArray<{
  slug: string;
  nameBn: string;
  nameEn: string;
  sortOrder: number;
}> = [
  { slug: "demo-bazaar-honey-dates", nameBn: "মধু ও খেজুর", nameEn: "Honey & Dates", sortOrder: 21 },
  { slug: "demo-bazaar-oil-ghee", nameBn: "তেল ও ঘি", nameEn: "Oil & Ghee", sortOrder: 22 },
  { slug: "demo-bazaar-spices", nameBn: "মসলা", nameEn: "Spices", sortOrder: 23 },
  { slug: "demo-bazaar-rice-dal", nameBn: "চাল ও ডাল", nameEn: "Rice & Lentils", sortOrder: 24 },
];

const PRODUCTS: ReadonlyArray<PackProduct> = [
  {
    slug: "demo-bazaar-sundarban-honey-500g",
    categorySlug: "demo-bazaar-honey-dates",
    titleBn: "সুন্দরবনের খাঁটি ফুলের মধু ৫০০ গ্রাম",
    titleEn: "Sundarbans Pure Flower Honey 500g",
    descriptionBn:
      "মৌয়ালদের সংগ্রহ করা খাঁটি ফুলের মধু — কোনো চিনি বা সিরাপ মেশানো নয়। প্রতিটি ব্যাচ ল্যাবে যাচাই করে তারপর বোতলজাত করা হয়। চা, দুধ কিংবা লেবু-পানির সঙ্গে প্রতিদিন এক চামচ করে খাওয়া যায়।",
    descriptionEn:
      "Pure flower honey collected by traditional honey hunters — no added sugar or syrup. Every batch is lab-checked before bottling. Take a spoonful daily with tea, milk or lemon water.",
    variants: [
      { sku: "DEMO-BZ-HON-500", attributes: { ওজন: "৫০০ গ্রাম" }, pricePoisha: 55000, compareAtPoisha: 65000, stock: 40 },
      { sku: "DEMO-BZ-HON-250", attributes: { ওজন: "২৫০ গ্রাম" }, pricePoisha: 30000, stock: 55 },
    ],
  },
  {
    slug: "demo-bazaar-mustard-honey-250g",
    categorySlug: "demo-bazaar-honey-dates",
    titleBn: "সরিষা ফুলের মধু ২৫০ গ্রাম",
    titleEn: "Mustard Flower Honey 250g",
    descriptionBn:
      "শীতের সরিষা ক্ষেত থেকে সংগৃহীত হালকা সোনালি মধু। ঠান্ডায় জমে যাওয়া এই মধুর স্বাভাবিক ধর্ম — গরম পানিতে বোতলটি কিছুক্ষণ রাখলেই আবার তরল হয়ে যাবে।",
    descriptionEn:
      "Light golden honey collected from winter mustard fields. Crystallising in the cold is natural for this honey — stand the jar in warm water and it turns liquid again.",
    variants: [
      { sku: "DEMO-BZ-MHO-250", attributes: { ওজন: "২৫০ গ্রাম" }, pricePoisha: 28000, stock: 35 },
    ],
  },
  {
    slug: "demo-bazaar-medjool-dates-500g",
    categorySlug: "demo-bazaar-honey-dates",
    titleBn: "মেডজুল খেজুর ৫০০ গ্রাম",
    titleEn: "Medjool Dates 500g",
    descriptionBn:
      "বড় আকারের নরম মেডজুল খেজুর — প্রাকৃতিকভাবে মিষ্টি, কোনো চিনি ছাড়াই। ইফতার, নাশতা কিংবা স্মুদিতে দুর্দান্ত। ফ্রিজে রেখে সংরক্ষণ করুন।",
    descriptionEn:
      "Large, soft Medjool dates — naturally sweet with no added sugar. Great for iftar, snacks or smoothies. Store refrigerated.",
    variants: [
      { sku: "DEMO-BZ-DAT-500", attributes: { ওজন: "৫০০ গ্রাম" }, pricePoisha: 72000, compareAtPoisha: 80000, stock: 28 },
      { sku: "DEMO-BZ-DAT-1000", attributes: { ওজন: "১ কেজি" }, pricePoisha: 138000, compareAtPoisha: 155000, stock: 16 },
    ],
  },
  {
    slug: "demo-bazaar-mustard-oil-1l",
    categorySlug: "demo-bazaar-oil-ghee",
    titleBn: "ঘানিভাঙা সরিষার তেল ১ লিটার",
    titleEn: "Cold-Pressed Mustard Oil 1L",
    descriptionBn:
      "কাঠের ঘানিতে ধীরে ভাঙানো সরিষার তেল — ঝাঁঝ ও ঘ্রাণ অটুট। ভাজি, ভর্তা আর আচারের জন্য উপযুক্ত। ছাঁকনি করা হলেও কোনো রাসায়নিক শোধন করা হয়নি।",
    descriptionEn:
      "Mustard oil slowly pressed in a wooden ghani — pungency and aroma intact. Ideal for frying, bhorta and pickles. Filtered only, never chemically refined.",
    variants: [
      { sku: "DEMO-BZ-OIL-1L", attributes: { পরিমাণ: "১ লিটার" }, pricePoisha: 34000, compareAtPoisha: 38000, stock: 60 },
      { sku: "DEMO-BZ-OIL-500", attributes: { পরিমাণ: "৫০০ মিলি" }, pricePoisha: 18500, stock: 45 },
    ],
  },
  {
    slug: "demo-bazaar-cow-ghee-450g",
    categorySlug: "demo-bazaar-oil-ghee",
    titleBn: "খাঁটি গরুর ঘি ৪৫০ গ্রাম",
    titleEn: "Pure Cow Ghee 450g",
    descriptionBn:
      "ঐতিহ্যবাহী পদ্ধতিতে জ্বাল দেওয়া দানাদার ঘি। পোলাও, খিচুড়ি আর মিষ্টিতে অল্প একটু দিলেই ঘ্রাণে ভরে যাবে রান্নাঘর। কাচের জারে সিল করে পাঠানো হয়।",
    descriptionEn:
      "Granular ghee slow-cooked the traditional way. A little in polao, khichuri or sweets fills the kitchen with aroma. Sealed in a glass jar.",
    variants: [
      { sku: "DEMO-BZ-GHE-450", attributes: { ওজন: "৪৫০ গ্রাম" }, pricePoisha: 78000, stock: 22 },
    ],
  },
  {
    slug: "demo-bazaar-turmeric-powder-200g",
    categorySlug: "demo-bazaar-spices",
    titleBn: "হলুদ গুঁড়া ২০০ গ্রাম",
    titleEn: "Turmeric Powder 200g",
    descriptionBn:
      "ভালো জাতের হলুদ শুকিয়ে নিজস্ব মিলে গুঁড়া করা — রং ও ঘ্রাণে তাজা। কোনো কৃত্রিম রং বা ভর মেশানো উপকরণ নেই। বায়ুরোধী প্যাকেটে পাঠানো হয়।",
    descriptionEn:
      "Good-grade turmeric, dried and ground in our own mill — fresh colour and aroma. No artificial colour or fillers. Packed airtight.",
    variants: [
      { sku: "DEMO-BZ-TUR-200", attributes: { ওজন: "২০০ গ্রাম" }, pricePoisha: 14000, stock: 80 },
    ],
  },
  {
    slug: "demo-bazaar-red-chili-powder-200g",
    categorySlug: "demo-bazaar-spices",
    titleBn: "শুকনো মরিচ গুঁড়া ২০০ গ্রাম",
    titleEn: "Red Chilli Powder 200g",
    descriptionBn:
      "রোদে শুকানো লাল মরিচের গুঁড়া — ঝাল মাঝারি থেকে বেশি। তরকারি, ভাজি আর চাটনিতে রং ও ঝাল দুটোই দেবে। আর্দ্রতা থেকে বাঁচাতে জিপলক প্যাকে দেওয়া হয়।",
    descriptionEn:
      "Sun-dried red chilli powder — medium to hot. Adds both colour and heat to curries, fries and chutneys. Packed in a resealable zip pouch.",
    variants: [
      { sku: "DEMO-BZ-CHI-200", attributes: { ওজন: "২০০ গ্রাম" }, pricePoisha: 16000, compareAtPoisha: 19000, stock: 70 },
    ],
  },
  {
    slug: "demo-bazaar-garam-masala-100g",
    categorySlug: "demo-bazaar-spices",
    titleBn: "গরম মসলা ১০০ গ্রাম",
    titleEn: "Garam Masala 100g",
    descriptionBn:
      "এলাচ, দারুচিনি, লবঙ্গসহ এগারো উপকরণের নিজস্ব মিশ্রণ। বড় ব্যাচ নয় — ছোট ব্যাচে ভেজে গুঁড়া করা হয়, যাতে ঘ্রাণ তাজা থাকে। কোরমা, রেজালা আর বিরিয়ানিতে উপযুক্ত।",
    descriptionEn:
      "Our own blend of eleven whole spices including cardamom, cinnamon and cloves. Roasted and ground in small batches so the aroma stays fresh. Suited to korma, rezala and biryani.",
    variants: [
      { sku: "DEMO-BZ-GAR-100", attributes: { ওজন: "১০০ গ্রাম" }, pricePoisha: 21000, stock: 50 },
    ],
  },
  {
    slug: "demo-bazaar-chinigura-rice-5kg",
    categorySlug: "demo-bazaar-rice-dal",
    titleBn: "চিনিগুঁড়া চাল ৫ কেজি",
    titleEn: "Chinigura Rice 5kg",
    descriptionBn:
      "সুগন্ধি চিনিগুঁড়া চাল — পোলাও, ফিরনি আর খিচুড়ির জন্য সেরা। পুরোনো চাল হওয়ায় ভাত ঝরঝরে হয়। বস্তা খুলে ভালোভাবে যাচাই করে তারপর প্যাক করা হয়।",
    descriptionEn:
      "Aromatic chinigura rice — the choice for polao, firni and khichuri. Aged grain cooks up separate and fluffy. Checked carefully before packing.",
    variants: [
      { sku: "DEMO-BZ-RIC-5K", attributes: { ওজন: "৫ কেজি" }, pricePoisha: 64000, compareAtPoisha: 70000, stock: 30 },
      { sku: "DEMO-BZ-RIC-10K", attributes: { ওজন: "১০ কেজি" }, pricePoisha: 124000, stock: 18 },
    ],
  },
  {
    slug: "demo-bazaar-masoor-dal-1kg",
    categorySlug: "demo-bazaar-rice-dal",
    titleBn: "মসুর ডাল ১ কেজি",
    titleEn: "Masoor Lentils 1kg",
    descriptionBn:
      "ছোট দানার মসুর ডাল — দ্রুত সিদ্ধ হয়, ঘন ডাল রান্নায় উপযুক্ত। পাথর ও অপরিষ্কার বাছাই করে প্যাক করা। দীর্ঘদিন ভালো রাখতে শুকনো পাত্রে রাখুন।",
    descriptionEn:
      "Small-grain masoor lentils — cook fast and make a thick, hearty dal. Cleaned of stones and debris before packing. Store in a dry container.",
    variants: [
      { sku: "DEMO-BZ-DAL-1K", attributes: { ওজন: "১ কেজি" }, pricePoisha: 15500, stock: 90 },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Helpers (mirroring scripts/seed-demo.ts conventions)                */
/* ------------------------------------------------------------------ */

function costFor(pricePoisha: number): number {
  return Math.round(pricePoisha * 0.7);
}

async function clean(): Promise<void> {
  const products = await prisma.product.findMany({
    where: { slug: { startsWith: "demo-bazaar-" } },
    select: { id: true, slug: true },
  });
  const productIds = products.map((p) => p.id);
  if (productIds.length > 0) {
    const variants = await prisma.productVariant.findMany({
      where: { productId: { in: productIds } },
      select: { id: true },
    });
    const variantIds = variants.map((v) => v.id);
    if (variantIds.length > 0) {
      await prisma.inventoryItem.deleteMany({ where: { variantId: { in: variantIds } } });
      await prisma.productVariant.deleteMany({ where: { id: { in: variantIds } } });
    }
    await prisma.productImage.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }
  const categories = await prisma.category.deleteMany({
    where: { slug: { startsWith: "demo-bazaar-" } },
  });
  console.log(
    `Bazaar demo pack cleaned: ${products.length} products, ${categories.count} categories removed.`,
  );
}

async function seed(): Promise<void> {
  const categoryIds = new Map<string, string>();
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
      update: {
        nameBn: cat.nameBn,
        nameEn: cat.nameEn,
        sortOrder: cat.sortOrder,
        isActive: true,
        deletedAt: null,
      },
    });
    categoryIds.set(cat.slug, row.id);
  }

  const warehouse = await prisma.warehouse.findUnique({
    where: { id: "sample-main-warehouse" },
  });

  for (const p of PRODUCTS) {
    const categoryId = categoryIds.get(p.categorySlug);
    if (!categoryId) throw new Error(`Category missing for product ${p.slug}`);
    const descriptionBn = `${p.descriptionBn}\n\n${DISCLAIMER_BN}`;
    const descriptionEn = `${p.descriptionEn}\n\n${DISCLAIMER_EN}`;
    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      create: {
        slug: p.slug,
        titleBn: p.titleBn,
        titleEn: p.titleEn,
        descriptionBn,
        descriptionEn,
        categoryId,
        status: "ACTIVE",
        tags: ["demo"],
      },
      update: {
        titleBn: p.titleBn,
        titleEn: p.titleEn,
        descriptionBn,
        descriptionEn,
        categoryId,
        status: "ACTIVE",
        tags: ["demo"],
        deletedAt: null,
      },
    });

    const imageUrls = [
      `https://picsum.photos/seed/${p.slug}/900/1100`,
      `https://picsum.photos/seed/${p.slug}-alt/900/1100`,
    ];
    for (const [i, url] of imageUrls.entries()) {
      const existing = await prisma.productImage.findFirst({
        where: { productId: product.id, url },
      });
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
      if (warehouse) {
        await prisma.inventoryItem.upsert({
          where: { variantId_warehouseId: { variantId: row.id, warehouseId: warehouse.id } },
          create: {
            variantId: row.id,
            warehouseId: warehouse.id,
            quantityOnHand: variant.stock,
            quantityReserved: 0,
          },
          update: { quantityOnHand: variant.stock },
        });
      }
    }
  }

  console.log(
    `Bazaar demo pack seeded: ${CATEGORIES.length} categories, ${PRODUCTS.length} products ` +
      `(${PRODUCTS.reduce((n, p) => n + p.variants.length, 0)} variants).`,
  );
}

async function main(): Promise<void> {
  if (CLEAN) await clean();
  else await seed();
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

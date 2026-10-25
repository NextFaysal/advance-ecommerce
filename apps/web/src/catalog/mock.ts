// TEMPORARY MOCK — NOT REAL DATA, NOT FROM DB.
// Used only until Step 8 Prisma service lands. Swap plan:
//   1. Implement getProducts()/getProductBySlug() in src/catalog/service.ts
//      using @advance-ecommerce/db Prisma client + the tables proposed in
//      SCHEMA-ADDITIONS.md.
//   2. Replace imports of MOCK_* in pages with that service.
//   3. Delete this file. No page should import it after Step 8.
// All prices are integer poisha. Images are placeholder paths — real media
// pipeline (R2, WebP/AVIF) lands in Step 9; see SCHEMA-ADDITIONS.md.

import type { Category, Product } from "./types";

export const MOCK_CATEGORIES: Category[] = [
  { slug: "fashion", name: { bn: "ফ্যাশন", en: "Fashion" }, imageUrl: null, productCount: 2 },
  { slug: "electronics", name: { bn: "ইলেকট্রনিক্স", en: "Electronics" }, imageUrl: null, productCount: 1 },
];

export const MOCK_PRODUCTS: Product[] = [
  {
    id: "prod-1",
    slug: "jamdani-sharee",
    title: { bn: "জামদানি শাড়ি", en: "Jamdani Sharee" },
    description: {
      bn: "হাতে বোনা আসল জামদানি শাড়ি — ঈদ, বিয়ে ও যেকোনো উৎসবের জন্য। নরম সুতি, আরামদায়ক ও দীর্ঘদিন টেকসই।",
      en: "Hand-woven authentic Jamdani sharee — for Eid, weddings and festivals. Soft cotton, comfortable and durable.",
    },
    categorySlug: "fashion",
    categoryName: { bn: "ফ্যাশন", en: "Fashion" },
    brandName: "Deshi Weave",
    status: "ACTIVE",
    images: [
      { id: "img-1", url: "/placeholder/sharee.jpg", altBn: "জামদানি শাড়ি", altEn: "Jamdani sharee", sortOrder: 0 },
    ],
    variants: [
      { id: "v-1", productId: "prod-1", attributes: { color: "লাল" }, sku: "JAMDANI-SHAREE-LAL", barcode: null, pricePoisha: 450000, compareAtPoisha: 550000, costPoisha: 300000, stock: 12, imageUrl: null, isActive: true },
      { id: "v-2", productId: "prod-1", attributes: { color: "নীল" }, sku: "JAMDANI-SHAREE-NIL", barcode: null, pricePoisha: 450000, compareAtPoisha: null, costPoisha: 300000, stock: 0, imageUrl: null, isActive: true },
    ],
    ratingAverage: 4.8,
    reviewCount: 34,
    tags: ["sharee", "jamdani", "eid"],
    seoTitle: { bn: "জামদানি শাড়ি কিনুন", en: "Buy Jamdani Sharee" },
    seoDescription: { bn: "আসল জামদানি শাড়ি সারাদেশে হোম ডেলিভারি।", en: "Authentic Jamdani sharee with home delivery across Bangladesh." },
    ogImage: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
  },
  {
    id: "prod-2",
    slug: "cotton-panjabi",
    title: { bn: "কটন পাঞ্জাবি", en: "Cotton Panjabi" },
    description: {
      bn: "প্রিমিয়াম কটন পাঞ্জাবি — গরমে আরাম, দেখতে স্মার্ট।",
      en: "Premium cotton panjabi — comfortable in heat, smart look.",
    },
    categorySlug: "fashion",
    categoryName: { bn: "ফ্যাশন", en: "Fashion" },
    brandName: "Deshi Weave",
    status: "ACTIVE",
    images: [
      { id: "img-2", url: "/placeholder/panjabi.jpg", altBn: "কটন পাঞ্জাবি", altEn: "Cotton panjabi", sortOrder: 0 },
    ],
    variants: [
      { id: "v-3", productId: "prod-2", attributes: { size: "M" }, sku: "COTTON-PANJABI-M", barcode: null, pricePoisha: 180000, compareAtPoisha: 220000, costPoisha: 110000, stock: 25, imageUrl: null, isActive: true },
      { id: "v-4", productId: "prod-2", attributes: { size: "L" }, sku: "COTTON-PANJABI-L", barcode: null, pricePoisha: 180000, compareAtPoisha: null, costPoisha: 110000, stock: 8, imageUrl: null, isActive: true },
    ],
    ratingAverage: 4.6,
    reviewCount: 18,
    tags: ["panjabi", "cotton"],
    seoTitle: null,
    seoDescription: null,
    ogImage: null,
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
  },
  {
    id: "prod-3",
    slug: "wireless-charger",
    title: { bn: "ওয়্যারলেস চার্জার", en: "Wireless Charger" },
    description: {
      bn: "ফাস্ট ওয়্যারলেস চার্জার — ফোন রাখলেই চার্জ শুরু।",
      en: "Fast wireless charger — charging starts the moment you place the phone.",
    },
    categorySlug: "electronics",
    categoryName: { bn: "ইলেকট্রনিক্স", en: "Electronics" },
    brandName: null,
    status: "ACTIVE",
    images: [
      { id: "img-3", url: "/placeholder/charger.jpg", altBn: "ওয়্যারলেস চার্জার", altEn: "Wireless charger", sortOrder: 0 },
    ],
    variants: [
      { id: "v-5", productId: "prod-3", attributes: {}, sku: "WIRELESS-CHARGER", barcode: null, pricePoisha: 120000, compareAtPoisha: null, costPoisha: 70000, stock: 40, imageUrl: null, isActive: true },
    ],
    ratingAverage: 4.4,
    reviewCount: 9,
    tags: ["charger", "mobile"],
    seoTitle: null,
    seoDescription: null,
    ogImage: null,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
  },
];

export function getMockProductBySlug(slug: string): Product | undefined {
  return MOCK_PRODUCTS.find((p) => p.slug === slug);
}

export function getMockActiveProducts(): Product[] {
  return MOCK_PRODUCTS.filter((p) => p.status === "ACTIVE");
}

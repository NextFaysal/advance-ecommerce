// Outbound catalog feeds (ADV-25): Google Shopping (RSS/XML),
// Facebook catalog (CSV), Daraz template (CSV).
//
// Eligibility — a product appears only when it is genuinely public
// and purchasable data exists: status ACTIVE, not deleted, not
// scheduled for a future publishAt, and NOT price-on-request (those
// prices are deliberately not public — staff quote from them). Every
// item is one VARIANT (price + stock live on variants), with a
// recorded price from the database. An empty catalog yields a valid
// empty feed, never an error page.

import { prisma } from "@advance-ecommerce/db";
import { buildCsv, stripMarkdown, xmlEscape } from "./common";

export interface FeedItem {
  /** Variant SKU — the stable external id. */
  id: string;
  /** Product id, for variant grouping (Google item_group_id). */
  groupId: string;
  groupSize: number;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  pricePoisha: number;
  compareAtPoisha: number | null;
  inStock: boolean;
  brand: string;
  categoryName: string;
  stock: number;
}

function absoluteUrl(baseUrl: string, url: string): string {
  if (url === "") return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `${baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function formatBdt(poisha: number): string {
  return (poisha / 100).toFixed(2);
}

export async function listFeedItems(baseUrl: string): Promise<FeedItem[]> {
  const now = new Date();
  const products = await prisma.product.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      priceOnRequest: false,
      OR: [{ publishAt: null }, { publishAt: { lte: now } }],
    },
    select: {
      id: true,
      slug: true,
      titleEn: true,
      titleBn: true,
      descriptionEn: true,
      descriptionBn: true,
      brand: { select: { name: true } },
      category: { select: { nameEn: true } },
      images: { orderBy: { sortOrder: "asc" }, select: { url: true }, take: 1 },
      variants: {
        where: { isActive: true, deletedAt: null },
        select: {
          sku: true,
          pricePoisha: true,
          compareAtPoisha: true,
          stock: true,
          imageUrl: true,
          attributes: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const items: FeedItem[] = [];
  for (const product of products) {
    const description = stripMarkdown(product.descriptionEn || product.descriptionBn).slice(0, 5000);
    const productImage = product.images[0]?.url ?? "";
    for (const variant of product.variants) {
      const attrs =
        variant.attributes && typeof variant.attributes === "object"
          ? Object.values(variant.attributes as Record<string, unknown>)
              .map((v) => String(v))
              .filter((v) => v !== "")
          : [];
      items.push({
        id: variant.sku,
        groupId: product.id,
        groupSize: product.variants.length,
        title: (product.titleEn || product.titleBn) + (attrs.length > 0 ? ` - ${attrs.join(" / ")}` : ""),
        description,
        link: `${baseUrl}/product/${product.slug}`,
        imageLink: absoluteUrl(baseUrl, variant.imageUrl || productImage),
        pricePoisha: variant.pricePoisha,
        compareAtPoisha: variant.compareAtPoisha,
        inStock: variant.stock > 0,
        brand: product.brand?.name ?? "",
        categoryName: product.category?.nameEn ?? "",
        stock: variant.stock,
      });
    }
  }
  return items;
}

/** Store display name from Settings (general.store_name), "" when unset. */
export async function getStoreName(): Promise<string> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: "general.store_name" } });
    const raw: unknown = row?.value;
    if (typeof raw === "string") {
      try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "string" ? parsed : raw;
      } catch {
        return raw;
      }
    }
    return "";
  } catch {
    return "";
  }
}

export function buildGoogleShoppingXml(
  items: FeedItem[],
  baseUrl: string,
  storeName: string,
  generatedAt: Date,
): string {
  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!-- generatedAt: ${generatedAt.toISOString()} | items: ${items.length} -->`,
    `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">`,
    `<channel>`,
    `<title>${xmlEscape(storeName || "Store")} — Product Feed</title>`,
    `<link>${xmlEscape(baseUrl)}</link>`,
    `<description>Product catalog feed (Google Shopping format). Prices in BDT.</description>`,
  ];
  for (const item of items) {
    const onSale = item.compareAtPoisha !== null && item.compareAtPoisha > item.pricePoisha;
    lines.push("<item>");
    lines.push(`<g:id>${xmlEscape(item.id)}</g:id>`);
    lines.push(`<g:title>${xmlEscape(item.title)}</g:title>`);
    lines.push(`<g:description>${xmlEscape(item.description)}</g:description>`);
    lines.push(`<g:link>${xmlEscape(item.link)}</g:link>`);
    if (item.imageLink !== "") lines.push(`<g:image_link>${xmlEscape(item.imageLink)}</g:image_link>`);
    lines.push(`<g:price>${formatBdt(onSale ? (item.compareAtPoisha as number) : item.pricePoisha)} BDT</g:price>`);
    if (onSale) lines.push(`<g:sale_price>${formatBdt(item.pricePoisha)} BDT</g:sale_price>`);
    lines.push(`<g:availability>${item.inStock ? "in_stock" : "out_of_stock"}</g:availability>`);
    lines.push(`<g:condition>new</g:condition>`);
    if (item.brand !== "") lines.push(`<g:brand>${xmlEscape(item.brand)}</g:brand>`);
    if (item.groupSize > 1) lines.push(`<g:item_group_id>${xmlEscape(item.groupId)}</g:item_group_id>`);
    lines.push("</item>");
  }
  lines.push(`</channel>`, `</rss>`);
  return lines.join("\n");
}

export function buildFacebookCatalogCsv(items: FeedItem[]): string {
  const rows = items.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description,
    availability: item.inStock ? "in stock" : "out of stock",
    condition: "new",
    price: `${formatBdt(item.pricePoisha)} BDT`,
    link: item.link,
    image_link: item.imageLink,
    brand: item.brand,
  }));
  return buildCsv(
    ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand"],
    rows,
  );
}

/**
 * Daraz feed in the same template columns the Daraz IMPORTER accepts,
 * so the file can round-trip. Template-based like the importer: the
 * column set targets the commonly documented Daraz seller-center
 * template and is labelled as such in the admin UI.
 */
export function buildDarazCatalogCsv(items: FeedItem[]): string {
  const headers = [
    "Product Name",
    "Brand",
    "Description",
    "Category",
    "Seller SKU",
    "Price",
    "Sale Price",
    "Quantity",
    "Image URL",
  ];
  const rows = items.map((item) => {
    const onSale = item.compareAtPoisha !== null && item.compareAtPoisha > item.pricePoisha;
    return {
      "Product Name": item.title,
      Brand: item.brand,
      Description: item.description,
      Category: item.categoryName,
      "Seller SKU": item.id,
      Price: formatBdt(onSale ? (item.compareAtPoisha as number) : item.pricePoisha),
      "Sale Price": onSale ? formatBdt(item.pricePoisha) : "",
      Quantity: String(item.stock),
      "Image URL": item.imageLink,
    };
  });
  return buildCsv(headers, rows);
}

export interface FeedSummary {
  id: "google-shopping" | "facebook-catalog" | "daraz";
  label: string;
  path: string;
  format: string;
  templateBased: boolean;
}

export const FEED_SUMMARIES: FeedSummary[] = [
  { id: "google-shopping", label: "Google Shopping", path: "/feeds/google-shopping.xml", format: "RSS 2.0 XML (g: namespace)", templateBased: false },
  { id: "facebook-catalog", label: "Facebook Catalog", path: "/feeds/facebook-catalog.csv", format: "CSV", templateBased: false },
  { id: "daraz", label: "Daraz", path: "/feeds/daraz.csv", format: "CSV (Daraz template columns)", templateBased: true },
];

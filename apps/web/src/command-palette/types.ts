/**
 * Command palette result types — Agent 28 (Admin Ctrl+K + global search).
 *
 * A PaletteResult is the single shape every source (nav pages, actions,
 * demo orders/products/customers, natural-language links) is normalised
 * into, so the component renders and keyboard-navigates one flat list.
 *
 * Display rule (project-wide): a result's title/subtitle must NEVER carry
 * a full phone number — customers/orders show the masked phone only. Since
 * the orders/customers sources became the real admin APIs (which return
 * masked phones by default), the full number never enters the palette
 * index at all — not even inside `keywords`.
 */

export type PaletteGroupId = "pages" | "orders" | "products" | "customers" | "actions";

/** Group render order — fixed by the task spec. */
export const PALETTE_GROUP_ORDER: readonly PaletteGroupId[] = [
  "pages",
  "orders",
  "products",
  "customers",
  "actions",
];

export const PALETTE_GROUP_LABELS: Record<PaletteGroupId, { bn: string; en: string }> = {
  pages: { bn: "পেজ", en: "Pages" },
  orders: { bn: "অর্ডার", en: "Orders" },
  products: { bn: "পণ্য", en: "Products" },
  customers: { bn: "গ্রাহক", en: "Customers" },
  actions: { bn: "কাজ / ফিল্টার", en: "Actions" },
};

/** Where a result's data came from — shown in the UI so demo data is
 *  never mistaken for live data. */
export type PaletteSource =
  | "nav-config"
  | "actions"
  | "orders-db"
  | "catalog-db"
  | "customers-db"
  | "ai-search-parser";

export interface PaletteResult {
  /** Stable unique id, e.g. "page:orders", "order:ord-1", "nl:pending-dhaka". */
  id: string;
  group: PaletteGroupId;
  titleBn: string;
  titleEn: string;
  /** Secondary line (masked phone, status, price…). Never a full phone. */
  subtitle?: string;
  href: string;
  /** Lucide icon name (string), same convention as the nav config. */
  icon: string;
  /** Extra searchable text (SKUs, order-number digits, phone digits,
   *  English/Bangla aliases). Search-only — never displayed. */
  keywords: readonly string[];
  source: PaletteSource;
  /** Paid add-on whose flag is off — stays listed with a lock badge. */
  locked?: boolean;
}

export interface PaletteGroupResults {
  group: PaletteGroupId;
  labelBn: string;
  labelEn: string;
  results: PaletteResult[];
}

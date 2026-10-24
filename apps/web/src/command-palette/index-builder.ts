/**
 * Palette index builder — Agent 28; orders/customers rewired to the real
 * admin APIs in the UI wiring pass (the orders module's DB swap landed).
 *
 * Sources (pages/actions are local config; the data groups are loaded by
 * the caller from the admin APIs on mount — no API calls happen here):
 *   pages     — src/admin-nav/config ADMIN_NAV (the same config the
 *               sidebar renders, so palette and sidebar never disagree)
 *   actions   — static quick actions pointing at real admin pages
 *   orders    — REAL orders DB: the caller passes rows loaded from
 *               GET /api/v1/admin/orders (Prisma repository).
 *   products  — REAL catalog DB: the caller passes ACTIVE products
 *               loaded from GET /api/v1/admin/products (Prisma
 *               repository); this builder re-filters to ACTIVE so a
 *               DRAFT/ARCHIVED product can never leak into the palette.
 *   customers — REAL customers DB: the caller passes rows loaded from
 *               GET /api/v1/admin/customers (Prisma repository).
 *
 * Phones: the admin APIs already return MASKED phones for viewers
 * without customers.view_full_phone, and subtitles pass through
 * maskPhone() again (idempotent) — so the full number never enters the
 * palette index at all: it is neither rendered nor placed in keywords.
 */
import { maskPhone } from "@advance-ecommerce/validators";
import { ADMIN_NAV, isLockedAddOn } from "../admin-nav/config";
import type { Product } from "../catalog/types";
import type { Customer, Order } from "../orders/types";
import { formatPoisha } from "../components/ui/money";
import type { PaletteResult } from "./types";

function pageResults(): PaletteResult[] {
  return ADMIN_NAV.map((item) => ({
    id: `page:${item.id}`,
    group: "pages",
    titleBn: item.labelBn,
    titleEn: item.labelEn,
    subtitle: item.path,
    href: item.path,
    icon: item.icon,
    keywords: [item.path.replace("/admin/", "").replace(/\//g, " "), item.id],
    source: "nav-config",
    locked: isLockedAddOn(item),
  }));
}

export interface PaletteAction {
  id: string;
  titleBn: string;
  titleEn: string;
  href: string;
  icon: string;
  keywords: readonly string[];
}

/** Quick actions — every href is a page that exists on disk. */
export const PALETTE_ACTIONS: readonly PaletteAction[] = [
  {
    id: "new-order",
    titleBn: "নতুন অর্ডার তৈরি",
    titleEn: "Create new order",
    href: "/admin/orders",
    icon: "PlusCircle",
    keywords: ["new order", "manual order", "create order", "নতুন অর্ডার"],
  },
  {
    id: "add-product",
    titleBn: "পণ্য যোগ করুন",
    titleEn: "Add product",
    href: "/admin/products/new",
    icon: "PackagePlus",
    keywords: ["add product", "new product", "পণ্য যোগ"],
  },
  {
    id: "create-coupon",
    titleBn: "কুপন / ক্যাম্পেইন",
    titleEn: "Coupons & campaigns",
    href: "/admin/marketing",
    icon: "Megaphone",
    keywords: ["coupon", "campaign", "flash sale", "কুপন"],
  },
  {
    id: "assign-rider",
    titleBn: "রাইডার অ্যাসাইন",
    titleEn: "Assign a rider",
    href: "/admin/riders",
    icon: "Bike",
    keywords: ["rider assign", "delivery assign", "রাইডার"],
  },
  {
    id: "export-report",
    titleBn: "রিপোর্ট দেখুন / এক্সপোর্ট",
    titleEn: "View & export reports",
    href: "/admin/reports",
    icon: "BarChart3",
    keywords: ["report", "export", "sales report", "রিপোর্ট"],
  },
  {
    id: "cash-closing",
    titleBn: "দৈনিক ক্যাশ ক্লোজিং (ERP)",
    titleEn: "Daily cash closing (ERP)",
    href: "/admin/erp",
    icon: "Calculator",
    keywords: ["cash closing", "accounts", "ক্যাশ ক্লোজিং", "হিসাব"],
  },
];

function actionResults(): PaletteResult[] {
  return PALETTE_ACTIONS.map((action) => ({
    id: `action:${action.id}`,
    group: "actions",
    titleBn: action.titleBn,
    titleEn: action.titleEn,
    href: action.href,
    icon: action.icon,
    keywords: action.keywords,
    source: "actions",
  }));
}

function orderResults(orders: readonly Order[]): PaletteResult[] {
  return orders.map((order) => ({
    id: `order:${order.id}`,
    group: "orders",
    titleBn: order.orderNo,
    titleEn: `${order.orderNo} — ${order.customerName}`,
    subtitle: `${order.status} · ${formatPoisha(order.totalPoisha)} · ${maskPhone(order.customerPhone)}`,
    href: `/admin/orders/${order.id}`,
    icon: "ShoppingCart",
    keywords: [
      order.orderNo,
      order.orderNo.replace("ORD-", ""),
      order.customerName,
      order.status,
      order.address.district,
      order.address.division,
      ...order.items.map((item) => item.sku),
      ...order.items.map((item) => item.productName),
    ],
    source: "orders-db",
  }));
}

function productResults(products: readonly Product[]): PaletteResult[] {
  // Defensive ACTIVE filter on top of the caller's ACTIVE-only query:
  // the palette must never surface a DRAFT/ARCHIVED product.
  return products
    .filter((product) => product.status === "ACTIVE")
    .map((product) => {
      const minPrice = Math.min(...product.variants.map((v) => v.pricePoisha));
      return {
        id: `product:${product.id}`,
        group: "products",
        titleBn: product.title.bn,
        titleEn: product.title.en,
        subtitle: `${product.brandName ?? product.categoryName.en} · ${formatPoisha(minPrice)} থেকে`,
        href: "/admin/products",
        icon: "Package",
        keywords: [
          product.slug,
          product.title.en,
          product.title.bn,
          product.categorySlug,
          ...product.tags,
          ...product.variants.map((v) => v.sku),
        ],
        source: "catalog-db",
      } satisfies PaletteResult;
    });
}

function customerResults(customers: readonly Customer[]): PaletteResult[] {
  return customers.map((customer) => ({
    id: `customer:${customer.id}`,
    group: "customers",
    titleBn: customer.name,
    titleEn: customer.name,
    subtitle: `${maskPhone(customer.phone)} · ${customer.totalOrders}টি অর্ডার · মোট ${formatPoisha(customer.lifetimeValuePoisha)}`,
    href: "/admin/customers",
    icon: "Users",
    keywords: [customer.name, ...customer.tags],
    source: "customers-db",
  }));
}

/** The palette index. Products, orders and customers are supplied by the
 *  caller (loaded from the admin APIs on mount); a group whose fetch
 *  failed simply stays empty — the palette never falls back to mock data. */
export function buildPaletteIndex(
  products: readonly Product[] = [],
  orders: readonly Order[] = [],
  customers: readonly Customer[] = [],
): PaletteResult[] {
  return [
    ...pageResults(),
    ...orderResults(orders),
    ...productResults(products),
    ...customerResults(customers),
    ...actionResults(),
  ];
}

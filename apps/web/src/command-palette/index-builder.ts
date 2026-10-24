/**
 * Palette index builder — Agent 28.
 *
 * Sources (all LOCAL, no API calls; demo sources are labelled on every
 * result via `source` and shown as a "ডেমো ডেটা" badge in the UI):
 *   pages     — src/admin-nav/config ADMIN_NAV (the same config the
 *               sidebar renders, so palette and sidebar never disagree)
 *   actions   — static quick actions pointing at real admin pages
 *   orders    — TEMPORARY MOCK: src/orders/mock MOCK_ORDERS
 *   products  — TEMPORARY MOCK: src/catalog/mock MOCK_PRODUCTS
 *   customers — TEMPORARY MOCK: src/orders/mock MOCK_CUSTOMERS
 * When the DB-backed APIs land, swap the three mock imports for service
 * results of the same shape — this builder's output does not change.
 *
 * Phones: subtitles use maskPhone() ONLY. Full digits live in keywords
 * (search-only, never rendered) so staff can find a customer by typing
 * their number, without the palette ever displaying it.
 */
import { maskPhone } from "@advance-ecommerce/validators";
import { ADMIN_NAV, isLockedAddOn } from "../admin-nav/config";
import { MOCK_PRODUCTS } from "../catalog/mock";
import { MOCK_CUSTOMERS, MOCK_ORDERS } from "../orders/mock";
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

function orderResults(): PaletteResult[] {
  return MOCK_ORDERS.map((order) => ({
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
      order.customerPhone,
      order.customerPhone.replace("+88", ""),
      order.status,
      order.address.district,
      order.address.division,
      ...order.items.map((item) => item.sku),
      ...order.items.map((item) => item.productName),
    ],
    source: "TEMPORARY_MOCK:orders",
  }));
}

function productResults(): PaletteResult[] {
  return MOCK_PRODUCTS.map((product) => {
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
      source: "TEMPORARY_MOCK:catalog",
    } satisfies PaletteResult;
  });
}

function customerResults(): PaletteResult[] {
  return MOCK_CUSTOMERS.map((customer) => ({
    id: `customer:${customer.id}`,
    group: "customers",
    titleBn: customer.name,
    titleEn: customer.name,
    subtitle: `${maskPhone(customer.phone)} · ${customer.totalOrders}টি অর্ডার · মোট ${formatPoisha(customer.lifetimeValuePoisha)}`,
    href: "/admin/customers",
    icon: "Users",
    keywords: [
      customer.name,
      customer.phone,
      customer.phone.replace("+88", ""),
      ...customer.tags,
    ],
    source: "TEMPORARY_MOCK:customers",
  }));
}

/** The default palette index. Built once per module load; the data is
 *  static demo/nav data, so there is nothing to invalidate yet. When
 *  real sources land, rebuild per open instead. */
export function buildPaletteIndex(): PaletteResult[] {
  return [
    ...pageResults(),
    ...orderResults(),
    ...productResults(),
    ...customerResults(),
    ...actionResults(),
  ];
}

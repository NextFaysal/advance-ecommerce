// Admin dashboard home — Agent 23 rebuild.
// ALL data on this page is TEMPORARY DEMO data, labelled as such in the UI:
// sales totals come from src/reports/demo.ts via the real reports service,
// recent orders from src/orders/mock.ts, low stock from the demo inventory
// through the real inventory service. No live/DB data is shown or implied;
// each block swaps to real queries at the same points the owning pages do.
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/table";
import { Money, formatPoisha } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import { StatusBadge, type OrderStatus as BadgeOrderStatus } from "@/components/ui/status-badge";
import { ADMIN_NAV, isLockedAddOn, type AdminNavItem } from "@/admin-nav/config";
import { aggregateSales } from "@/reports/service";
import { DEMO_SALES_ROWS, DEMO_INVENTORY, DEMO_LOW_STOCK_THRESHOLD, daysAgoIso, todayIso } from "@/reports/demo";
import { MOCK_ORDERS } from "@/orders/mock";
import { InMemoryInventoryStore, lowStockList } from "@/inventory/service";
import type { OrderStatus } from "@/orders/types";

const BADGE_STATUSES: readonly BadgeOrderStatus[] = [
  "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED",
  "DELIVERED", "CANCELLED", "FAILED", "RETURNED", "REFUNDED",
];

/** Presentation-only emoji per nav item (config stores Lucide names for
 *  the shell; tiles here need a glyph without importing icon components). */
const TILE_ICONS: Record<string, string> = {
  orders: "🧾", "call-center": "📞", riders: "🛵", products: "📦",
  inventory: "🗄️", customers: "👥", resellers: "🏪", reports: "📊",
  analytics: "📈", automation: "⚙️", fraud: "🛡️", modules: "🧩",
  erp: "🧮", "settings-payments": "💳", "settings-shipping": "🚚",
  "settings-notifications": "🔔", "settings-integrations": "🔌",
  "design-system": "🎨",
};

function greetingBn(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Dhaka" }).format(new Date()),
  );
  if (hour < 5) return "শুভ রাত্রি";
  if (hour < 12) return "শুভ সকাল";
  if (hour < 16) return "শুভ দুপুর";
  if (hour < 19) return "শুভ বিকেল";
  return "শুভ সন্ধ্যা";
}

function statusCell(status: OrderStatus) {
  if ((BADGE_STATUSES as readonly string[]).includes(status)) {
    return <StatusBadge status={status as BadgeOrderStatus} />;
  }
  return <Badge tone="neutral">{status}</Badge>;
}

export default function AdminHome() {
  const bundle = aggregateSales(
    DEMO_SALES_ROWS,
    { from: daysAgoIso(30), to: todayIso() },
    false,
  );
  const totals = bundle.totals;
  const pendingCount = MOCK_ORDERS.filter((o) => o.status === "PENDING").length;
  const lowStock = lowStockList(
    new InMemoryInventoryStore(DEMO_INVENTORY),
    DEMO_LOW_STOCK_THRESHOLD,
  );
  const tiles: AdminNavItem[] = ADMIN_NAV.filter((item) => item.id !== "dashboard");

  return (
    <main>
      {/* Hero — gradient is allowed on hero/CTA only (design spec). */}
      <section className="brand-gradient mb-6 rounded-lg p-6 text-white">
        <p className="text-sm text-white/80">Advance Ecommerce — অ্যাডমিন</p>
        <h1 className="mt-1 text-2xl font-bold leading-8">{greetingBn()}! 👋</h1>
        <p className="mt-1 text-sm text-white/90">
          আজকের দোকানের সারসংক্ষেপ নিচে — সব সংখ্যাই এখন <strong>TEMPORARY DEMO</strong> ডেটা থেকে,
          ডাটাবেস যুক্ত হলে আসল সংখ্যা দেখাবে।
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/admin/orders" className="flex min-h-[44px] items-center rounded-md bg-white px-4 text-sm font-semibold text-brand-700">
            + নতুন অর্ডার
          </Link>
          <Link href="/admin/products/new" className="flex min-h-[44px] items-center rounded-md bg-white/15 px-4 text-sm font-medium text-white ring-1 ring-white/40">
            পণ্য যোগ করুন
          </Link>
          <Link href="/admin/riders" className="flex min-h-[44px] items-center rounded-md bg-white/15 px-4 text-sm font-medium text-white ring-1 ring-white/40">
            BD টুলস — নিজের রাইডার
          </Link>
        </div>
      </section>

      <PageHeader
        title="সারসংক্ষেপ (শেষ ৩০ দিন)"
        description="TEMPORARY DEMO — রিপোর্ট সার্ভিসের ডেমো সারি থেকে হিসাব করা, লাইভ বিক্রয় নয়।"
      />
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="মোট বিক্রয় (ডেমো)" value={formatPoisha(totals.revenuePoisha)} delta="শেষ ৩০ দিন · ডেমো" icon="💰" />
        <StatCard label="অর্ডার (ডেমো রিপোর্ট)" value={String(totals.orders)} delta="শেষ ৩০ দিন · ডেমো" icon="🧾" />
        <StatCard label="মুলতুবি অর্ডার (ডেমো)" value={String(pendingCount)} delta="নিশ্চিত করা বাকি" icon="◷" accent="bg-amber-50 text-amber-600" />
        <StatCard label="কম স্টক আইটেম (ডেমো)" value={String(lowStock.length)} delta={`থ্রেশহোল্ড ≤ ${DEMO_LOW_STOCK_THRESHOLD}`} deltaTone={lowStock.length > 0 ? "down" : "up"} icon="⚠" accent="bg-rose-50 text-rose-600" />
      </div>

      <PageHeader title="সব মডিউল" description="প্রতিটি বিদ্যমান অ্যাডমিন পেজ — লক ব্যাজের অ্যাড-অনগুলো ফিচার ফ্ল্যাগ চালু হলে খুলবে।" />
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {tiles.map((item) => (
          <Link key={item.id} href={item.path} className="block">
            <Card className="h-full transition hover:border-brand-300">
              <div className="flex items-start justify-between">
                <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-brand-50 text-xl">
                  {TILE_ICONS[item.id] ?? "•"}
                </span>
                {isLockedAddOn(item) ? <Badge tone="warning">🔒 অ্যাড-অন</Badge> : null}
              </div>
              <p className="mt-3 font-semibold">{item.labelBn}</p>
              <p className="text-xs text-text-muted">{item.labelEn} · {item.path}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <PageHeader title="সাম্প্রতিক অর্ডার" description="TEMPORARY DEMO — src/orders/mock.ts থেকে।" />
          <DataTable
            columns={[
              { key: "orderNo", header: "অর্ডার" },
              { key: "customer", header: "গ্রাহক" },
              { key: "phone", header: "ফোন" },
              { key: "status", header: "অবস্থা" },
              { key: "total", header: "মোট" },
            ]}
            rows={MOCK_ORDERS.slice(0, 5).map((o) => ({
              orderNo: (
                <Link href={`/admin/orders/${o.id}`} className="font-medium text-brand-700">
                  {o.orderNo}
                </Link>
              ),
              customer: o.customerName,
              phone: <Phone phone={o.customerPhone} />,
              status: statusCell(o.status),
              total: <Money poisha={o.totalPoisha} />,
            }))}
          />
        </div>

        <div>
          <PageHeader title="কম স্টক" description="TEMPORARY DEMO — ডেমো ইনভেন্টরি থেকে।" />
          <Card>
            {lowStock.length === 0 ? (
              <p className="text-sm text-text-muted">কম স্টকের কোনো আইটেম নেই।</p>
            ) : (
              <ul className="divide-y divide-border">
                {lowStock.map((row) => (
                  <li key={`${row.warehouseId}-${row.variantId}`} className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-mono text-sm">{row.variantId}</p>
                      <p className="text-xs text-text-muted">গুদাম: {row.warehouseId} · রিজার্ভ: {row.quantityReserved}</p>
                    </div>
                    <Badge tone={row.quantityAvailable === 0 ? "danger" : "warning"}>
                      {row.quantityAvailable === 0 ? "✕ স্টক শেষ" : `⚠ বাকি ${row.quantityAvailable}`}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-text-subtle">
              ডেমো ইনভেন্টরিতে ভ্যারিয়েন্টের শুধু আইডি আছে — পণ্যের নাম ডাটাবেস যুক্ত হলে আসবে।
            </p>
            <Link href="/admin/inventory" className="mt-2 inline-block text-sm font-medium text-brand-700">
              ইনভেন্টরি খুলুন →
            </Link>
          </Card>
        </div>
      </div>
    </main>
  );
}

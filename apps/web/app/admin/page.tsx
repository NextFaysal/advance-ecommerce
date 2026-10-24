// Admin dashboard home.
// All figures are real DB aggregations (src/reports/dashboard.ts):
// sales from order-item rows via the reports service, order counts by
// status, low stock from InventoryItem state, pending manual-Trx
// reviews from ManualTrxSubmission. An empty database renders honest
// zeros and empty states — no demo data anywhere on this page.
//
// Presentation (Design Refresh R3, Direction A): bento grid — KPI cards
// with real period strips (আজ / সপ্তাহ / ৩০ দিন), a revenue panel with
// gradient period bars, an orders-by-status donut from countsByStatus,
// pending-actions and low-stock lists, recent orders. Every number
// below comes from the same getDashboardData() call as before; charts
// visualize only those aggregates (no invented time series).
//
// Design v3 note: the revenue AREA chart stays unbuilt on purpose —
// DashboardData carries only nested period aggregates (today ⊂ week ⊂
// 30 days), no daily series, and the period values double as the KPI
// "sparklines" for the same reason (a line through nested cumulative
// totals would fabricate a trend). When src/reports grows a daily
// series, swap the period bars for the area chart + KPI sparklines.
import type { ReactNode } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Money, formatPoisha } from "@/components/ui/money";
import { CountUp } from "@/components/ui/count-up";
import { Phone } from "@/components/ui/phone";
import { StatusBadge, type OrderStatus as BadgeOrderStatus } from "@/components/ui/status-badge";
import { ADMIN_NAV, isLockedAddOn } from "@/admin-nav/config";
import { getDashboardData } from "@/reports/dashboard";
import type { OrderStatus } from "@/orders/types";

export const dynamic = "force-dynamic";

const BADGE_STATUSES: readonly BadgeOrderStatus[] = [
  "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED",
  "DELIVERED", "CANCELLED", "FAILED", "RETURNED", "REFUNDED",
];

/* Inline SVG icons (Lucide-style strokes; lucide-react is not installed). */
const ICON_PATHS: Record<string, ReactNode> = {
  LayoutDashboard: (<><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>),
  ShoppingCart: (<><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></>),
  CreditCard: (<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>),
  Truck: (<><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><path d="M15 18h-5" /><path d="M15 8h4l3 5v4a1 1 0 0 1-1 1h-2" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>),
  PhoneCall: (<><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /><path d="M15 3a6 6 0 0 1 6 6" /><path d="M15 7a2 2 0 0 1 2 2" /></>),
  Bike: (<><circle cx="18.5" cy="17.5" r="3.5" /><circle cx="5.5" cy="17.5" r="3.5" /><circle cx="15" cy="5" r="1" /><path d="M12 17.5V14l-3-3 4-3 2 3h2" /></>),
  Store: (<><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" /><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M2 7h20v5H2z" /><path d="M9 22v-6h6v6" /></>),
  Inbox: (<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
  MapPin: (<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>),
  Split: (<><path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="m21 3-7.536 7.536a2 2 0 0 1-1.414.584H9" /><path d="m3 3 7.536 7.536A2 2 0 0 0 11.95 11.12H15" /><path d="M12 12v9" /></>),
  Package: (<><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></>),
  Warehouse: (<><path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z" /><path d="M6 18h12" /><path d="M6 14h12" /><path d="M10 22v-4h4v4" /></>),
  FileText: (<><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></>),
  Users: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  Megaphone: (<><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>),
  Rocket: (<><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></>),
  Gift: (<><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13" /><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" /><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" /></>),
  Sparkles: (<><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></>),
  BarChart3: (<><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>),
  LineChart: (<><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></>),
  TrendingUp: (<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></>),
  Workflow: (<><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M9 6h6a3 3 0 0 1 3 3v6" /><circle cx="6" cy="18" r="3" /></>),
  ShieldAlert: (<><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="M12 8v4" /><path d="M12 16h.01" /></>),
  Blocks: (<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>),
  Calculator: (<><rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" x2="16" y1="6" y2="6" /><line x1="16" x2="16" y1="14" y2="18" /><path d="M16 10h.01" /><path d="M12 10h.01" /><path d="M8 10h.01" /><path d="M12 14h.01" /><path d="M8 14h.01" /><path d="M12 18h.01" /><path d="M8 18h.01" /></>),
  Building2: (<><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" /><path d="M2 22h20" /><path d="M9 6h1" /><path d="M14 6h1" /><path d="M9 10h1" /><path d="M14 10h1" /><path d="M9 14h1" /><path d="M14 14h1" /><path d="M10 22v-3h4v3" /></>),
  Briefcase: (<><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>),
  Settings: (<><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" /></>),
  Bell: (<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>),
  Flag: (<><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" x2="4" y1="22" y2="15" /></>),
  ListOrdered: (<><line x1="10" x2="21" y1="6" y2="6" /><line x1="10" x2="21" y1="12" y2="12" /><line x1="10" x2="21" y1="18" y2="18" /><path d="M4 6h1v4" /><path d="M4 10h2" /><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" /></>),
  Palette: (<><circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.685 1.685 0 0 1 1.69-1.688H21c.928 0 1.664-.75 1.664-1.686C22.664 6.5 17.5 2 12 2z" /></>),
  Plug: (<><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" /></>),
  ScrollText: (<><path d="M15 2h-8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M9 13h6" /><path d="M9 17h6" /></>),
  Lock: (<><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
  Clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  Banknote: (<><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></>),
  TriangleAlert: (<><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>),
  ClipboardCheck: (<><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="m9 14 2 2 4-4" /></>),
  ChevronRight: (<><path d="m9 18 6-6-6-6" /></>),
};

function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {ICON_PATHS[name] ?? <circle cx="12" cy="12" r="3" />}
    </svg>
  );
}

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

/* Donut segment colors per order status (chart palette order from the design spec). */
const STATUS_COLORS: Partial<Record<OrderStatus, string>> = {
  PENDING: "#F59E0B",
  CONFIRMED: "#0EA5E9",
  PROCESSING: "#8B5CF6",
  PACKED: "#7C3AED",
  SHIPPED: "#6366F1",
  DELIVERED: "#10B981",
  CANCELLED: "#94A3B8",
  FAILED: "#F43F5E",
  RETURNED: "#F97316",
  REFUNDED: "#14B8A6",
};

function KpiCard({
  label, value, icon, accent, children,
}: {
  label: string; value: ReactNode; icon: string; accent: string; children?: ReactNode;
}) {
  return (
    <Card className="shadow-card transition motion-base hover:shadow-lift">
      <div className="flex items-start justify-between gap-2">
        <span aria-hidden="true" className={`flex h-11 w-11 items-center justify-center rounded-md ${accent}`}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-3 text-caption font-medium text-text-muted">{label}</p>
      <p className="font-mono text-2xl font-bold tabular-nums leading-8">{value}</p>
      {children}
    </Card>
  );
}

function PeriodStrip({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
      {items.map((it) => (
        <span key={it.label} className="min-w-0 flex-1">
          <span className="block truncate text-caption text-text-subtle">{it.label}</span>
          <span className="block truncate font-mono text-small font-semibold tabular-nums">{it.value}</span>
        </span>
      ))}
    </div>
  );
}

export default async function AdminHome() {
  const data = await getDashboardData();
  const { totals } = data;
  const tiles = ADMIN_NAV.filter((item) => item.id !== "dashboard");

  /* Orders-by-status donut — all-time counts, real data only. */
  const statusEntries = (Object.entries(data.countsByStatus) as [OrderStatus, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const statusTotal = statusEntries.reduce((s, [, n]) => s + n, 0);
  const DONUT_R = 42;
  const DONUT_C = 2 * Math.PI * DONUT_R;
  let donutOffset = 0;
  const donutSegments = statusEntries.map(([status, n]) => {
    const frac = statusTotal > 0 ? n / statusTotal : 0;
    const seg = { status, n, frac, dash: frac * DONUT_C, offset: donutOffset };
    donutOffset += frac * DONUT_C;
    return seg;
  });

  /* Revenue period bars — আজ / এই সপ্তাহ / শেষ ৩০ দিন (nested totals, labelled as such). */
  const revenueBars = [
    { label: "আজ", revenue: data.today.revenuePoisha, orders: data.today.orders },
    { label: "এই সপ্তাহ (৭ দিন)", revenue: data.week.revenuePoisha, orders: data.week.orders },
    { label: "শেষ ৩০ দিন", revenue: totals.revenuePoisha, orders: totals.orders },
  ];
  const revenueMax = Math.max(1, ...revenueBars.map((b) => b.revenue));
  const aovPoisha = totals.orders > 0 ? Math.round(totals.revenuePoisha / totals.orders) : 0;

  const pendingActions = [
    { label: "মুলতুবি অর্ডার নিশ্চিত করা বাকি", count: data.pendingCount, href: "/admin/orders?status=PENDING", icon: "Clock", accent: "bg-amber-50 text-amber-600" },
    { label: "ম্যানুয়াল TrxID যাচাই বাকি", count: data.pendingTrxReviews, href: "/admin/payments", icon: "ClipboardCheck", accent: "bg-sky-50 text-sky-600" },
    { label: "কম স্টক আইটেম", count: data.lowStock.length, href: "/admin/inventory", icon: "TriangleAlert", accent: "bg-rose-50 text-rose-600" },
  ];
  const pendingTotal = pendingActions.reduce((s, a) => s + a.count, 0);

  return (
    <main>
      {/* Hero — gradient is allowed on hero/CTA only (design spec). */}
      <section className="brand-gradient relative mb-6 overflow-hidden rounded-lg p-6 text-white shadow-md sm:p-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 right-40 h-56 w-56 rounded-full bg-white/10" />
        <div className="relative">
          <p className="text-small font-medium text-white/80">Advance Ecommerce — অ্যাডমিন</p>
          <h1 className="mt-1 text-h2">{greetingBn()}!</h1>
          <p className="mt-1 max-w-xl text-small leading-relaxed text-white/90">
            আজকের বিক্রয় {formatPoisha(data.today.revenuePoisha)} ({data.today.orders}টি অর্ডার) — সব সংখ্যা আসল ডাটাবেস থেকে হিসাব করা (Asia/Dhaka)।
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/admin/orders" className="flex min-h-[44px] items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-brand-700 shadow-sm transition motion-fast hover:bg-brand-50">
              <Icon name="ShoppingCart" className="h-4 w-4" />
              অর্ডার দেখুন
            </Link>
            <Link href="/admin/products/new" className="flex min-h-[44px] items-center gap-2 rounded-md bg-white/15 px-4 text-sm font-medium text-white ring-1 ring-white/40 transition motion-fast hover:bg-white/25">
              <Icon name="Package" className="h-4 w-4" />
              পণ্য যোগ করুন
            </Link>
            <Link href="/admin/riders" className="flex min-h-[44px] items-center gap-2 rounded-md bg-white/15 px-4 text-sm font-medium text-white ring-1 ring-white/40 transition motion-fast hover:bg-white/25">
              <Icon name="Bike" className="h-4 w-4" />
              নিজের রাইডার
            </Link>
          </div>
        </div>
      </section>

      {/* KPI row */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="মোট বিক্রয় (৩০ দিন)" value={<CountUp value={totals.revenuePoisha} format="poisha" />} icon="Banknote" accent="bg-brand-50 text-brand-600">
          <PeriodStrip items={[
            { label: "আজ", value: formatPoisha(data.today.revenuePoisha) },
            { label: "সপ্তাহ", value: formatPoisha(data.week.revenuePoisha) },
          ]} />
        </KpiCard>
        <KpiCard label="অর্ডার (৩০ দিন)" value={<CountUp value={totals.orders} format="plain" />} icon="ShoppingCart" accent="bg-violet-500/10 text-violet-600">
          <PeriodStrip items={[
            { label: "আজ", value: `${data.today.orders}টি` },
            { label: "সপ্তাহ", value: `${data.week.orders}টি` },
          ]} />
        </KpiCard>
        <KpiCard label="মোট লাভ (৩০ দিন)" value={<CountUp value={totals.grossProfitPoisha} format="poisha" />} icon="TrendingUp" accent="bg-emerald-50 text-emerald-600">
          <p className="mt-3 border-t border-border pt-3 text-caption text-text-muted">
            নিট আয় {formatPoisha(totals.netRevenuePoisha)} · বিক্রিত পণ্য {totals.units}টি
          </p>
        </KpiCard>
        <KpiCard label="গড় অর্ডার মূল্য" value={<CountUp value={aovPoisha} format="poisha" />} icon="Calculator" accent="bg-sky-50 text-sky-600">
          <p className="mt-3 border-t border-border pt-3 text-caption text-text-muted">
            রিফান্ড {formatPoisha(totals.refundPoisha)} · শিপিং চার্জ {formatPoisha(totals.shippingPoisha)}
          </p>
        </KpiCard>
      </div>

      {/* Bento row 1 — revenue + status donut */}
      <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="shadow-card xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-h3">বিক্রয় চিত্র</h2>
              <p className="mt-0.5 text-caption text-text-muted">
                {data.range.from} → {data.range.to} · প্রতিটি বার ওই সময়ের মোট বিক্রয় (অর্ডার আইটেম থেকে)।
              </p>
            </div>
            <Link href="/admin/reports" className="flex items-center gap-1 text-small font-semibold text-brand-700 hover:underline">
              রিপোর্ট খুলুন
              <Icon name="ChevronRight" className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-6 space-y-5">
            {revenueBars.map((bar) => {
              const pct = Math.round((bar.revenue / revenueMax) * 100);
              return (
                <div key={bar.label} className="group">
                  <div className="mb-1.5 flex items-baseline justify-between gap-2 text-small">
                    <span className="font-medium text-text-main">{bar.label}</span>
                    <span className="flex items-baseline gap-2 text-text-muted">
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 font-mono text-caption font-semibold tabular-nums text-brand-700">
                        {pct}%
                      </span>
                      <span className="font-mono font-bold tabular-nums text-text-main">{formatPoisha(bar.revenue)}</span>
                      <span>{" · "}{bar.orders}টি অর্ডার</span>
                    </span>
                  </div>
                  <div
                    className="h-4 overflow-hidden rounded-full bg-surface-2 shadow-[inset_0_1px_2px_rgba(49,46,129,0.08)]"
                    role="img"
                    aria-label={`${bar.label}: ${formatPoisha(bar.revenue)}, ${bar.orders}টি অর্ডার`}
                  >
                    <div
                      className="brand-gradient h-full rounded-full shadow-sm transition-all motion-base group-hover:brightness-110"
                      style={{ width: `${Math.max(2, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-4">
            {[
              { label: "মোট লাভ", value: formatPoisha(totals.grossProfitPoisha) },
              { label: "নিট আয়", value: formatPoisha(totals.netRevenuePoisha) },
              { label: "রিফান্ড", value: formatPoisha(totals.refundPoisha) },
              { label: "খরচ (পণ্য)", value: formatPoisha(totals.costPoisha) },
            ].map((m) => (
              <div key={m.label}>
                <p className="text-caption text-text-subtle">{m.label}</p>
                <p className="font-mono text-small font-bold tabular-nums">{m.value}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="shadow-card">
          <h2 className="text-h3">স্ট্যাটাস অনুযায়ী অর্ডার</h2>
          <p className="mt-0.5 text-caption text-text-muted">সব সময়ের মোট অর্ডার — স্ট্যাটাসভিত্তিক হিসাব।</p>
          {statusTotal === 0 ? (
            <div className="flex flex-col items-center px-2 py-10 text-center">
              <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-500">
                <Icon name="ShoppingCart" className="h-6 w-6" />
              </span>
              <p className="mt-3 text-small font-medium">এখনো কোনো অর্ডার নেই</p>
              <p className="mt-1 text-caption text-text-muted">প্রথম অর্ডার এলেই এখানে স্ট্যাটাসের ছবি দেখা যাবে।</p>
            </div>
          ) : (
            <>
              <div className="relative mx-auto mt-5 h-[168px] w-[168px]">
                <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                  <circle cx="60" cy="60" r={DONUT_R} fill="none" stroke="currentColor" strokeWidth="13" opacity="0.45" className="text-border" />
                  {donutSegments.map((seg) => (
                    <circle
                      key={seg.status}
                      cx="60"
                      cy="60"
                      r={DONUT_R}
                      fill="none"
                      stroke={STATUS_COLORS[seg.status] ?? "#6366F1"}
                      strokeWidth="13"
                      strokeDasharray={`${Math.max(0, seg.dash - 2)} ${DONUT_C - Math.max(0, seg.dash - 2)}`}
                      strokeDashoffset={-seg.offset}
                    />
                  ))}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-mono text-2xl font-bold tabular-nums">{statusTotal}</span>
                  <span className="text-caption text-text-muted">মোট অর্ডার</span>
                </div>
              </div>
              <ul className="mt-4 space-y-1.5">
                {donutSegments.map((seg) => (
                  <li key={seg.status} className="flex items-center gap-2 text-small">
                    <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLORS[seg.status] ?? "#6366F1" }} />
                    <span className="min-w-0 flex-1">{statusCell(seg.status)}</span>
                    <span className="font-mono font-semibold tabular-nums">{seg.n}</span>
                    <span className="w-11 text-right text-caption tabular-nums text-text-subtle">
                      {Math.round(seg.frac * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      {/* Bento row 2 — recent orders + side stack */}
      <div className="mb-8 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="shadow-card xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-h3">সাম্প্রতিক অর্ডার</h2>
              <p className="mt-0.5 text-caption text-text-muted">ডাটাবেসের সর্বশেষ ৫টি অর্ডার।</p>
            </div>
            <Link href="/admin/orders" className="flex items-center gap-1 text-small font-semibold text-brand-700 hover:underline">
              সব অর্ডার
              <Icon name="ChevronRight" className="h-4 w-4" />
            </Link>
          </div>
          {data.recentOrders.length === 0 ? (
            <div className="flex flex-col items-center px-2 py-10 text-center">
              <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-500">
                <Icon name="Inbox" className="h-6 w-6" />
              </span>
              <p className="mt-3 text-small font-medium">এখনো কোনো অর্ডার আসেনি</p>
              <p className="mt-1 max-w-sm text-caption text-text-muted">
                স্টোরফ্রন্ট থেকে প্রথম অর্ডার এলেই এখানে দেখা যাবে। পণ্য যোগ করা থাকলে দোকান প্রস্তুত।
              </p>
              <Link href="/admin/products/new" className="brand-gradient mt-4 flex min-h-[40px] items-center rounded-md px-4 text-sm font-semibold text-white shadow-md transition motion-fast hover:opacity-95">
                পণ্য যোগ করুন
              </Link>
            </div>
          ) : (
            <ul className="mt-2 divide-y divide-border">
              {data.recentOrders.map((o) => (
                <li key={o.id}>
                  <Link href={`/admin/orders/${o.id}`} className="group flex items-center gap-3 py-3 transition motion-fast">
                    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-muted transition group-hover:bg-brand-50 group-hover:text-brand-600">
                      <Icon name="ShoppingCart" className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-small font-semibold text-brand-700">{o.orderNo}</span>
                      <span className="block truncate text-caption text-text-muted">
                        {o.customerName} · <Phone phone={o.customerPhone} />
                      </span>
                    </span>
                    {statusCell(o.status)}
                    <span className="shrink-0 text-small">
                      <Money poisha={o.totalPoisha} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          {/* Pending actions */}
          <Card className="shadow-card">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-h3">করণীয়</h2>
              {pendingTotal > 0 ? <Badge tone="warning">{pendingTotal}টি বাকি</Badge> : <Badge tone="success">সব ঠিক আছে</Badge>}
            </div>
            <ul className="mt-2 divide-y divide-border">
              {pendingActions.map((a) => (
                <li key={a.label}>
                  <Link href={a.href} className="group flex items-center gap-3 py-3">
                    <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${a.accent}`}>
                      <Icon name={a.icon} className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1 text-small font-medium leading-snug">{a.label}</span>
                    <span className="font-mono text-base font-bold tabular-nums">{a.count}</span>
                    <span aria-hidden="true" className="text-text-subtle transition group-hover:text-brand-600">
                      <Icon name="ChevronRight" className="h-4 w-4" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          {/* Low stock */}
          <Card className="shadow-card">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-h3">কম স্টক</h2>
              <Link href="/admin/inventory" className="flex items-center gap-1 text-small font-semibold text-brand-700 hover:underline">
                ইনভেন্টরি
                <Icon name="ChevronRight" className="h-4 w-4" />
              </Link>
            </div>
            <p className="mt-0.5 text-caption text-text-muted">উপলব্ধ স্টক থ্রেশহোল্ড (≤ {data.lowStockThreshold})-এর নিচে।</p>
            {data.lowStock.length === 0 ? (
              <p className="py-4 text-small text-text-muted">কম স্টকের কোনো আইটেম নেই।</p>
            ) : (
              <ul className="divide-y divide-border">
                {data.lowStock.map((row) => (
                  <li key={`${row.warehouseId}-${row.variantId}`} className="flex items-center justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-small">{row.variantId}</p>
                      <p className="text-caption text-text-muted">গুদাম: {row.warehouseName} · রিজার্ভ: {row.quantityReserved}</p>
                    </div>
                    <Badge tone={row.quantityAvailable === 0 ? "danger" : "warning"}>
                      <Icon name="TriangleAlert" className="h-3 w-3" />
                      {row.quantityAvailable === 0 ? "স্টক শেষ" : `বাকি ${row.quantityAvailable}`}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* All modules */}
      <PageHeader title="সব মডিউল" description="প্রতিটি অ্যাডমিন পেজ — লক ব্যাজের অ্যাড-অনগুলো ফিচার ফ্ল্যাগ চালু হলে খুলবে।" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {tiles.map((item) => (
          <Link key={item.id} href={item.path} className="group block">
            <Card className="h-full shadow-card transition motion-base group-hover:-translate-y-0.5 group-hover:border-brand-300 group-hover:shadow-lift">
              <div className="flex items-start justify-between gap-2">
                <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-md bg-brand-50 text-brand-600 transition motion-fast group-hover:bg-brand-100">
                  <Icon name={item.icon} className="h-5 w-5" />
                </span>
                {isLockedAddOn(item) ? (
                  <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-caption font-semibold text-amber-700">
                    <Icon name="Lock" className="h-3 w-3" />
                    অ্যাড-অন
                  </span>
                ) : null}
              </div>
              <p className="mt-3 font-semibold leading-snug">{item.labelBn}</p>
              <p className="mt-0.5 truncate text-caption text-text-muted">{item.labelEn} · {item.path}</p>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}

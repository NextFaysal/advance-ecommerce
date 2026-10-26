import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { formatPoisha } from "@/components/ui/money";
import InstallPrompt from "@/pwa/install-prompt";
import { validateSessionToken } from "@/lib/auth";
import { getDashboardData } from "@/reports/dashboard";

// Owner PWA start page (wave 58) — a read-only, phone-first summary
// over the SAME aggregation the admin dashboard renders
// (src/reports/dashboard.ts getDashboardData — the admin home calls
// it directly too; there is no dashboard HTTP API to reuse, and this
// page invents none). Every figure is a live DB aggregate; an empty
// database shows honest zeros.
//
// Auth: unlike the /rider shell (presence gate + API-side checks),
// this page renders private aggregates itself, so it validates the
// staff session token server-side first — any valid staff session,
// the same access level as /admin itself. Customer phone numbers are
// deliberately NOT rendered here (the dashboard data carries them;
// a glanceable owner summary doesn't need them).
export const dynamic = "force-dynamic";

const STATUS_LABEL_BN: Record<string, string> = {
  PENDING: "পেন্ডিং",
  CONFIRMED: "নিশ্চিত",
  PROCESSING: "প্রসেসিং",
  PACKED: "প্যাকড",
  SHIPPED: "পাঠানো হয়েছে",
  DELIVERED: "ডেলিভারড",
  CANCELLED: "বাতিল",
  FAILED: "ব্যর্থ",
  RETURNED: "ফেরত",
  REFUNDED: "রিফান্ড",
};

export default async function OwnerPage() {
  const token = cookies().get("admin_session")?.value;
  const session = token ? await validateSessionToken(token).catch(() => null) : null;
  if (!session) redirect("/admin/login?next=/owner");

  const data = await getDashboardData();
  const statusEntries = Object.entries(data.countsByStatus).filter(([, n]) => (n ?? 0) > 0);

  return (
    <div className="space-y-4">
      <InstallPrompt />

      <section className="grid grid-cols-2 gap-2" aria-label="আজকের সারাংশ">
        <div className="rounded-xl bg-surface-2 px-4 py-3">
          <p className="text-xs text-text-muted">আজকের বিক্রি</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{formatPoisha(data.today.revenuePoisha)}</p>
          <p className="text-xs text-text-muted">{data.today.orders}টি অর্ডার</p>
        </div>
        <div className="rounded-xl bg-surface-2 px-4 py-3">
          <p className="text-xs text-text-muted">গত ৭ দিনের বিক্রি</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{formatPoisha(data.week.revenuePoisha)}</p>
          <p className="text-xs text-text-muted">{data.week.orders}টি অর্ডার</p>
        </div>
        <div className="rounded-xl bg-surface-2 px-4 py-3">
          <p className="text-xs text-text-muted">পেন্ডিং অর্ডার</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{data.pendingCount}</p>
          <p className="text-xs text-text-muted">ব্যবস্থা নেওয়া বাকি</p>
        </div>
        <div className="rounded-xl bg-surface-2 px-4 py-3">
          <p className="text-xs text-text-muted">পেমেন্ট রিভিউ বাকি</p>
          <p className="mt-1 text-xl font-bold tabular-nums">{data.pendingTrxReviews}</p>
          <p className="text-xs text-text-muted">ম্যানুয়াল Trx জমা পড়েছে</p>
        </div>
      </section>

      {statusEntries.length > 0 ? (
        <section className="rounded-xl border border-border px-4 py-3" aria-label="অর্ডারের অবস্থা">
          <h2 className="mb-2 font-semibold">অর্ডারের অবস্থা (সর্বমোট)</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {statusEntries.map(([status, count]) => (
              <li key={status} className="rounded-full bg-surface-2 px-3 py-1">
                {STATUS_LABEL_BN[status] ?? status}: <span className="font-semibold tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.lowStock.length > 0 ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" role="status">
          ⚠️ {data.lowStock.length}টি পণ্যের স্টক কম (সীমা {data.lowStockThreshold} বা তার নিচে) —{" "}
          <Link href="/admin/products" className="font-medium underline">পণ্য দেখুন</Link>
        </p>
      ) : null}

      <section aria-label="সাম্প্রতিক অর্ডার">
        <h2 className="mb-2 font-semibold">সাম্প্রতিক অর্ডার</h2>
        {data.recentOrders.length === 0 ? (
          <p className="rounded-xl bg-surface-2 px-4 py-6 text-center text-sm text-text-muted">এখনো কোনো অর্ডার নেই।</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {data.recentOrders.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/orders/${o.id}`} className="flex items-center justify-between px-4 py-3">
                  <span>
                    <span className="block font-medium">{o.orderNo}</span>
                    <span className="block text-sm text-text-muted">{o.customerName} • {STATUS_LABEL_BN[o.status] ?? o.status}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatPoisha(o.totalPoisha)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <nav className="grid grid-cols-2 gap-2 pb-4" aria-label="দ্রুত লিংক">
        <Link href="/admin/orders" className="flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-3 font-medium">
          <Icon name="package" size={18} /> সব অর্ডার
        </Link>
        <Link href="/admin" className="flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-3 font-medium">
          <Icon name="grid" size={18} /> পূর্ণ ড্যাশবোর্ড
        </Link>
        <Link href="/admin/riders" className="flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-3 font-medium">
          <Icon name="truck" size={18} /> রাইডার বোর্ড
        </Link>
        <Link href="/rider" className="flex items-center gap-2 rounded-xl bg-surface-2 px-4 py-3 font-medium">
          <Icon name="check" size={18} /> রাইডার অ্যাপ
        </Link>
      </nav>

      <p className="pb-2 text-center text-[11px] text-text-muted">
        সব সংখ্যা লাইভ ডাটাবেস থেকে — এই পেজ শুধু দেখার জন্য, পরিবর্তন পূর্ণ অ্যাডমিনে।
      </p>
    </div>
  );
}

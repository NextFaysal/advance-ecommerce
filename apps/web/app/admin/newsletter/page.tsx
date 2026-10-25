import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { listNewsletterSubscribers } from "@/newsletter/store-db";

// Newsletter subscribers — admin list (wave 7). The public subscribe
// form has persisted NewsletterSubscriber rows since wave 3a, but no
// admin surface could see them; this page (and GET
// /api/v1/admin/newsletter/subscribers) closes that gap. Data is REAL
// — the Prisma store via src/newsletter/store-db.ts. The list is
// capped at the newest 200 rows; the stat totals are true DB counts,
// not page counts. A failed read renders an error card, never
// invented rows. Guarded by marketing.coupon in the API/nav layer.
export const dynamic = "force-dynamic";

const dateFmt = new Intl.DateTimeFormat("bn-BD", {
  timeZone: "Asia/Dhaka",
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export default async function AdminNewsletterPage() {
  let list: Awaited<ReturnType<typeof listNewsletterSubscribers>> | null = null;
  try {
    list = await listNewsletterSubscribers(200);
  } catch {
    list = null;
  }

  return (
    <main>
      <PageHeader
        title="নিউজলেটার সাবস্ক্রাইবার"
        description="স্টোরফ্রন্টের নিউজলেটার ফর্ম থেকে সংগ্রহ করা আসল সাবস্ক্রাইবার — ডাটাবেসের NewsletterSubscriber টেবিল থেকে। সর্বশেষ ২০০টি দেখানো হয়; মোট সংখ্যা আসল গণনা। (Newsletter Subscribers — marketing.coupon)"
        breadcrumb="Admin / Marketing"
      />
      {list === null ? (
        <p role="alert" className="rounded-md bg-rose-50 px-3.5 py-2.5 text-small leading-relaxed text-rose-700">
          ডাটাবেস থেকে সাবস্ক্রাইবার পড়া যায়নি — কোনো সংখ্যা দেখানো হচ্ছে না। (Could not
          read subscribers from the database; no numbers are shown.)
        </p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard label="মোট সাবস্ক্রাইবার" value={String(list.total)} delta="ডাটাবেসের আসল গণনা" icon="✉️" />
            <StatCard label="সক্রিয় (সাবস্ক্রাইব করা)" value={String(list.subscribedTotal)} delta="এখনো সাবস্ক্রাইব করা আছেন" icon="✅" />
            <StatCard
              label="আনসাবস্ক্রাইব করেছেন"
              value={String(list.total - list.subscribedTotal)}
              delta="সাবস্ক্রিপশন বাতিল করেছেন"
              icon="↩️"
            />
          </div>
          {list.total === 0 ? (
            <p className="text-sm text-text-muted">
              এখনো কোনো সাবস্ক্রাইবার নেই। দর্শকরা স্টোরফ্রন্টের নিউজলেটার ফর্ম থেকে
              সাবস্ক্রাইব করলে তাঁদের ইমেইল এখানে দেখা যাবে। (No subscribers yet —
              addresses collected by the storefront newsletter form will appear here.)
            </p>
          ) : (
            <DataTable
              caption="সর্বশেষ সাবস্ক্রাইবার — নতুন থেকে পুরনো (সর্বোচ্চ ২০০টি)"
              columns={[
                { key: "email", header: "ইমেইল" },
                { key: "source", header: "উৎস" },
                { key: "status", header: "অবস্থা" },
                { key: "createdAt", header: "সাবস্ক্রাইবের সময়" },
                { key: "unsubscribedAt", header: "আনসাবস্ক্রাইবের সময়" },
              ]}
              rows={list.subscribers.map((s) => ({
                email: <span className="font-medium">{s.email}</span>,
                source: s.source,
                status:
                  s.status === "subscribed" ? (
                    <Badge tone="success">সাবস্ক্রাইব করা</Badge>
                  ) : (
                    <Badge tone="neutral">আনসাবস্ক্রাইব</Badge>
                  ),
                createdAt: formatDate(s.createdAt),
                unsubscribedAt: formatDate(s.unsubscribedAt),
              }))}
            />
          )}
        </>
      )}
    </main>
  );
}

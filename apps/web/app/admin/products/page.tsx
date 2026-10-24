import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { listAllProducts } from "@/catalog/server-read";
import { minVariantPricePoisha } from "@/catalog/types";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";

// Admin product list — staff view, so cost is NOT shown here by default either:
// cost visibility is a field-level permission (Step 4 RBAC) and is gated
// server-side in the products API. This page shows price + stock only.
// Data: real catalog DB via src/catalog/server-read — ALL statuses
// (admins legitimately see DRAFT/ARCHIVED here; the public read path
// stays ACTIVE-only). An empty DB renders the honest empty state.
//
// Presentation (Design Refresh R3): PageHeader + token table system,
// status tone badges, designed empty state. Data read unchanged.
export const dynamic = "force-dynamic";

const STATUS_META: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "brand" }> = {
  ACTIVE: { label: "সক্রিয়", tone: "success" },
  DRAFT: { label: "খসড়া", tone: "warning" },
  ARCHIVED: { label: "আর্কাইভ", tone: "neutral" },
};

export default async function AdminProductsPage() {
  const products = await listAllProducts();
  return (
    <main className="min-w-0">
      <PageHeader
        title="পণ্য"
        description="আসল ক্যাটালগ ডাটাবেস থেকে — সব স্ট্যাটাস (খসড়া ও আর্কাইভসহ) এখানে দেখা যায়।"
        actions={
          <Link
            href="/admin/products/new"
            className="brand-gradient inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-4 w-4">
              <path d="M12 5v14M5 12h14" />
            </svg>
            নতুন পণ্য
          </Link>
        }
      />

      {products.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-6 py-14 text-center shadow-card">
          <span aria-hidden="true" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
            </svg>
          </span>
          <h2 className="mt-4 text-h3">কোনো পণ্য নেই</h2>
          <p className="mx-auto mt-1 max-w-md text-small leading-relaxed text-text-muted">
            ক্যাটালগে এখনো কোনো পণ্য যোগ হয়নি — নতুন পণ্য যোগ করলেই এখানে দেখা যাবে।
          </p>
          <Link
            href="/admin/products/new"
            className="brand-gradient mt-5 inline-flex min-h-[44px] items-center justify-center rounded-md px-4 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105"
          >
            + নতুন পণ্য যোগ করুন
          </Link>
        </div>
      ) : (
        <>
        {/* Desktop table — hidden under md (card list below takes over,
         *  so a 360px screen never scrolls sideways). */}
        <div className="hidden overflow-x-auto rounded-lg border border-border bg-card shadow-card md:block">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-surface-2 text-left [&>th]:border-b [&>th]:border-border">
                <th scope="col" className="px-4 py-3 text-caption font-semibold text-text-muted">পণ্য</th>
                <th scope="col" className="px-4 py-3 text-caption font-semibold text-text-muted">দাম (থেকে)</th>
                <th scope="col" className="px-4 py-3 text-caption font-semibold text-text-muted">স্টক</th>
                <th scope="col" className="px-4 py-3 text-caption font-semibold text-text-muted">স্ট্যাটাস</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const stock = p.variants.reduce((s, v) => s + v.stock, 0);
                const meta = STATUS_META[p.status] ?? { label: p.status, tone: "neutral" as const };
                return (
                  <tr key={p.id} className="border-t border-border transition motion-fast first:border-t-0 hover:bg-surface-2/70">
                    <td className="min-w-0 px-4 py-3">
                      <span className="block break-words font-medium leading-snug [overflow-wrap:anywhere]">{p.title.bn}</span>
                      <span className="font-mono text-caption text-text-subtle">/{p.slug}</span>
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold tabular-nums">{formatBdt(minVariantPricePoisha(p))}</td>
                    <td className="px-4 py-3">
                      <span className={`font-mono tabular-nums ${stock <= 0 ? "font-semibold text-rose-600" : ""}`}>{stock}</span>
                      {stock <= 0 ? <span className="ml-1.5 text-caption text-rose-500">স্টক শেষ</span> : null}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile card list (under md) — same products, same fields. */}
        <div className="space-y-3 md:hidden">
          {products.map((p) => {
            const stock = p.variants.reduce((s, v) => s + v.stock, 0);
            const meta = STATUS_META[p.status] ?? { label: p.status, tone: "neutral" as const };
            return (
              <article key={p.id} className="rounded-lg border border-border bg-card p-4 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-medium leading-snug [overflow-wrap:anywhere]">{p.title.bn}</p>
                    <p className="mt-0.5 font-mono text-caption text-text-subtle">/{p.slug}</p>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                <div className="mt-3 flex items-center gap-4 border-t border-border pt-3 text-small">
                  <span>
                    <span className="block text-caption text-text-subtle">দাম (থেকে)</span>
                    <span className="font-mono font-semibold tabular-nums">{formatBdt(minVariantPricePoisha(p))}</span>
                  </span>
                  <span>
                    <span className="block text-caption text-text-subtle">স্টক</span>
                    <span className={`font-mono tabular-nums ${stock <= 0 ? "font-semibold text-rose-600" : ""}`}>
                      {stock}
                      {stock <= 0 ? <span className="ml-1.5 text-caption text-rose-500">স্টক শেষ</span> : null}
                    </span>
                  </span>
                </div>
              </article>
            );
          })}
        </div>
        </>
      )}
      <p className="mt-4 text-caption leading-relaxed text-text-subtle">
        ডেটা আসল ক্যাটালগ ডাটাবেস থেকে আসে। বাল্ক ইমপোর্ট/এক্সপোর্ট ও ইনলাইন দাম/স্টক এডিট API রুটে আছে।
      </p>
    </main>
  );
}

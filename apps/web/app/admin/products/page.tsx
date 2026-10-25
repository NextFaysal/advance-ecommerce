import Link from "next/link";
import { cookies } from "next/headers";
import { validateSessionToken } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { ProductsTable } from "./products-table";
import { ProductsExportButton } from "./export-button";

// Admin product list — staff view of the real catalog DB, ALL statuses
// (admins legitimately see DRAFT/ARCHIVED here; the public read path
// stays ACTIVE-only). Since Wave 13-3 the list is SERVER-paginated:
// this page only resolves the viewer's capability flags and renders
// the interactive ProductsTable (client), which fetches one page at a
// time from GET /api/v1/admin/products and carries the power tools
// (bulk actions, duplicate, quick edit). The APIs enforce the same
// permissions server-side regardless of what renders here; cost price
// is never shown in the list (field-level products.edit_cost_price is
// gated in the products API itself).
export const dynamic = "force-dynamic";

async function viewerPermissions(): Promise<string[]> {
  try {
    const token = cookies().get("admin_session")?.value;
    if (!token) return [];
    const session = await validateSessionToken(token);
    return session ? session.user.permissions : [];
  } catch {
    return [];
  }
}

export default async function AdminProductsPage() {
  const permissions = await viewerPermissions();
  const canDelete = hasPermission(permissions, "products.delete");
  const canEdit = hasPermission(permissions, "products.edit");
  const canCreate = hasPermission(permissions, "products.create");
  const canExport = hasPermission(permissions, "products.view");
  return (
    <main className="min-w-0">
      <PageHeader
        title="পণ্য"
        description="আসল ক্যাটালগ ডাটাবেস থেকে — সব স্ট্যাটাস (খসড়া ও আর্কাইভসহ) এখানে দেখা যায়, পৃষ্ঠা অনুযায়ী লোড হয়।"
        actions={
          <>
            {canExport ? <ProductsExportButton status="ALL" /> : null}
            <Link
              href="/admin/products/import"
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-border bg-card px-4 text-sm font-semibold shadow-sm transition motion-fast hover:bg-brand-50"
            >
              ইমপোর্ট
            </Link>
            <Link
              href="/admin/products/new"
              className="brand-gradient inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-4 w-4">
                <path d="M12 5v14M5 12h14" />
              </svg>
              নতুন পণ্য
            </Link>
          </>
        }
      />

      <ProductsTable canDelete={canDelete} canEdit={canEdit} canCreate={canCreate} />
      <p className="mt-4 text-caption leading-relaxed text-text-subtle">
        ডেটা আসল ক্যাটালগ ডাটাবেস থেকে সার্ভার-পেজিনেশনে আসে (প্রতি পৃষ্ঠায় ২৫টি)। তালিকা থেকে পণ্য
        এডিট, কপি ও মুছে ফেলা যায়; দাম/স্টক/স্ট্যাটাস দ্রুত বদলানো যায়; একাধিক পণ্য বেছে বাল্ক
        স্ট্যাটাস, দাম সমন্বয় (কারণসহ) ও মুছে ফেলার কাজ করা যায় — প্রতিটি কাজ অডিট লগে নথিভুক্ত হয়।
        এই পেজ থেকেই CSV export নেওয়া যায় (কারণসহ), আর "ইমপোর্ট" থেকে CSV ফাইল দিয়ে বাল্ক পণ্য
        তোলা যায়।
      </p>
    </main>
  );
}

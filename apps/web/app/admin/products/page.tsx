import Link from "next/link";
import { cookies } from "next/headers";
import { listAllProducts } from "@/catalog/server-read";
import { minVariantPricePoisha } from "@/catalog/types";
import { validateSessionToken } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { ProductsTable, type ProductRow } from "./products-table";
import { ProductsExportButton } from "./export-button";

// Admin product list — staff view, so cost is NOT shown here by default either:
// cost visibility is a field-level permission (Step 4 RBAC) and is gated
// server-side in the products API. This page shows price + stock only.
// Data: real catalog DB via src/catalog/server-read — ALL statuses
// (admins legitimately see DRAFT/ARCHIVED here; the public read path
// stays ACTIVE-only). An empty DB renders the honest empty state.
//
// Presentation: PageHeader + the interactive ProductsTable (client):
// search / status filter / sort + table-v2 saved views and column
// visibility. This server page maps catalog products to plain
// serializable rows (title, slug, min price, total stock, status) —
// no function props cross the server/client boundary.
export const dynamic = "force-dynamic";

/** The delete action renders only for viewers holding products.delete;
 *  the API enforces the same permission regardless. */
async function viewerCanDeleteProducts(): Promise<boolean> {
  try {
    const token = cookies().get("admin_session")?.value;
    if (!token) return false;
    const session = await validateSessionToken(token);
    return session ? hasPermission(session.user.permissions, "products.delete") : false;
  } catch {
    return false;
  }
}

/** The export button renders only for viewers holding products.view —
 *  the same permission the export API enforces (it mirrors the list). */
async function viewerCanExportProducts(): Promise<boolean> {
  try {
    const token = cookies().get("admin_session")?.value;
    if (!token) return false;
    const session = await validateSessionToken(token);
    return session ? hasPermission(session.user.permissions, "products.view") : false;
  } catch {
    return false;
  }
}

export default async function AdminProductsPage() {
  const products = await listAllProducts();
  const canDelete = await viewerCanDeleteProducts();
  const canExport = await viewerCanExportProducts();
  const rows: ProductRow[] = products.map((p) => ({
    id: p.id,
    title: p.title.bn,
    slug: p.slug,
    pricePoisha: minVariantPricePoisha(p),
    stock: p.variants.reduce((s, v) => s + v.stock, 0),
    status: p.status,
  }));
  return (
    <main className="min-w-0">
      <PageHeader
        title="পণ্য"
        description="আসল ক্যাটালগ ডাটাবেস থেকে — সব স্ট্যাটাস (খসড়া ও আর্কাইভসহ) এখানে দেখা যায়।"
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
        <ProductsTable products={rows} canDelete={canDelete} />
      )}
      <p className="mt-4 text-caption leading-relaxed text-text-subtle">
        ডেটা আসল ক্যাটালগ ডাটাবেস থেকে আসে। তালিকা থেকে প্রতিটি পণ্য edit করা যায়, এই পেজ থেকেই CSV export নেওয়া যায় (কারণসহ — অডিট লগে নথিভুক্ত হয়), আর "ইমপোর্ট" থেকে CSV ফাইল দিয়ে বাল্ক পণ্য তোলা যায়।
      </p>
    </main>
  );
}

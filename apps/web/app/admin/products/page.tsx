import Link from "next/link";
import { cookies } from "next/headers";
import { validateSessionToken } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { ProductsTable } from "./products-table";
import { ProductsExportButton } from "./export-button";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { PRODUCTS_STRINGS } from "./strings";

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
  const locale = await getRequestLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
  const permissions = await viewerPermissions();
  const canDelete = hasPermission(permissions, "products.delete");
  const canEdit = hasPermission(permissions, "products.edit");
  const canCreate = hasPermission(permissions, "products.create");
  const canExport = hasPermission(permissions, "products.view");
  return (
    <main className="min-w-0">
      <PageHeader
        eyebrow={s.listEyebrow}
        title={s.listTitle}
        description={s.listDesc}
        actions={
          <>
            {canExport ? <ProductsExportButton status="ALL" /> : null}
            <Link
              href="/admin/products/import"
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border border-border bg-card px-4 text-sm font-semibold shadow-sm transition motion-fast hover:border-brand-300 hover:bg-brand-50"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <path d="M12 3v11" />
                <path d="m8 10 4 4 4-4" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
              {s.listImport}
            </Link>
            <Link
              href="/admin/products/new"
              className="brand-gradient inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-4 w-4">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {s.listNew}
            </Link>
          </>
        }
      />

      <ProductsTable canDelete={canDelete} canEdit={canEdit} canCreate={canCreate} />
      <p className="mt-4 rounded-lg border border-border/70 bg-surface-2/60 px-4 py-3 text-caption leading-relaxed text-text-subtle">
        {s.listFooter}
      </p>
    </main>
  );
}

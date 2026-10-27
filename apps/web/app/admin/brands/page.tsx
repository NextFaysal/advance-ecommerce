import { PageHeader } from "@/components/ui/page-header";
import { listBrandsAdmin } from "@/catalog/taxonomy-admin";
import { BrandsManager } from "./brands-manager";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { BRANDS_STRINGS } from "./strings";

// Brands admin (Wave P2a) — brands previously existed only as
// find-or-create rows inside product create; this is their first
// management surface. Server loads the real list (Prisma via
// src/catalog/taxonomy-admin.ts); mutations go through
// /api/v1/admin/brands. A failed read renders an error card.
export const dynamic = "force-dynamic";

export default async function AdminBrandsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, BRANDS_STRINGS);
  let brands: Awaited<ReturnType<typeof listBrandsAdmin>> | null = null;
  try {
    brands = await listBrandsAdmin();
  } catch {
    brands = null;
  }

  return (
    <main>
      <PageHeader
        title={s.pageTitle}
        description={s.pageDescription}
        breadcrumb={s.pageBreadcrumb}
      />
      {brands === null ? (
        <div role="alert" className="flex gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3.5 shadow-card">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
          </span>
          <p className="text-small leading-relaxed text-rose-700">
            {s.dbError}
          </p>
        </div>
      ) : (
        <BrandsManager initial={brands} />
      )}
    </main>
  );
}

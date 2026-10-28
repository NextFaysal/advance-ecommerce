import { PageHeader } from "@/admin-shell/PageHeader";
import { listCategoriesAdmin } from "@/catalog/taxonomy-admin";
import { CategoriesManager } from "./categories-manager";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";
import { CATEGORIES_STRINGS } from "./strings";

// Categories admin (Wave P2a) — the first management surface for
// categories at all: before this they existed only via seed. Server
// loads the real list (Prisma via src/catalog/taxonomy-admin.ts);
// create/edit/toggle/delete go through /api/v1/admin/categories.
// A failed read renders an error card, never invented rows.
export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, CATEGORIES_STRINGS);
  const common = pick(locale, ADMIN_STRINGS);
  let categories: Awaited<ReturnType<typeof listCategoriesAdmin>> | null = null;
  try {
    categories = await listCategoriesAdmin();
  } catch {
    categories = null;
  }

  return (
    <main className="space-y-6">
      <PageHeader
        title={s.pageTitle}
        subtitle={s.pageDescription}
        breadcrumbs={s.pageBreadcrumb.split(" / ").map((label) => ({ label }))}
        breadcrumbLabel={common.breadcrumb}
      />
      {categories === null ? (
        <div role="alert" className="flex gap-3 rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3.5 shadow-xs">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
          </span>
          <p className="text-small leading-relaxed text-text-main">
            {s.dbError}
          </p>
        </div>
      ) : (
        <CategoriesManager initial={categories} />
      )}
    </main>
  );
}

// Admin product EDIT page — server wrapper around the shared
// ProductEditor (client). The product is loaded server-side through
// getProductForAdminEdit (src/catalog/server-read): the full ADMIN
// shape, variants with costPoisha included, because the form must
// pre-fill cost. Saving goes through PATCH /api/v1/admin/products/[id]
// — variants upsert by SKU, dropped variants soft-delete, stock
// deltas hit the ledger, and a price change requires `reason`
// (the editor detects and collects it). A missing/soft-deleted
// product renders an honest not-found state, never mock data.
import Link from "next/link";
import { getProductForAdminEdit, listBrandNames, listCategories } from "@/catalog/server-read";
import { listAttributeSetsAdmin, type AdminAttributeSet } from "@/catalog/attributes-admin";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { PageHeader } from "@/admin-shell/PageHeader";
import { ADMIN_STRINGS } from "@/admin/strings";
import { ProductEditor, type AttributeSetOption, type CategoryOption } from "../product-editor";
import { RelatedPicker, type RelatedPick } from "./related-picker";
import { CustomFieldsPanel } from "@/components/admin/custom-fields-panel";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { PRODUCTS_STRINGS } from "../strings";

export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { created?: string; ledger?: string };
}) {
  const locale = await getRequestLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
  const product = await getProductForAdminEdit(params.id);
  if (!product) {
    return (
      <main className="min-w-0">
        <PageHeader
          title={s.notFoundTitle}
          subtitle={s.notFoundDesc}
          breadcrumbs={s.notFoundBreadcrumb.split(" / ").map((label) => ({ label }))}
          breadcrumbLabel={pick(locale, ADMIN_STRINGS).breadcrumb}
        />
        <div className="anim-rise flex flex-col items-center rounded-2xl border border-dashed border-border bg-card px-6 py-10 text-center shadow-xs">
          <span aria-hidden="true" className="brand-soft-gradient flex h-[72px] w-[72px] items-center justify-center rounded-full text-brand-600 shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-9 w-9">
              <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5" />
              <path d="M12 22V12" />
            </svg>
          </span>
          <Link
            href="/admin/products"
            className="bg-brand-600 mt-5 inline-flex min-h-[44px] items-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition duration-fast ease-smooth hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            {s.backToList}
          </Link>
        </div>
      </main>
    );
  }

  const [categories, brandNames, attributeSetsRaw] = await Promise.all([
    listCategories(),
    listBrandNames(),
    // Attribute-set library (Wave 16-1): the variant editor's
    // key/value datalist source — degrade to no suggestions on failure.
    listAttributeSetsAdmin().catch((): AdminAttributeSet[] => []),
  ]);
  const attributeSets: AttributeSetOption[] = attributeSetsRaw.map((s) => ({
    key: s.key,
    labelBn: s.labelBn,
    labelEn: s.labelEn,
    values: s.values,
  }));
  const categoryOptions: CategoryOption[] = categories.map((c) => ({
    slug: c.slug,
    nameBn: c.name.bn,
    nameEn: c.name.en,
  }));
  // Related picks (Wave 14-2): resolve the stored relatedIds to
  // summaries for the picker below the editor. A pick whose product
  // was deleted stays visible (missing) so staff can remove it.
  const relatedPicks: RelatedPick[] = [];
  for (const rid of product.relatedIds ?? []) {
    const rel = await getProductForAdminEdit(rid);
    relatedPicks.push(
      rel
        ? { id: rel.id, titleBn: rel.title.bn, titleEn: rel.title.en, slug: rel.slug, status: rel.status }
        : { id: rid, titleBn: "", titleEn: "", slug: rid, status: "", missing: true },
    );
  }
  const justCreated = searchParams?.created === "1";
  const ledgerPending = searchParams?.ledger === "pending";

  return (
    <main className="min-w-0">
      <PageHeader
        title={s.editTitle}
        subtitle={interpolate(s.editDesc, { title: product.title.bn })}
        breadcrumbs={interpolate(s.editBreadcrumb, { title: product.title.bn })
          .split(" / ")
          .map((label) => ({ label }))}
        breadcrumbLabel={pick(locale, ADMIN_STRINGS).breadcrumb}
      />
      {justCreated && (
        <p role="status" className="anim-fade-in mb-4 rounded-2xl border border-success-solid/25 bg-success-soft px-4 py-3 text-sm font-medium text-success-solid shadow-xs">
          {s.createdBanner}
          {ledgerPending && s.ledgerPendingSuffix}
        </p>
      )}
      <ProductEditor
        mode="edit"
        productId={product.id}
        categories={categoryOptions}
        brandNames={brandNames}
        attributeSets={attributeSets}
        initial={product}
        productTypesEnabled={isFeatureEnabled("module.product_types")}
      />
      <RelatedPicker productId={product.id} initialPicks={relatedPicks} />
      {/* Merchant custom fields (ADV-26, wave 53) — self-fetching;
          renders nothing until product fields are defined in
          /admin/webhooks, so the editor is unchanged by default. */}
      <div className="mt-5">
        <CustomFieldsPanel entity="product" entityId={product.id} />
      </div>
    </main>
  );
}

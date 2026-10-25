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
import { PageHeader } from "@/components/ui/page-header";
import { ProductEditor, type AttributeSetOption, type CategoryOption } from "../product-editor";
import { RelatedPicker, type RelatedPick } from "./related-picker";

export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { created?: string; ledger?: string };
}) {
  const product = await getProductForAdminEdit(params.id);
  if (!product) {
    return (
      <main className="min-w-0">
        <PageHeader
          title="পণ্য পাওয়া যায়নি"
          description="এই আইডির কোনো পণ্য ক্যাটালগে নেই — হয়তো মুছে ফেলা হয়েছে, অথবা লিংকটি ভুল।"
          breadcrumb="পণ্য / এডিট"
        />
        <Link
          href="/admin/products"
          className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-semibold shadow-sm transition motion-fast hover:border-brand-300"
        >
          ← পণ্যের তালিকায় ফিরুন
        </Link>
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
        title="পণ্য এডিট করুন"
        description={`${product.title.bn} — সব পরিবর্তন PATCH API দিয়ে সেভ হয়; দাম বদলালে কারণ লিখতে হবে (অডিটে থাকবে)।`}
        breadcrumb={`পণ্য / ${product.title.bn}`}
      />
      {justCreated && (
        <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          ✅ পণ্য তৈরি হয়েছে — এখন এখান থেকে ছবি, ভেরিয়েন্টের দাম/স্টক ঠিক করে প্রকাশ করতে পারবেন।
          {ledgerPending && " তবে প্রাথমিক স্টকের ledger এন্ট্রি এখনো pending আছে (ডিফল্ট গুদাম পাওয়া যায়নি)।"}
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
    </main>
  );
}

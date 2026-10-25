// Admin product CREATE page — server wrapper around the shared
// ProductEditor (client). The server loads the live category list and
// existing brand names from the real catalog DB (src/catalog/server-read)
// and hands the client component plain serializable props only.
// Saving goes through POST /api/v1/admin/products (Zod-validated,
// audit-logged, initial stock booked in the stock_movements ledger);
// on success the editor redirects to the new product's edit page.
import { listBrandNames, listCategories } from "@/catalog/server-read";
import { listAttributeSetsAdmin, type AdminAttributeSet } from "@/catalog/attributes-admin";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { PageHeader } from "@/components/ui/page-header";
import { ProductEditor, type AttributeSetOption, type CategoryOption } from "../product-editor";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const [categories, brandNames, attributeSetsRaw] = await Promise.all([
    listCategories(),
    listBrandNames(),
    // Attribute-set library (Wave 16-1): feeds the variant editor's
    // key/value datalists. A library outage must never block product
    // creation — degrade to no suggestions.
    listAttributeSetsAdmin().catch((): AdminAttributeSet[] => []),
  ]);
  const attributeSets: AttributeSetOption[] = attributeSetsRaw.map((s) => ({
    key: s.key,
    labelBn: s.labelBn,
    labelEn: s.labelEn,
    values: s.values,
  }));
  // Product types (wave 15, doc 16 §P7): the editor shows the type
  // selector + per-type panels only when the module flag is on.
  const productTypesEnabled = isFeatureEnabled("module.product_types");
  const categoryOptions: CategoryOption[] = categories.map((c) => ({
    slug: c.slug,
    nameBn: c.name.bn,
    nameEn: c.name.en,
  }));
  return (
    <main className="min-w-0">
      <PageHeader
        title="নতুন পণ্য"
        description="সব তথ্য দিয়ে সেভ করুন — স্ট্যাটাস খসড়া (DRAFT) রাখলে স্টোরে দেখা যাবে না, প্রকাশ (ACTIVE) করলেই লাইভ হবে। সেভ হলে পণ্যটির এডিট পেজে নিয়ে যাওয়া হবে।"
        breadcrumb="পণ্য / নতুন পণ্য"
      />
      <ProductEditor
        mode="create"
        categories={categoryOptions}
        brandNames={brandNames}
        attributeSets={attributeSets}
        initial={null}
        productTypesEnabled={productTypesEnabled}
      />
    </main>
  );
}

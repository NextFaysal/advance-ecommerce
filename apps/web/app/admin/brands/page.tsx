import { PageHeader } from "@/components/ui/page-header";
import { listBrandsAdmin } from "@/catalog/taxonomy-admin";
import { BrandsManager } from "./brands-manager";

// Brands admin (Wave P2a) — brands previously existed only as
// find-or-create rows inside product create; this is their first
// management surface. Server loads the real list (Prisma via
// src/catalog/taxonomy-admin.ts); mutations go through
// /api/v1/admin/brands. A failed read renders an error card.
export const dynamic = "force-dynamic";

export default async function AdminBrandsPage() {
  let brands: Awaited<ReturnType<typeof listBrandsAdmin>> | null = null;
  try {
    brands = await listBrandsAdmin();
  } catch {
    brands = null;
  }

  return (
    <main>
      <PageHeader
        title="ব্র্যান্ড"
        description="ব্র্যান্ড পরিচালনা — তৈরি, এডিট, লোগো ও মোছা। কোনো ব্র্যান্ডে পণ্য থাকলে তা মোছা যায় না। (Brands — products.view / products.create / products.edit / products.delete)"
        breadcrumb="Admin / Catalog"
      />
      {brands === null ? (
        <p role="alert" className="rounded-md bg-rose-50 px-3.5 py-2.5 text-small leading-relaxed text-rose-700">
          ডাটাবেস থেকে ব্র্যান্ড পড়া যায়নি — কোনো তালিকা দেখানো হচ্ছে না। (Could not
          read brands from the database.)
        </p>
      ) : (
        <BrandsManager initial={brands} />
      )}
    </main>
  );
}

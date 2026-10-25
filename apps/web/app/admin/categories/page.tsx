import { PageHeader } from "@/components/ui/page-header";
import { listCategoriesAdmin } from "@/catalog/taxonomy-admin";
import { CategoriesManager } from "./categories-manager";

// Categories admin (Wave P2a) — the first management surface for
// categories at all: before this they existed only via seed. Server
// loads the real list (Prisma via src/catalog/taxonomy-admin.ts);
// create/edit/toggle/delete go through /api/v1/admin/categories.
// A failed read renders an error card, never invented rows.
export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  let categories: Awaited<ReturnType<typeof listCategoriesAdmin>> | null = null;
  try {
    categories = await listCategoriesAdmin();
  } catch {
    categories = null;
  }

  return (
    <main>
      <PageHeader
        title="ক্যাটাগরি"
        description="পণ্যের ক্যাটাগরি ও সাব-ক্যাটাগরি পরিচালনা — তৈরি, এডিট, ক্রম, চালু/বন্ধ ও মোছা। পণ্য থাকা ক্যাটাগরি মোছা যায় না; প্রয়োজনে শুধু বন্ধ করে রাখা যায়। (Categories — products.view / products.create / products.edit / products.delete)"
        breadcrumb="Admin / Catalog"
      />
      {categories === null ? (
        <p role="alert" className="rounded-md bg-rose-50 px-3.5 py-2.5 text-small leading-relaxed text-rose-700">
          ডাটাবেস থেকে ক্যাটাগরি পড়া যায়নি — কোনো তালিকা দেখানো হচ্ছে না। (Could not
          read categories from the database.)
        </p>
      ) : (
        <CategoriesManager initial={categories} />
      )}
    </main>
  );
}

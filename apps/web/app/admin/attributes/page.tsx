import { PageHeader } from "@/components/ui/page-header";
import { listAttributeSetsAdmin } from "@/catalog/attributes-admin";
import { AttributesManager } from "./attributes-manager";

// Attribute sets admin (Wave 13-2) — the first management surface for
// the ProductAttribute library, which was orphaned (schema-only)
// until now. Server loads the real list (Prisma via
// src/catalog/attributes-admin.ts); create/edit/delete go through
// /api/v1/admin/attributes. This manages the set LIBRARY only —
// wiring sets into the product editor is a later wave, and the page
// says so. A failed read renders an error card, never invented rows.
export const dynamic = "force-dynamic";

export default async function AdminAttributesPage() {
  let sets: Awaited<ReturnType<typeof listAttributeSetsAdmin>> | null = null;
  try {
    sets = await listAttributeSetsAdmin();
  } catch {
    sets = null;
  }

  return (
    <main>
      <PageHeader
        title="অ্যাট্রিবিউট"
        description="পুনঃব্যবহারযোগ্য অ্যাট্রিবিউট সেট — যেমন Size, Color, Material — তৈরি, এডিট ও মোছা। (Attribute sets — products.view / products.create / products.edit / products.delete)"
        breadcrumb="Admin / Catalog"
      />
      {sets === null ? (
        <p role="alert" className="rounded-md bg-rose-50 px-3.5 py-2.5 text-small leading-relaxed text-rose-700">
          ডাটাবেস থেকে অ্যাট্রিবিউট সেট পড়া যায়নি — কোনো তালিকা দেখানো হচ্ছে না। (Could not
          read attribute sets from the database.)
        </p>
      ) : (
        <AttributesManager initial={sets} />
      )}
    </main>
  );
}

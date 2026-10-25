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
        <div role="alert" className="flex gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3.5 shadow-card">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
          </span>
          <p className="text-small leading-relaxed text-rose-700">
            ডাটাবেস থেকে অ্যাট্রিবিউট সেট পড়া যায়নি — কোনো তালিকা দেখানো হচ্ছে না। (Could not
            read attribute sets from the database.)
          </p>
        </div>
      ) : (
        <AttributesManager initial={sets} />
      )}
    </main>
  );
}

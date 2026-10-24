import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { listAllProducts } from "@/catalog/server-read";
import { minVariantPricePoisha } from "@/catalog/types";

// Admin product list — staff view, so cost is NOT shown here by default either:
// cost visibility is a field-level permission (Step 4 RBAC) and is gated
// server-side in the products API. This page shows price + stock only.
// Data: real catalog DB via src/catalog/server-read — ALL statuses
// (admins legitimately see DRAFT/ARCHIVED here; the public read path
// stays ACTIVE-only). An empty DB renders the honest empty row.
export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const products = await listAllProducts();
  return (
    <main className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">পণ্য (Products)</h1>
        <Link href="/admin/products/new" className="rounded-lg bg-[#4F46E5] px-4 py-2 text-sm font-semibold text-white">
          + নতুন পণ্য
        </Link>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="bg-[#F8F9FD]">
              <th className="px-3 py-2">পণ্য</th>
              <th className="px-3 py-2">দাম (থেকে)</th>
              <th className="px-3 py-2">স্টক</th>
              <th className="px-3 py-2">স্ট্যাটাস</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr className="border-t">
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  কোনো পণ্য নেই — নতুন পণ্য যোগ করুন।
                </td>
              </tr>
            ) : (
              products.map((p) => {
                const stock = p.variants.reduce((s, v) => s + v.stock, 0);
                return (
                  <tr key={p.id} className="border-t">
                    <td className="min-w-0 px-3 py-2">
                      <span className="block break-words [overflow-wrap:anywhere]">{p.title.bn}</span>
                      <span className="text-xs text-slate-500">/{p.slug}</span>
                    </td>
                    <td className="px-3 py-2">{formatBdt(minVariantPricePoisha(p))}</td>
                    <td className="px-3 py-2">{stock}</td>
                    <td className="px-3 py-2">{p.status}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        ডেটা আসল ক্যাটালগ ডাটাবেস থেকে আসে। Bulk import/export ও inline price/stock edit API রুটে আছে।
      </p>
    </main>
  );
}

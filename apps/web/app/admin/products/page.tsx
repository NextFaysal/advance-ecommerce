import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { MOCK_PRODUCTS } from "@/catalog/mock";
import { minVariantPricePoisha } from "@/catalog/types";

// Admin product list — staff view, so cost is NOT shown here by default either:
// cost visibility is a field-level permission (Step 4 RBAC) and must be gated
// server-side in Step 8. This skeleton shows price + stock only.
export default function AdminProductsPage() {
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
            {MOCK_PRODUCTS.map((p) => {
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
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        TEMPORARY MOCK — Step 8-এ Prisma + RBAC আসবে। Bulk import/export (Step 10) ও inline price/stock edit (Step 9) এখানে যুক্ত হবে।
      </p>
    </main>
  );
}

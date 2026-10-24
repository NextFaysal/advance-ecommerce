import { formatBdt } from "@advance-ecommerce/validators";
import { InMemoryInventoryStore, lowStockList, valuationPoisha } from "@/inventory/service";
import {
  LOW_STOCK_THRESHOLD,
  getVariantCostMapDb,
  listInventoryItemsDb,
} from "@/inventory/repository";

// Admin inventory — reads the stock_movements ledger state from the DB
// (InventoryItem rows, src/inventory/repository.ts). Direct quantity
// edits are forbidden; stock changes only via movements (API below).
export const dynamic = "force-dynamic";

export default async function AdminInventoryPage() {
  const items = await listInventoryItemsDb();
  const costMap = await getVariantCostMapDb(items.map((i) => i.variantId));
  const costedItems = items.filter((i) => costMap.has(i.variantId));
  const adapter = new InMemoryInventoryStore(items);
  const low = lowStockList(adapter, LOW_STOCK_THRESHOLD);
  const valuation = valuationPoisha(costedItems, Object.fromEntries(costMap));
  const missingCost = items.length - costedItems.length;
  return (
    <main className="min-w-0">
      <h1 className="text-xl font-bold">ইনভেন্টরি (Inventory)</h1>
      <p className="mt-2 text-sm">মোট মূল্য (cost): {formatBdt(valuation)} — low stock threshold: {LOW_STOCK_THRESHOLD}{missingCost > 0 ? ` — ${missingCost}টি আইটেমের cost নেই, মূল্যায়নে ধরা হয়নি` : ""}</p>
      <div className="mt-4 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead><tr className="bg-[#F8F9FD]"><th className="px-3 py-2">Variant</th><th className="px-3 py-2">Warehouse</th><th className="px-3 py-2">On hand</th><th className="px-3 py-2">Reserved</th><th className="px-3 py-2">Available</th><th className="px-3 py-2">Status</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={`${i.variantId}-${i.warehouseId}`} className="border-t">
                <td className="px-3 py-2">{i.variantId}</td><td className="px-3 py-2">{i.warehouseId}</td>
                <td className="px-3 py-2">{i.quantityOnHand}</td><td className="px-3 py-2">{i.quantityReserved}</td><td className="px-3 py-2">{i.quantityAvailable}</td>
                <td className="px-3 py-2">{i.quantityAvailable <= LOW_STOCK_THRESHOLD ? "Low stock" : "OK"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="mt-6 font-semibold">Low stock alert ({low.length})</h2>
      <ul className="mt-2 list-disc pl-5 text-sm">{low.map((r) => <li key={r.variantId}>{r.variantId} — available {r.quantityAvailable}</li>)}</ul>
      <p className="mt-4 text-xs text-slate-500">ডাটাবেস থেকে — API: GET/POST /api/v1/admin/inventory, POST /api/v1/admin/inventory/purchase-orders (RBAC + ledger, Prisma)। Adjustment requires a reason; stock changes only via movements.</p>
    </main>
  );
}

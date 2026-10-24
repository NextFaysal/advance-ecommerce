import { formatBdt } from "@advance-ecommerce/validators";
import { lowStockList, valuationPoisha, InMemoryInventoryStore } from "@/inventory/service";
import { DEMO_COST_POISHA, DEMO_INVENTORY, DEMO_LOW_STOCK_THRESHOLD } from "@/reports/demo";

// Admin inventory — Agent 10, Step 23. TEMPORARY DEMO data (in-memory store).
// Real page must be server-side RBAC gated (inventory.view) and read the
// stock_movements ledger via Prisma; direct quantity edits are forbidden.
export default function AdminInventoryPage() {
  const store = new InMemoryInventoryStore(DEMO_INVENTORY);
  const items = store.listItems();
  const low = lowStockList(store, DEMO_LOW_STOCK_THRESHOLD);
  return (
    <main className="min-w-0">
      <h1 className="text-xl font-bold">ইনভেন্টরি (Inventory)</h1>
      <p className="mt-2 text-sm">মোট মূল্য (cost): {formatBdt(valuationPoisha(items, DEMO_COST_POISHA))} — low stock threshold: {DEMO_LOW_STOCK_THRESHOLD}</p>
      <div className="mt-4 overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead><tr className="bg-[#F8F9FD]"><th className="px-3 py-2">Variant</th><th className="px-3 py-2">Warehouse</th><th className="px-3 py-2">On hand</th><th className="px-3 py-2">Reserved</th><th className="px-3 py-2">Available</th><th className="px-3 py-2">Status</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={`${i.variantId}-${i.warehouseId}`} className="border-t">
                <td className="px-3 py-2">{i.variantId}</td><td className="px-3 py-2">{i.warehouseId}</td>
                <td className="px-3 py-2">{i.quantityOnHand}</td><td className="px-3 py-2">{i.quantityReserved}</td><td className="px-3 py-2">{i.quantityAvailable}</td>
                <td className="px-3 py-2">{i.quantityAvailable <= DEMO_LOW_STOCK_THRESHOLD ? "Low stock" : "OK"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="mt-6 font-semibold">Low stock alert ({low.length})</h2>
      <ul className="mt-2 list-disc pl-5 text-sm">{low.map((r) => <li key={r.variantId}>{r.variantId} — available {r.quantityAvailable}</li>)}</ul>
      <p className="mt-4 text-xs text-slate-500">TEMPORARY DEMO — API: GET/POST /api/v1/admin/inventory, POST /api/v1/admin/inventory/purchase-orders (RBAC + ledger, in-memory until Prisma). Adjustment requires a reason; stock changes only via movements.</p>
    </main>
  );
}

// Split-order allocation — Agent 16, Step 48 (A9). Pure: no DB, no mutation of inputs.
// Greedy allocation in warehouse-priority order. A line is split across
// warehouses only when a single warehouse cannot cover it — each split piece
// becomes a line in that warehouse's shipment. Anything left over is returned
// as `unallocated` (a backorder candidate), never silently dropped.
import type { OrderItem } from "../orders/types";
import type {
  AllocationResult, ShipmentAllocationLine, SplitShipment, WarehouseStock,
} from "./types";

export function allocateOrderItems(
  items: readonly OrderItem[],
  warehouses: readonly WarehouseStock[],
): AllocationResult {
  const sorted = [...warehouses].sort((a, b) => a.priority - b.priority);
  const remaining = new Map<string, number>();
  for (const wh of sorted) {
    for (const [variantId, qty] of Object.entries(wh.availableByVariant)) {
      remaining.set(`${wh.warehouseId}:${variantId}`, qty);
    }
  }
  const byWarehouse = new Map<string, SplitShipment>();
  const unallocated: ShipmentAllocationLine[] = [];

  const pushLine = (wh: WarehouseStock, line: ShipmentAllocationLine): void => {
    const existing = byWarehouse.get(wh.warehouseId);
    if (existing) {
      existing.lines.push(line);
      existing.subtotalPoisha += line.quantity * line.unitPricePoisha;
    } else {
      byWarehouse.set(wh.warehouseId, {
        shipmentKey: `SHP-${wh.warehouseId}`,
        warehouseId: wh.warehouseId,
        warehouseName: wh.warehouseName,
        lines: [line],
        subtotalPoisha: line.quantity * line.unitPricePoisha,
      });
    }
  };

  for (const item of items) {
    let need = item.quantity;
    for (const wh of sorted) {
      if (need <= 0) break;
      const key = `${wh.warehouseId}:${item.variantId}`;
      const avail = remaining.get(key) ?? 0;
      if (avail <= 0) continue;
      const take = Math.min(avail, need);
      remaining.set(key, avail - take);
      need -= take;
      pushLine(wh, {
        variantId: item.variantId, sku: item.sku, productName: item.productName,
        quantity: take, unitPricePoisha: item.unitPricePoisha,
      });
    }
    if (need > 0) {
      unallocated.push({
        variantId: item.variantId, sku: item.sku, productName: item.productName,
        quantity: need, unitPricePoisha: item.unitPricePoisha,
      });
    }
  }
  const shipments = [...byWarehouse.values()];
  shipments.forEach((s, i) => { s.shipmentKey = `SHP-${i + 1}-${s.warehouseId}`; });
  return { shipments, unallocated, fullyAllocated: unallocated.length === 0 };
}

// COD settlement report — types + sandbox computation. Agent 9, Step 22.
// Row meaning: for a DELIVERED shipment, the courier collected
// collectedPoisha in cash from the customer and owes the merchant
// payablePoisha = collectedPoisha - courierChargePoisha.
// All amounts are integer poisha. Persistence: DB-backed since
// 2026-10-24 — the report aggregates the persisted Shipment rows and
// uses each row's stored chargePoisha (the real courierChargePoisha()
// output captured at booking). Rows booked before charges were stored
// (chargePoisha 0) fall back to the district-base computation, the same
// convention the old in-memory report used. A row whose collected amount
// disagrees with the courier invoice is "disputed", never silently
// adjusted (see bd/courier-reconciliation.ts).
import type { CodSettlementRow, CourierProviderName } from "../courier";
import { courierChargePoisha } from "./courier-provider";
import { findShipmentCharge, listShipments } from "./db-store";

export type { CodSettlementRow };

export interface CodSettlementReport {
  provider: CourierProviderName | "all";
  rows: CodSettlementRow[];
  totals: {
    collectedPoisha: number;
    courierChargePoisha: number;
    payablePoisha: number;
  };
  generatedAt: string;
  /** Always true for this implementation — data is simulated. */
  sandbox: true;
}

export async function buildCodSettlementReport(provider: string = "all"): Promise<CodSettlementReport> {
  const rows: CodSettlementRow[] = [];
  const shipments = await listShipments(provider === "all" ? undefined : provider);
  for (const shipment of shipments) {
    if (shipment.status !== "DELIVERED") continue;
    const stored = await findShipmentCharge(shipment.shipmentId);
    const charge = stored > 0 ? stored : courierChargePoisha("district", shipment.weightGrams);
    rows.push({
      shipmentId: shipment.shipmentId,
      orderId: shipment.orderId,
      provider: shipment.provider as CourierProviderName,
      collectedPoisha: shipment.codAmountPoisha,
      courierChargePoisha: charge,
      payablePoisha: shipment.codAmountPoisha - charge,
      status: "pending",
    });
  }
  const totals = rows.reduce(
    (acc, row) => ({
      collectedPoisha: acc.collectedPoisha + row.collectedPoisha,
      courierChargePoisha: acc.courierChargePoisha + row.courierChargePoisha,
      payablePoisha: acc.payablePoisha + row.payablePoisha,
    }),
    { collectedPoisha: 0, courierChargePoisha: 0, payablePoisha: 0 },
  );
  return {
    provider: provider as CodSettlementReport["provider"],
    rows,
    totals,
    generatedAt: new Date().toISOString(),
    sandbox: true,
  };
}

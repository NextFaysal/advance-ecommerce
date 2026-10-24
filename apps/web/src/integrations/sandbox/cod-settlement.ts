// COD settlement report — types + sandbox computation. Agent 9, Step 22.
// Row meaning: for a DELIVERED shipment, the courier collected
// collectedPoisha in cash from the customer and owes the merchant
// payablePoisha = collectedPoisha - courierChargePoisha.
// All amounts are integer poisha. The sandbox computation below reads the
// in-memory sandbox shipments only; the real report must aggregate the
// shipments / courier_accounts DB tables and the courier's own invoice,
// and a row whose collected amount disagrees with the courier invoice is
// "disputed", never silently adjusted.
import type { CodSettlementRow, CourierProviderName } from "../courier";
import { courierChargePoisha } from "./courier-provider";
import { sandboxStore } from "./store";

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

export function buildCodSettlementReport(provider: string = "all"): CodSettlementReport {
  const rows: CodSettlementRow[] = [];
  for (const shipment of sandboxStore.shipments.values()) {
    if (provider !== "all" && shipment.provider !== provider) continue;
    if (shipment.status !== "DELIVERED") continue;
    // Sandbox shipments do not carry a zone; charge uses the district base.
    // The real report must use the shipment's stored zone + rate snapshot.
    const charge = courierChargePoisha("district", shipment.weightGrams);
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

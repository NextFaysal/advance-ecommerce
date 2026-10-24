import { PageHeader } from "@/components/ui/page-header";
import {
  SANDBOX_COURIER_PROVIDERS,
  courierChargePoisha,
  createSandboxCourierProvider,
} from "@/integrations/sandbox/courier-provider";
import type { SandboxCourierProvider } from "@/integrations/sandbox/courier-provider";
import {
  BOOKING_WEIGHT_PRESETS_GRAMS,
  demoBookableOrders,
  demoShipments,
  type BookingRateCard,
} from "./demo-data";
import { ShipmentsBoard } from "./shipments-board";

// Admin > Shipments — Agent 44 (gap found by Agent 34's audit: shipment
// APIs existed but there was no /admin/shipments page).
// TEMPORARY DEMO: the list is SAMPLE records in ./demo-data.ts, shaped
// exactly like the sandbox SandboxShipment records behind
//   POST /api/v1/admin/shipments          (book, shipments.book)
//   GET  /api/v1/admin/shipments/track    (track, shipments.view)
//   POST /api/v1/admin/shipments/cancel   (cancel, shipments.cancel)
// No courier is contacted and nothing is persisted. The booking panel's
// charges and ETAs are computed HERE (server) by calling the real
// sandbox functions — courierChargePoisha() for every weight the panel
// can pick, getRates() for the per-provider estimate — so the client
// board only displays the sandbox rule's own outputs. After the DB
// wiring, the page reads the shipments API and booking posts to it;
// COD settlement against courier invoices stays in Payments / BD Tools
// (reconciliation is not rebuilt here).

export default async function ShipmentsPage() {
  const rateCards: BookingRateCard[] = await Promise.all(
    demoBookableOrders.map(async (order) => {
      const weights = [...new Set([order.weightGrams, ...BOOKING_WEIGHT_PRESETS_GRAMS])].sort(
        (a, b) => a - b,
      );
      const chargeByWeightGrams: Record<string, number> = {};
      for (const w of weights) {
        chargeByWeightGrams[String(w)] = courierChargePoisha(order.zone, w);
      }
      const daysByProvider = {} as Record<SandboxCourierProvider, number | null>;
      for (const name of SANDBOX_COURIER_PROVIDERS) {
        const provider = createSandboxCourierProvider(name);
        const [rate] = await provider.getRates({
          zone: order.zone,
          district: order.address.district,
          weightGrams: order.weightGrams,
          orderValuePoisha: order.codAmountPoisha,
        });
        daysByProvider[name] = rate?.estimatedDays ?? null;
      }
      return { orderId: order.orderId, chargeByWeightGrams, daysByProvider };
    }),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="শিপমেন্ট"
        description="TEMPORARY DEMO — নমুনা ডেটা, sandbox শিপমেন্ট রেকর্ডের আকারে। কোনো কুরিয়ার কল হয় না, কিছুই সংরক্ষিত হয় না।"
      />
      <ShipmentsBoard
        initialShipments={demoShipments}
        bookableOrders={demoBookableOrders}
        rateCards={rateCards}
      />
    </div>
  );
}

// Sandbox CourierProvider — Steadfast, Pathao, RedX. Agent 9, Step 22.
// SIMULATED ONLY: no real courier API call, no real key, no real booking.
// Tracking ids are SBX-prefixed (see deterministic.ts) so a simulated
// shipment can never be confused with a real consignment. Status starts
// at CREATED and only moves via the courier webhook route (webhook.ts),
// through the shipment -> order state-machine mapping in status-mapping.ts.
// Persistence: DB-backed since 2026-10-24 (./db-store.ts) — bookings are
// Shipment rows (chargePoisha = the real courierChargePoisha() output at
// booking time) with ShipmentEvent rows for the status history. Real
// adapters must keep this interface and add: real auth, zone/area id
// lookup, real rate API, label fetch.
import { z } from "zod";
import type {
  CourierProvider,
  CourierProviderName,
  CourierRate,
  CourierRateInput,
  CourierSuccessRate,
  CreateShipmentInput,
  CreateShipmentResult,
} from "../courier";
import type { ProviderConfig, WebhookVerification } from "../types";
import { assertSandboxMode } from "./live-guard";
import { courierChargePoisha } from "./courier-rates";
import { hashInt, sandboxShipmentId, sandboxTrackingId } from "./deterministic";
import {
  applyShipmentStatus,
  createShipmentRow,
  findShipmentById,
  findShipmentByTracking,
} from "./db-store";

export const SANDBOX_COURIER_PROVIDERS = ["steadfast", "pathao", "redx"] as const;
export type SandboxCourierProvider = (typeof SANDBOX_COURIER_PROVIDERS)[number];

export const sandboxCourierConfig = (name: SandboxCourierProvider): ProviderConfig => ({
  provider: name,
  enabled: true,
  mode: "sandbox",
  status: "configured",
  credentialRef: null,
  lastTestedAt: null,
  lastError: null,
});

const PROVIDER_DAYS: Record<SandboxCourierProvider, number> = { steadfast: 2, pathao: 2, redx: 3 };

const createSchema = z.object({
  orderId: z.string().min(1),
  codAmountPoisha: z.number().int().nonnegative(),
  weightGrams: z.number().int().positive(),
  itemCount: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
});

// The charge math itself lives in ./courier-rates (pure, client-safe)
// and is re-exported here so existing server-side importers of this
// module keep working unchanged.
export { courierChargePoisha } from "./courier-rates";

export function createSandboxCourierProvider(name: SandboxCourierProvider): CourierProvider {
  const config = sandboxCourierConfig(name);
  return {
    name: name as CourierProviderName,
    config,
    async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
      assertSandboxMode(config);
      const parsed = createSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid shipment input.");
      const shipmentId = sandboxShipmentId(name, parsed.data.idempotencyKey);
      const existing = await findShipmentById(shipmentId);
      if (existing) {
        return { shipmentId: existing.shipmentId, trackingId: existing.trackingId, status: existing.status, labelUrl: null };
      }
      // Sandbox shipments carry no zone; the charge uses the district
      // base, the same convention as the COD settlement report and the
      // courier-invoice expected rows.
      try {
        const shipment = await createShipmentRow({
          shipmentId,
          trackingId: sandboxTrackingId(name, parsed.data.idempotencyKey),
          provider: name,
          orderRef: parsed.data.orderId,
          codAmountPoisha: parsed.data.codAmountPoisha,
          weightGrams: parsed.data.weightGrams,
          chargePoisha: courierChargePoisha("district", parsed.data.weightGrams),
          idempotencyKey: parsed.data.idempotencyKey,
        });
        return { shipmentId, trackingId: shipment.trackingId, status: shipment.status, labelUrl: null };
      } catch (err) {
        // UNIQUE(id / trackingId) backstop: a concurrent replay won.
        if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
          const winner = await findShipmentById(shipmentId);
          if (winner) {
            return { shipmentId: winner.shipmentId, trackingId: winner.trackingId, status: winner.status, labelUrl: null };
          }
        }
        throw err;
      }
    },
    async cancelShipment(shipmentId: string) {
      assertSandboxMode(config);
      const shipment = await findShipmentById(shipmentId);
      if (!shipment || shipment.provider !== name) throw new Error("Sandbox shipment not found.");
      // ShipmentStatus has no CANCELLED value (see ../courier.ts): a cancel
      // before pickup is mapped to FAILED in sandbox, and is only allowed
      // from CREATED. Adding a CANCELLED shipment status is a schema/interface
      // change for the interface owner, not something this sandbox invents.
      if (shipment.status !== "CREATED") {
        throw new Error(`Cannot cancel a shipment in status ${shipment.status}.`);
      }
      const updated = await applyShipmentStatus(shipmentId, "FAILED", {
        eventIdempotencyKey: `cancel:${shipmentId}`,
      });
      return { status: updated?.status ?? "FAILED" };
    },
    async getStatus(trackingId: string) {
      assertSandboxMode(config);
      const shipment = await findShipmentByTracking(trackingId, name);
      if (!shipment) throw new Error("Sandbox tracking id not found.");
      return { status: shipment.status, events: [...shipment.statusHistory] };
    },
    async getRates(input: CourierRateInput): Promise<CourierRate[]> {
      assertSandboxMode(config);
      return [
        {
          provider: name as CourierProviderName,
          chargePoisha: courierChargePoisha(input.zone, input.weightGrams),
          estimatedDays: PROVIDER_DAYS[name],
        },
      ];
    },
    async handleWebhook(_verification: WebhookVerification): Promise<boolean> {
      // Routes must go through sandbox/webhook.ts processWebhook() for
      // signature + idempotency + logging. Direct calls never apply.
      void _verification;
      return false;
    },
    async successRate(phone: string): Promise<CourierSuccessRate> {
      assertSandboxMode(config);
      // Simulated, deterministic from the phone hash — NOT real courier data.
      const delivered = hashInt(`delivered:${phone}`, 90);
      const failed = hashInt(`failed:${phone}`, 5);
      const returned = hashInt(`returned:${phone}`, 5);
      const total = delivered + failed + returned;
      return {
        phone,
        delivered,
        failed,
        returned,
        successRatePercent: total === 0 ? null : Math.round((delivered / total) * 100),
      };
    },
  };
}

export const sandboxSteadfastProvider = () => createSandboxCourierProvider("steadfast");
export const sandboxPathaoProvider = () => createSandboxCourierProvider("pathao");
export const sandboxRedxProvider = () => createSandboxCourierProvider("redx");

// Sandbox CourierProvider — Steadfast, Pathao, RedX. Agent 9, Step 22.
// SIMULATED ONLY: no real courier API call, no real key, no real booking.
// Tracking ids are SBX-prefixed (see deterministic.ts) so a simulated
// shipment can never be confused with a real consignment. Status starts
// at CREATED and only moves via the courier webhook route (webhook.ts),
// through the shipment -> order state-machine mapping in status-mapping.ts.
// Real adapters must keep this interface and add: real auth, zone/area id
// lookup, real rate API, label fetch, and DB persistence (shipments,
// shipment_events) — the in-memory sandbox store is not a substitute.
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
import { hashInt, sandboxShipmentId, sandboxTrackingId } from "./deterministic";
import { sandboxStore, type SandboxShipment } from "./store";

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

/** Zone base charge in integer poisha, plus a per-500g surcharge above 1kg. */
const ZONE_BASE_POISHA: Record<string, number> = {
  inside_dhaka: 6000,
  outside_dhaka: 12000,
  district: 10000,
};
const PROVIDER_DAYS: Record<SandboxCourierProvider, number> = { steadfast: 2, pathao: 2, redx: 3 };

const createSchema = z.object({
  orderId: z.string().min(1),
  codAmountPoisha: z.number().int().nonnegative(),
  weightGrams: z.number().int().positive(),
  itemCount: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
});

export function courierChargePoisha(zone: string, weightGrams: number): number {
  const base = ZONE_BASE_POISHA[zone] ?? 10000;
  const extraUnits = Math.max(0, Math.ceil((weightGrams - 1000) / 500));
  return base + extraUnits * 2000;
}

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
      const existing = sandboxStore.shipments.get(shipmentId);
      if (existing) {
        return { shipmentId: existing.shipmentId, trackingId: existing.trackingId, status: existing.status, labelUrl: null };
      }
      const shipment: SandboxShipment = {
        shipmentId,
        trackingId: sandboxTrackingId(name, parsed.data.idempotencyKey),
        provider: name,
        orderId: parsed.data.orderId,
        codAmountPoisha: parsed.data.codAmountPoisha,
        weightGrams: parsed.data.weightGrams,
        status: "CREATED",
        statusHistory: ["CREATED"],
        orderStatus: "PENDING",
        idempotencyKey: parsed.data.idempotencyKey,
        createdAt: new Date().toISOString(),
      };
      sandboxStore.shipments.set(shipmentId, shipment);
      return { shipmentId, trackingId: shipment.trackingId, status: shipment.status, labelUrl: null };
    },
    async cancelShipment(shipmentId: string) {
      assertSandboxMode(config);
      const shipment = sandboxStore.shipments.get(shipmentId);
      if (!shipment || shipment.provider !== name) throw new Error("Sandbox shipment not found.");
      // ShipmentStatus has no CANCELLED value (see ../courier.ts): a cancel
      // before pickup is mapped to FAILED in sandbox, and is only allowed
      // from CREATED. Adding a CANCELLED shipment status is a schema/interface
      // change for the interface owner, not something this sandbox invents.
      if (shipment.status !== "CREATED") {
        throw new Error(`Cannot cancel a shipment in status ${shipment.status}.`);
      }
      shipment.status = "FAILED";
      shipment.statusHistory.push("FAILED");
      return { status: shipment.status };
    },
    async getStatus(trackingId: string) {
      assertSandboxMode(config);
      for (const shipment of sandboxStore.shipments.values()) {
        if (shipment.trackingId === trackingId && shipment.provider === name) {
          return { status: shipment.status, events: [...shipment.statusHistory] };
        }
      }
      throw new Error("Sandbox tracking id not found.");
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

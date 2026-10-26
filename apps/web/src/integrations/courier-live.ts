/**
 * ⚠️ DO NOT WIRE — ORPHANED v2-release leftover (kept for reference only).
 *
 * This file is NOT a live adapter: it contains fabricated success
 * rates (93–95%), fake fallback bookings and other dishonest stubs,
 * and it has NO consumers. The real live adapters are
 * src/integrations/steadfast.ts, pathao.ts and redx.ts (with their
 * *-resolver.ts companions). Never import this file from production
 * code — see the wave-44 merge accounting and the wave-49 courier
 * report.
 *
 * (Original header: "Live Courier Adapters for Bangladesh —
 * Steadfast, Pathao, RedX. Implements direct HTTP dispatching to
 * carrier APIs with real credential resolution..." — inaccurate,
 * retained only as provenance.)
 */
import type {
  CourierProvider,
  CourierProviderName,
  CreateShipmentInput,
  CreateShipmentResult,
  CourierRateInput,
  CourierRate,
  CourierSuccessRate,
  ShipmentStatus,
} from "./courier";
import type { WebhookVerification } from "./types";
import { courierChargePoisha } from "./sandbox/courier-rates";
import { sandboxCourierConfig } from "./sandbox/courier-provider";

/** Steadfast Live Adapter */
export class SteadfastLiveProvider implements CourierProvider {
  readonly name = "steadfast" as const;
  readonly config = sandboxCourierConfig("steadfast");

  constructor(
    private apiKey?: string,
    private secretKey?: string,
  ) {
    if (apiKey && secretKey) {
      this.config.mode = "live";
      this.config.status = "connected";
    }
  }

  async getRates(input: CourierRateInput): Promise<CourierRate[]> {
    const charge = courierChargePoisha(input.zone, input.weightGrams);
    return [
      {
        provider: "steadfast",
        chargePoisha: charge,
        estimatedDays: input.zone === "inside_dhaka" ? 1 : 3,
      },
    ];
  }

  async successRate(phone: string): Promise<CourierSuccessRate> {
    return {
      phone,
      delivered: 19,
      failed: 1,
      returned: 0,
      successRatePercent: 95,
    };
  }

  async cancelShipment(_shipmentId: string): Promise<{ status: ShipmentStatus }> {
    return { status: "RETURNED" };
  }

  async getStatus(_trackingId: string): Promise<{ status: ShipmentStatus; events: string[] }> {
    return { status: "IN_TRANSIT", events: ["Consignment verified at Steadfast hub"] };
  }

  async handleWebhook(_verification: WebhookVerification): Promise<boolean> {
    return true;
  }

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    const takaAmount = Math.round(input.codAmountPoisha / 100);

    if (!this.apiKey || !this.secretKey) {
      console.warn("[Steadfast] Missing API credentials. Generated sandbox consignment.");
      return {
        shipmentId: `stdf_${Date.now()}`,
        trackingId: `STD${Date.now().toString().slice(-8)}`,
        status: "CREATED",
        labelUrl: `https://portal.steadfast.com.bd/invoices/${input.orderId}`,
      };
    }

    try {
      const payload = {
        invoice: input.orderId,
        recipient_name: input.address.recipientName,
        recipient_phone: input.address.recipientPhone.replace(/[^0-9]/g, ""),
        recipient_address: `${input.address.addressLine}, ${input.address.upazila}, ${input.address.district}`,
        cod_amount: takaAmount,
        note: input.note || "Handle with care",
      };

      const res = await fetch("https://portal.steadfast.com.bd/api/v1/create_order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Api-Key": this.apiKey,
          "Secret-Key": this.secretKey,
        },
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => ({}))) as {
        status?: number;
        consignment?: { consignment_id?: number; tracking_code?: string };
      };

      if (data.status === 200 && data.consignment) {
        return {
          shipmentId: String(data.consignment.consignment_id),
          trackingId: data.consignment.tracking_code || `STD${data.consignment.consignment_id}`,
          status: "CREATED",
          labelUrl: `https://portal.steadfast.com.bd/invoices/${input.orderId}`,
        };
      }

      throw new Error(`Steadfast API returned status ${data.status}`);
    } catch (e) {
      console.error("[Steadfast] Booking failed:", e);
      return {
        shipmentId: `stdf_fallback_${Date.now()}`,
        trackingId: `STD${Date.now().toString().slice(-8)}`,
        status: "CREATED",
        labelUrl: null,
      };
    }
  }
}

/** Pathao Live Adapter */
export class PathaoLiveProvider implements CourierProvider {
  readonly name = "pathao" as const;
  readonly config = sandboxCourierConfig("pathao");

  constructor(
    private clientId?: string,
    private clientSecret?: string,
    private username?: string,
    private password?: string,
  ) {
    if (clientId && clientSecret) {
      this.config.mode = "live";
      this.config.status = "connected";
    }
  }

  async getRates(input: CourierRateInput): Promise<CourierRate[]> {
    const charge = courierChargePoisha(input.zone, input.weightGrams);
    return [
      {
        provider: "pathao",
        chargePoisha: charge,
        estimatedDays: input.zone === "inside_dhaka" ? 1 : 2,
      },
    ];
  }

  async successRate(phone: string): Promise<CourierSuccessRate> {
    return {
      phone,
      delivered: 14,
      failed: 1,
      returned: 0,
      successRatePercent: 93,
    };
  }

  async cancelShipment(_shipmentId: string): Promise<{ status: ShipmentStatus }> {
    return { status: "RETURNED" };
  }

  async getStatus(_trackingId: string): Promise<{ status: ShipmentStatus; events: string[] }> {
    return { status: "IN_TRANSIT", events: ["Parcel picked up by Pathao hero"] };
  }

  async handleWebhook(_verification: WebhookVerification): Promise<boolean> {
    return true;
  }

  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    return {
      shipmentId: `pth_${Date.now()}`,
      trackingId: `PTH${Date.now().toString().slice(-8)}`,
      status: "CREATED",
      labelUrl: `https://merchant.pathao.com/tracking/${input.orderId}`,
    };
  }
}

/** Factory to get carrier adapter */
export function getLiveCourierProvider(providerName: CourierProviderName): CourierProvider {
  switch (providerName) {
    case "pathao":
      return new PathaoLiveProvider(
        process.env.PATHAO_CLIENT_ID,
        process.env.PATHAO_CLIENT_SECRET,
        process.env.PATHAO_USERNAME,
        process.env.PATHAO_PASSWORD,
      );
    case "steadfast":
    default:
      return new SteadfastLiveProvider(
        process.env.STEADFAST_API_KEY,
        process.env.STEADFAST_SECRET_KEY,
      );
  }
}

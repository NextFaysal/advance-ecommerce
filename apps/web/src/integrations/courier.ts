// CourierProvider adapter interface — Agent 5, Steps 21-22 (base only).
// No real courier API calls here. Sandbox implementation in Step 22 must implement
// this interface per provider, with webhook/callback idempotency + status mapping.
import type { Idempotency, ProviderConfig, WebhookVerification } from "./types";

export type CourierProviderName = "steadfast" | "pathao" | "redx" | "paperfly" | "ecourier";

export const COURIER_PROVIDERS: readonly CourierProviderName[] = [
  "steadfast",
  "pathao",
  "redx",
  "paperfly",
  "ecourier",
];

export type ShipmentStatus =
  | "CREATED"
  | "PICKED_UP"
  | "IN_TRANSIT"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "FAILED"
  | "RETURNING"
  | "RETURNED";

export type ShippingZone = "inside_dhaka" | "outside_dhaka" | "district";

export interface ShipmentAddress {
  recipientName: string;
  recipientPhone: string;
  division: string;
  district: string;
  upazila: string;
  union: string | null;
  addressLine: string;
}

export interface CreateShipmentInput extends Idempotency {
  orderId: string;
  provider: CourierProviderName;
  address: ShipmentAddress;
  /** Integer poisha: amount to collect on delivery (COD). 0 = prepaid. */
  codAmountPoisha: number;
  weightGrams: number;
  itemCount: number;
  note: string | null;
}

export interface CreateShipmentResult {
  shipmentId: string;
  trackingId: string;
  status: ShipmentStatus;
  labelUrl: string | null;
}

export interface CourierRateInput {
  zone: ShippingZone;
  district: string;
  weightGrams: number;
  /** Integer poisha order value, for free-shipping thresholds. */
  orderValuePoisha: number;
}

export interface CourierRate {
  provider: CourierProviderName;
  /** Integer poisha. */
  chargePoisha: number;
  estimatedDays: number | null;
}

/** Courier success rate by phone, used before confirming a COD order (fraud/basic check, Step 18/22). */
export interface CourierSuccessRate {
  phone: string;
  delivered: number;
  failed: number;
  returned: number;
  successRatePercent: number | null;
}

export interface CourierProvider {
  readonly name: CourierProviderName;
  readonly config: ProviderConfig;
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
  cancelShipment(shipmentId: string): Promise<{ status: ShipmentStatus }>;
  getStatus(trackingId: string): Promise<{ status: ShipmentStatus; events: string[] }>;
  getRates(input: CourierRateInput): Promise<CourierRate[]>;
  /** Map the provider's raw status to ShipmentStatus, then apply idempotently. */
  handleWebhook(verification: WebhookVerification): Promise<boolean>;
  successRate(phone: string): Promise<CourierSuccessRate>;
}

/** COD settlement outline: courier-collected cash vs courier invoice, reconciled in admin (Step 22/45). */
export interface CodSettlementRow {
  shipmentId: string;
  orderId: string;
  provider: CourierProviderName;
  /** Integer poisha. */
  collectedPoisha: number;
  /** Integer poisha. */
  courierChargePoisha: number;
  /** Integer poisha: collected - charge. */
  payablePoisha: number;
  status: "pending" | "settled" | "disputed";
}

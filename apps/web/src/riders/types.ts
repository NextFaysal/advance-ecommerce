// Own rider management types — Agent 18, Execution Plan Step 45 (E3).
// BD differentiator #7: shops that run their own delivery riders instead of
// (or alongside) third-party couriers.
//
// Rules enforced by these types + the pure logic in assignment.ts/service.ts:
//  - Money is ALWAYS integer poisha. No floats anywhere.
//  - Rider/customer phone numbers are stored normalized (+8801XXXXXXXXX)
//    and only ever leave the API masked (see toRiderView in service.ts).
//  - A delivery OTP is NEVER stored in plain text. Only its SHA-256 hash
//    is stored on the proof (see proof.ts); the plain code exists only in
//    the customer's SMS and in the transition request that verifies it.
//  - Location is a type + stub only: zones are named areas, distances come
//    from a static stub table. NO real GPS / tracking API is called.
import { z } from "zod";

// ---- Riders ----

export type RiderStatus = "ACTIVE" | "INACTIVE" | "ON_DELIVERY" | "SUSPENDED";
export type VehicleType = "BICYCLE" | "MOTORCYCLE" | "VAN";

export interface RiderZone {
  id: string;
  name: string;
  district: string;
  /** Optional finer area inside the district (e.g. "Mirpur", "Uttara"). */
  area?: string;
}

export interface Rider {
  id: string;
  name: string;
  /** Normalized +8801XXXXXXXXX; API output is masked. */
  phone: string;
  vehicle: VehicleType;
  vehicleReg?: string;
  /** Home zone the rider starts from / is responsible for. */
  zoneId: string;
  status: RiderStatus;
  /** Flat payout the rider earns per completed (DELIVERED) delivery, poisha. */
  payoutPerDeliveryPoisha: number;
  createdAt: string;
}

export const createRiderSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(11),
  vehicle: z.enum(["BICYCLE", "MOTORCYCLE", "VAN"]),
  vehicleReg: z.string().min(1).optional(),
  zoneId: z.string().min(1),
  payoutPerDeliveryPoisha: z.number().int().nonnegative(),
});

// ---- Deliveries ----

export type DeliveryStatus = "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "FAILED";

export type ProofKind = "OTP" | "SIGNATURE" | "PHOTO";

/**
 * Proof of delivery. Exactly one ref is set, matching `kind`:
 *  - OTP       -> otpHash (SHA-256 hex of the code; the code itself is
 *                 never persisted, logged, or returned)
 *  - SIGNATURE -> signatureRef (storage key / URL of the signature image)
 *  - PHOTO     -> photoRef (storage key / URL of the doorstep photo)
 */
export interface DeliveryProof {
  kind: ProofKind;
  otpHash?: string;
  signatureRef?: string;
  photoRef?: string;
  capturedAt: string;
}

export interface RiderDelivery {
  id: string;
  orderId: string;
  riderId: string;
  /** Zone the delivery address falls in (drives assignment scoring). */
  zoneId: string;
  status: DeliveryStatus;
  /** COD amount the rider must collect, integer poisha. 0 = prepaid. */
  codAmountPoisha: number;
  /** COD actually collected from the customer, integer poisha. Set on DELIVERED. */
  codCollectedPoisha?: number;
  /** COD handed over to the shop at shift end, integer poisha. Set at handover. */
  codHandedOverPoisha?: number;
  assignedAt: string;
  pickedUpAt?: string;
  completedAt?: string;
  failureReason?: string;
  proof?: DeliveryProof;
}

export const assignDeliverySchema = z.object({
  orderId: z.string().min(1),
  zoneId: z.string().min(1),
  codAmountPoisha: z.number().int().nonnegative(),
});

export const deliveryTransitionSchema = z.object({
  deliveryId: z.string().min(1),
  to: z.enum(["PICKED_UP", "DELIVERED", "FAILED"]),
  /** Plain OTP code — verified against the stored hash, never stored. */
  otpCode: z.string().min(4).max(8).optional(),
  /** Pre-computed SHA-256 hash when the client hashed the code itself. */
  otpHash: z.string().min(32).optional(),
  signatureRef: z.string().min(1).optional(),
  photoRef: z.string().min(1).optional(),
  failureReason: z.string().min(1).optional(),
  /** COD collected from the customer (DELIVERED only). Defaults to codAmountPoisha. */
  collectedPoisha: z.number().int().nonnegative().optional(),
});

// ---- COD handover / performance views ----

/** Per-delivery COD reconciliation line. shortagePoisha > 0 => rider owes the shop. */
export interface CodHandoverLine {
  deliveryId: string;
  orderId: string;
  expectedPoisha: number;
  collectedPoisha: number;
  handedOverPoisha: number;
  /** expected - handedOver (after handover); positive = shortage. */
  shortagePoisha: number;
  hasShortage: boolean;
  /** True once codHandedOverPoisha has been recorded. */
  handedOver: boolean;
}

export interface RiderPerformance {
  riderId: string;
  totalAssigned: number;
  delivered: number;
  failed: number;
  inFlight: number;
  /** Basis points (10000 = 100%). 0 when nothing has completed yet. */
  successRateBps: number;
  codExpectedPoisha: number;
  codCollectedPoisha: number;
  /** collected / expected in basis points; 10000 when nothing was expected. */
  codAccuracyBps: number;
  /** Sum of per-delivery payout over DELIVERED deliveries, poisha. */
  payoutPoisha: number;
}

/** API-safe rider view: phone masked, everything else as stored. */
export interface RiderView extends Omit<Rider, "phone"> {
  phoneMasked: string;
}

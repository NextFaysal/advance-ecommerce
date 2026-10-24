// Delivery assignment + state flow — Agent 18 (E3). Pure functions only:
// no store access, no GPS, no external calls. Inputs are never mutated.
//
// ASSIGNMENT: "nearest zone + current load".
//  - Distance is a STUB: a static zone-to-zone table (km). A zone to itself
//    is 0. Zones not listed against each other are treated as unreachable
//    for the same city run (Infinity) — the rider is not auto-assigned
//    cross-city work. When the routing/GPS step lands, only
//    zoneDistanceKm() changes; the scoring contract stays.
//  - Load = deliveries currently ASSIGNED or PICKED_UP for that rider.
//  - Score is deterministic: distance dominates, load breaks distance ties,
//    rider id breaks final ties (stable, testable, explainable in the UI).
import type { DeliveryStatus, Rider, RiderDelivery } from "./types";

const ZONE_DISTANCE_KM: Record<string, Record<string, number>> = {
  dhaka_north: { dhaka_north: 0, dhaka_south: 9, gazipur: 24 },
  dhaka_south: { dhaka_south: 0, dhaka_north: 9, narayanganj: 16 },
  gazipur: { gazipur: 0, dhaka_north: 24 },
  narayanganj: { narayanganj: 0, dhaka_south: 16 },
  chattogram: { chattogram: 0 },
  khulna: { khulna: 0 },
};

export function zoneDistanceKm(fromZoneId: string, toZoneId: string): number {
  if (fromZoneId === toZoneId) return 0;
  return ZONE_DISTANCE_KM[fromZoneId]?.[toZoneId] ?? Number.POSITIVE_INFINITY;
}

/** Active load: parcels the rider is already responsible for right now. */
export function activeLoad(deliveries: readonly RiderDelivery[], riderId: string): number {
  return deliveries.filter(
    (d) => d.riderId === riderId && (d.status === "ASSIGNED" || d.status === "PICKED_UP"),
  ).length;
}

export interface RiderCandidate {
  riderId: string;
  distanceKm: number;
  activeLoad: number;
  /** Lower is better: distance * 1000 + load * 100. */
  score: number;
}

/**
 * Score one rider for a delivery zone. Returns null when the rider is not
 * eligible: INACTIVE / SUSPENDED riders never receive auto-assignment, and
 * an unreachable zone (Infinity distance) excludes the rider.
 */
export function scoreRiderForDelivery(
  rider: Rider,
  deliveries: readonly RiderDelivery[],
  deliveryZoneId: string,
): RiderCandidate | null {
  if (rider.status !== "ACTIVE" && rider.status !== "ON_DELIVERY") return null;
  const distanceKm = zoneDistanceKm(rider.zoneId, deliveryZoneId);
  if (!Number.isFinite(distanceKm)) return null;
  const load = activeLoad(deliveries, rider.id);
  return { riderId: rider.id, distanceKm, activeLoad: load, score: distanceKm * 1000 + load * 100 };
}

/** Best rider for a zone, or null when nobody is eligible. */
export function chooseRider(
  riders: readonly Rider[],
  deliveries: readonly RiderDelivery[],
  deliveryZoneId: string,
): RiderCandidate | null {
  const candidates = riders
    .map((r) => scoreRiderForDelivery(r, deliveries, deliveryZoneId))
    .filter((c): c is RiderCandidate => c !== null);
  candidates.sort(
    (a, b) => a.score - b.score || a.activeLoad - b.activeLoad || a.riderId.localeCompare(b.riderId),
  );
  return candidates[0] ?? null;
}

// ---- Delivery state flow ----

const DELIVERY_TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  ASSIGNED: ["PICKED_UP", "FAILED"], // FAILED here = rider could not pick up
  PICKED_UP: ["DELIVERED", "FAILED"],
  DELIVERED: [],
  FAILED: [],
};

export function deliveryTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return DELIVERY_TRANSITIONS[from].includes(to);
}

export interface DeliveryTransitionInput {
  to: DeliveryStatus;
  at: string; // ISO timestamp
  failureReason?: string;
  /** Required when to === "DELIVERED": OTP hash / signature / photo proof. */
  proof?: RiderDelivery["proof"];
  /** COD collected from the customer, poisha. Only for DELIVERED. */
  collectedPoisha?: number;
}

/**
 * Apply a state transition, returning a NEW delivery (inputs never mutated).
 * DELIVERED requires a proof — an order is never marked delivered on the
 * rider's word alone. FAILED requires a reason.
 */
export function applyDeliveryTransition(
  delivery: RiderDelivery,
  input: DeliveryTransitionInput,
): RiderDelivery {
  if (!deliveryTransition(delivery.status, input.to)) {
    throw new Error(`Delivery cannot move ${delivery.status} -> ${input.to}.`);
  }
  if (input.to === "DELIVERED" && !input.proof) {
    throw new Error("DELIVERED requires a proof (OTP hash, signature ref, or photo ref).");
  }
  if (input.to === "FAILED" && !input.failureReason) {
    throw new Error("FAILED requires a failureReason.");
  }
  const next: RiderDelivery = { ...delivery, status: input.to };
  if (input.to === "PICKED_UP") next.pickedUpAt = input.at;
  if (input.to === "DELIVERED") {
    next.completedAt = input.at;
    next.proof = input.proof;
    next.codCollectedPoisha = input.collectedPoisha ?? delivery.codAmountPoisha;
  }
  if (input.to === "FAILED") {
    next.completedAt = input.at;
    next.failureReason = input.failureReason;
  }
  return next;
}

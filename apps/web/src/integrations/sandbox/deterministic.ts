// Deterministic sandbox helpers — Agent 9.
// Same input => same sandbox ID/result, so a replayed request or webhook
// can be recognised as a duplicate instead of creating a second record.
// Uses SHA-256 only as a deterministic hash for SIMULATED ids; it is not
// a security token, not a credential, and never a real gateway transaction id.
import { createHash } from "node:crypto";

export function hash8(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 8).toUpperCase();
}

export function hashInt(input: string, modulus: number): number {
  const hex = createHash("sha256").update(input).digest("hex").slice(0, 8);
  return parseInt(hex, 16) % modulus;
}

/** Simulated payment attempt id, e.g. SBX-BKASH-1A2B3C4D. */
export function sandboxAttemptId(method: string, idempotencyKey: string): string {
  return `SBX-${method.toUpperCase()}-${hash8(`${method}:${idempotencyKey}`)}`;
}

/** Simulated gateway transaction id, e.g. SBX-TRXBKASH-1A2B3C4D. */
export function sandboxGatewayTrxId(method: string, idempotencyKey: string): string {
  return `SBX-TRX${method.toUpperCase()}-${hash8(`trx:${method}:${idempotencyKey}`)}`;
}

/** Simulated shipment id, e.g. SBX-SHIP-STEADFAST-1A2B3C4D. */
export function sandboxShipmentId(provider: string, idempotencyKey: string): string {
  return `SBX-SHIP-${provider.toUpperCase()}-${hash8(`${provider}:${idempotencyKey}`)}`;
}

/**
 * Simulated tracking id, prefixed SBX- so it can never be mistaken for a
 * real courier tracking id. Formats per provider (simulated only):
 *  steadfast: SBX-SF-XXXXXX, pathao: SBX-PT-XXXXXX, redx: SBX-RX-XXXXXX
 */
export function sandboxTrackingId(provider: string, idempotencyKey: string): string {
  const prefix =
    provider === "steadfast" ? "SF" : provider === "pathao" ? "PT" : provider === "redx" ? "RX" : "XX";
  return `SBX-${prefix}-${hash8(`track:${provider}:${idempotencyKey}`)}`;
}

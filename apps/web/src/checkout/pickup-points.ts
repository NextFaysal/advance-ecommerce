/**
 * Pickup points / store locations — ADV-19 (doc 22), click & collect.
 *
 * Where the data lives: a Settings JSON document, key
 * `stores.pickup_points`, holding an array of
 * `{ id, name, address, hours }`. A second optional document,
 * `stores.retail_locations` (same shape), holds retail stores that are
 * NOT pickup points; the /stores storefront page renders the union.
 * Editors use the generic Settings API (POST /api/v1/admin/settings)
 * through the card in app/admin/settings/orders — every change is
 * reason-audited like every other setting.
 *
 * There is deliberately NO built-in default list: inventing store
 * addresses would put fake locations on the storefront. Until the
 * merchant configures the document, the loader returns [] — checkout
 * still offers plain "pickup" (the customer arranges it with the shop
 * by phone, exactly as before this module existed), it just has no
 * named point to choose, and /stores shows its honest empty state.
 *
 * Parsing is tolerant by design (same contract as
 * src/checkout/delivery-slots.ts): a malformed document, a non-array
 * value, or rows without id/name/address degrade to the rows that ARE
 * usable, and a DB failure degrades to []. This module never throws —
 * it feeds checkout, which must never fail because a display
 * preference could not be read.
 */

const PICKUP_POINTS_KEY = "stores.pickup_points";
const RETAIL_LOCATIONS_KEY = "stores.retail_locations";

export interface PickupPoint {
  /** Stable id — this is what gets recorded on the order (as the
   *  `[pickup:<id>]` marker inside the create-time OrderNote, see
   *  app/api/v1/public/orders/route.ts). Renaming an id orphans the
   *  label lookup for past orders; the note also carries the name and
   *  address verbatim at order time, so history stays readable. */
  id: string;
  name: string;
  address: string;
  /** Free-text opening hours as recorded by the merchant ("সকাল ৯টা – রাত ৯টা"). */
  hours: string;
}

/** The serialized document when nothing is configured: an empty list.
 *  Exported so Settings registration and the admin editor compare
 *  against the same canonical string (mirrors
 *  DEFAULT_DELIVERY_SLOTS_JSON). */
export const EMPTY_PICKUP_POINTS_JSON = "[]";

const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > max) return null;
  return trimmed;
}

/**
 * Parse a Settings JSON document into pickup points. Returns null ONLY
 * for a wholly unusable document (not JSON / not an array) so callers
 * can distinguish "merchant saved garbage" from "merchant saved a list
 * with some bad rows" — either way the usable rows are what survive.
 * Duplicate ids keep the FIRST row (ids are the lookup key).
 */
export function parsePickupPoints(raw: string | null | undefined): PickupPoint[] | null {
  if (raw === null || raw === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const seen = new Set<string>();
  const points: PickupPoint[] = [];
  for (const entry of parsed as unknown[]) {
    if (!isRecord(entry)) continue;
    const id = cleanString(entry.id, 64);
    const name = cleanString(entry.name, 200);
    const address = cleanString(entry.address, 500);
    if (id === null || name === null || address === null) continue;
    if (!ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    points.push({ id, name, address, hours: cleanString(entry.hours, 200) ?? "" });
  }
  return points;
}

async function loadPoints(key: string): Promise<PickupPoint[]> {
  try {
    // Lazy import (delivery-slots' pattern) keeps this module free of
    // the Prisma client for pure callers (editor validation, tests).
    const { getSetting } = await import("@/lib/settings");
    return parsePickupPoints(await getSetting(key)) ?? [];
  } catch {
    return [];
  }
}

/** The effective pickup-point list for checkout + /stores. Fails OPEN
 *  to [] (no points configured) — never throws. */
export async function loadPickupPoints(): Promise<PickupPoint[]> {
  return loadPoints(PICKUP_POINTS_KEY);
}

/** Retail locations for the /stores page (NOT offered at checkout). */
export async function loadRetailLocations(): Promise<PickupPoint[]> {
  return loadPoints(RETAIL_LOCATIONS_KEY);
}

export function findPickupPoint(
  points: readonly PickupPoint[],
  id: string | null | undefined,
): PickupPoint | null {
  if (!id) return null;
  return points.find((p) => p.id === id) ?? null;
}

/** The marker written into the create-time OrderNote. Kept in one
 *  place so the admin list badge (which scans loaded notes for this
 *  prefix) and the writer can never drift apart. */
export const PICKUP_NOTE_MARKER_PREFIX = "[pickup:";

/** True when a note text carries a pickup-point choice. */
export function noteIsPickupChoice(text: string): boolean {
  return text.includes(PICKUP_NOTE_MARKER_PREFIX);
}

/** The create-time note line recording a pickup choice. The point's
 *  name/address are frozen into the note so the order stays readable
 *  even if the point is later renamed or removed from Settings. */
export function pickupChoiceNoteText(point: PickupPoint): string {
  return `পিকআপ পয়েন্ট: ${point.name} — ${point.address} ${PICKUP_NOTE_MARKER_PREFIX}${point.id}]`;
}

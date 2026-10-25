/**
 * Delivery slots (doc 17 batch O9-2) — the time bands a customer can
 * ask for at checkout ("morning / afternoon / evening"), plus the
 * gift option that rides next to them on the checkout form.
 *
 * Configuration: Settings key `orders.delivery_slots`, a JSON array
 * of { id, labelBn, labelEn } — registered in SETTING_DEFAULTS
 * (src/lib/settings) with the same BD default set as
 * DEFAULT_DELIVERY_SLOTS below, so it is writable through the
 * existing generic Settings API (POST /api/v1/admin/settings
 * { key, value, reason }) exactly like the orders.rules.* keys.
 * There is NO dedicated admin editor UI for it yet (the orders.rules.*
 * keys have none either) — see the wave-27 report.
 *
 * Loading FAILS OPEN to the defaults, mirroring order-rules: a
 * settings outage or a malformed stored value must never take
 * checkout down; the shop simply offers the default bands.
 *
 * Persistence: the chosen slot's ID lands on Order.deliverySlot (a
 * real column — the Order model has no JSON meta column; API "meta"
 * blocks are composed at read time). Labels are presentation and are
 * resolved from the CURRENT setting at display time; the id is the
 * durable fact. An id that is not in the configured set (stale page,
 * hand-crafted payload, admin renamed slots mid-checkout) is NOT
 * persisted — the create paths drop it and say so in their meta.
 *
 * Gift: Order.giftMessage — NULL = no gift, "" = gift requested with
 * no message, otherwise the message verbatim. NO gift-wrap fee exists
 * (there is no charge seam for one); the option is a flag + message
 * only, and the UI copy says nothing about fees.
 */
import { getSetting } from "@/lib/settings";

export const DELIVERY_SLOTS_SETTING_KEY = "orders.delivery_slots";

export interface DeliverySlot {
  id: string;
  labelBn: string;
  labelEn: string;
}

/** Sensible Bangladesh default set: morning / afternoon / evening. */
export const DEFAULT_DELIVERY_SLOTS: DeliverySlot[] = [
  { id: "morning", labelBn: "সকাল (৯টা – দুপুর ১টা)", labelEn: "Morning (9am – 1pm)" },
  { id: "afternoon", labelBn: "দুপুর–বিকেল (১টা – ৬টা)", labelEn: "Afternoon (1pm – 6pm)" },
  { id: "evening", labelBn: "সন্ধ্যা (৬টা – রাত ১০টা)", labelEn: "Evening (6pm – 10pm)" },
];

/** The JSON document registered as the Settings default — kept in
 *  sync with DEFAULT_DELIVERY_SLOTS (settings.ts cannot import from
 *  here without a cycle: this module imports getSetting from it). */
export const DEFAULT_DELIVERY_SLOTS_JSON = JSON.stringify(DEFAULT_DELIVERY_SLOTS);

/**
 * Parse a stored settings value into a slot list. Tolerant by design:
 * anything that is not a non-empty array of well-formed slot objects
 * yields null (the caller falls back to the defaults). Duplicate ids
 * keep the first entry — an id is an identity, not a list position.
 */
export function parseDeliverySlots(raw: string | null | undefined): DeliverySlot[] | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const seen = new Set<string>();
  const slots: DeliverySlot[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) return null;
    const { id, labelBn, labelEn } = entry as Record<string, unknown>;
    if (typeof id !== "string" || id.trim() === "") return null;
    if (typeof labelBn !== "string" || typeof labelEn !== "string") return null;
    if (seen.has(id)) continue;
    seen.add(id);
    slots.push({ id, labelBn, labelEn });
  }
  return slots.length > 0 ? slots : null;
}

/** Configured slots, or the BD defaults when unset/unreadable/bad. */
export async function loadDeliverySlots(): Promise<DeliverySlot[]> {
  try {
    const slots = parseDeliverySlots(await getSetting(DELIVERY_SLOTS_SETTING_KEY));
    return slots ?? DEFAULT_DELIVERY_SLOTS;
  } catch {
    return DEFAULT_DELIVERY_SLOTS;
  }
}

/**
 * Resolve a submitted slot id against the configured set. Returns the
 * canonical slot (whose id is what gets persisted) or null when the
 * submission names no configured slot.
 */
export function findDeliverySlot(
  slots: readonly DeliverySlot[],
  id: string | null | undefined,
): DeliverySlot | null {
  if (!id) return null;
  return slots.find((s) => s.id === id) ?? null;
}

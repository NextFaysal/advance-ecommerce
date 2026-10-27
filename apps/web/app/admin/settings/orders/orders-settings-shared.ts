import { interpolate, pick, type Locale } from "@/i18n/locale";
import { SETTINGS_STRINGS } from "../strings";

// Shared pure helpers for the Orders settings editors (doc 18, F2-1):
// the Order Rules card and the Delivery Slots card on
// /admin/settings/orders, plus the smoke that verifies them.
//
// Taka <-> poisha uses exact decimal-string math (the discipline of
// the VAT card's percentToBps): money is stored as integer poisha and
// the admin types taka with at most two decimals — float arithmetic
// never touches a money value.
//
// The slot validator MIRRORS parseDeliverySlots in
// src/checkout/delivery-slots.ts. That parser is not reused directly
// because it is deliberately lossy for the read path: it parses a
// stored JSON string, silently drops duplicate ids, and yields null
// for the whole document when one entry is malformed. An editor must
// refuse BEFORE saving and say which row is wrong, so the same shape
// rules are enforced here per row, with bilingual messages. Two
// deliberate stricter-than-parser rules (an editor may refuse what a
// tolerant reader would accept, never the reverse): duplicate ids are
// refused instead of silently dropped, ids must look like identifiers
// (letters/digits/hyphen/underscore — they are persisted on orders and
// submitted back from forms), and labels must be non-blank (a blank
// label is a broken checkout option).

/** Poisha -> taka input text: 150000 -> "1500", 150050 -> "1500.5", 150005 -> "1500.05". */
export function poishaToTakaText(poisha: number): string {
  if (!Number.isInteger(poisha) || poisha <= 0) return poisha === 0 ? "0" : String(poisha);
  const whole = Math.floor(poisha / 100);
  const frac = poisha % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/**
 * Taka text -> integer poisha. Empty text is the caller's "off/zero"
 * state and is handled there; anything non-numeric, negative, or with
 * more than two decimals is an error (never silently rounded).
 */
export function takaTextToPoisha(input: string, locale: Locale = "bn"): { poisha: number } | { error: string } {
  const s = pick(locale, SETTINGS_STRINGS);
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) {
    return { error: s.sharedTakaError };
  }
  const whole = Number(match[1] as string);
  const frac = match[2] ? Number((match[2] as string).padEnd(2, "0")) : 0;
  return { poisha: whole * 100 + frac };
}

export interface SlotRow {
  id: string;
  labelBn: string;
  labelEn: string;
}

const SLOT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Canonical serialization — the same key order as the stored JSON. */
export function serializeSlotRows(rows: readonly SlotRow[]): string {
  return JSON.stringify(
    rows.map((r) => ({ id: r.id.trim(), labelBn: r.labelBn, labelEn: r.labelEn })),
  );
}

/**
 * Validate editor rows with the loader parser's shape rules (see the
 * header): a non-empty list; every id a non-blank identifier; labels
 * present and non-blank; no duplicate ids. On success returns the
 * exact JSON string to store under `orders.delivery_slots`.
 */
export function validateSlotRows(
  rows: readonly SlotRow[],
  locale: Locale = "bn",
): { value: string } | { error: string } {
  const s = pick(locale, SETTINGS_STRINGS);
  if (rows.length === 0) {
    return { error: s.sharedSlotEmpty };
  }
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] as SlotRow;
    const id = row.id.trim();
    if (id === "") {
      return { error: interpolate(s.sharedSlotIdEmpty, { n: i + 1 }) };
    }
    if (!SLOT_ID_PATTERN.test(id)) {
      return { error: interpolate(s.sharedSlotIdInvalid, { id: row.id }) };
    }
    if (seen.has(id)) {
      return { error: interpolate(s.sharedSlotIdDup, { id }) };
    }
    seen.add(id);
    if (row.labelBn.trim() === "" || row.labelEn.trim() === "") {
      return { error: interpolate(s.sharedSlotLabels, { id }) };
    }
  }
  return { value: serializeSlotRows(rows) };
}

/** Sorted, lowercased list comparison — the loaders normalize lists
 *  (trim + lowercase), so change detection must compare semantically,
 *  not by raw stored string. */
export function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  const norm = (xs: readonly string[]) =>
    xs.map((s) => s.trim().toLowerCase()).filter((s) => s !== "").sort();
  const na = norm(a);
  const nb = norm(b);
  return na.length === nb.length && na.every((v, i) => v === nb[i]);
}

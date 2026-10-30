// Order-create rules (wave 20, plan 17 batch O2) — Settings-driven
// shop policy enforced at public order create time:
//
//   orders.rules.min_order_poisha               minimum merchandise
//                                               subtotal; 0 = off
//   orders.rules.cod_disabled_districts         comma/newline list of
//                                               districts where COD is
//                                               refused
//   orders.rules.cod_disabled_categories        comma/newline list of
//                                               category slugs; an order
//                                               containing any item from
//                                               a listed category
//                                               cannot be paid COD
//   orders.rules.advance_required_above_poisha  COD orders above this
//                                               grand total are flagged
//                                               advance-required;
//                                               0 = off
//   orders.rules.advance_percent                % of the grand total
//                                               asked as the advance
//                                               (default 20)
//
// Every rule defaults OFF / permissive, so an unconfigured shop checks
// out exactly as before this module existed. Rule loading FAILS OPEN:
// a settings read error yields the permissive defaults — a settings
// outage must never take checkout down with it.
//
// SCOPE (honest): this wave is plumbing. The advance flag is surfaced
// in the create response meta (and on the returned order) exactly like
// the fraud band's flag — nothing is persisted and nothing collects
// the advance yet; collection + confirmation gating are plan 17
// batch O3, which persists these as real Order columns.
import { getSetting } from "@/lib/settings";

export interface OrderRules {
  /** Minimum merchandise subtotal in poisha; 0 = rule off. */
  minOrderPoisha: number;
  /** Normalized (trimmed, lowercased) district names where COD is off. */
  codDisabledDistricts: readonly string[];
  /** Normalized category slugs: any item in one blocks COD. */
  codDisabledCategories: readonly string[];
  /** COD grand-total threshold in poisha; 0 = rule off. */
  advanceRequiredAbovePoisha: number;
  /** Advance percent of the grand total (1-100, default 20). */
  advancePercent: number;
  maxPendingOrdersEnabled: boolean;
  maxPendingOrdersCount: number;
  dailyOrderLimitEnabled: boolean;
  dailyOrderLimitCount: number;
  orderCooldownEnabled: boolean;
  orderCooldownMinutes: number;
  junkFilterEnabled: boolean;
}

export const PERMISSIVE_ORDER_RULES: OrderRules = {
  minOrderPoisha: 0,
  codDisabledDistricts: [],
  codDisabledCategories: [],
  advanceRequiredAbovePoisha: 0,
  advancePercent: 20,
  maxPendingOrdersEnabled: false,
  maxPendingOrdersCount: 2,
  dailyOrderLimitEnabled: false,
  dailyOrderLimitCount: 3,
  orderCooldownEnabled: false,
  orderCooldownMinutes: 5,
  junkFilterEnabled: false,
};

function parsePoisha(raw: string | null): number {
  if (raw === null) return 0;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Settings lists are comma- or newline-separated free text. */
function parseList(raw: string | null): string[] {
  if (raw === null) return [];
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function parseBoolean(raw: string | null): boolean {
  return raw === "true" || raw === "1";
}

function parseCount(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parsePercent(raw: string | null): number {
  if (raw === null) return 20;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 20;
}

export async function loadOrderRules(): Promise<OrderRules> {
  try {
    const [
      minOrder,
      districts,
      categories,
      above,
      percent,
      maxPendingEnabled,
      maxPendingCount,
      dailyLimitEnabled,
      dailyLimitCount,
      cooldownEnabled,
      cooldownMinutes,
      junkFilterEnabled,
    ] = await Promise.all([
      getSetting("orders.rules.min_order_poisha"),
      getSetting("orders.rules.cod_disabled_districts"),
      getSetting("orders.rules.cod_disabled_categories"),
      getSetting("orders.rules.advance_required_above_poisha"),
      getSetting("orders.rules.advance_percent"),
      getSetting("orders.rules.max_pending_orders_enabled"),
      getSetting("orders.rules.max_pending_orders_count"),
      getSetting("orders.rules.daily_order_limit_enabled"),
      getSetting("orders.rules.daily_order_limit_count"),
      getSetting("orders.rules.order_cooldown_enabled"),
      getSetting("orders.rules.order_cooldown_minutes"),
      getSetting("orders.rules.junk_filter_enabled"),
    ]);
    return {
      minOrderPoisha: parsePoisha(minOrder),
      codDisabledDistricts: parseList(districts),
      codDisabledCategories: parseList(categories),
      advanceRequiredAbovePoisha: parsePoisha(above),
      advancePercent: parsePercent(percent),
      maxPendingOrdersEnabled: parseBoolean(maxPendingEnabled),
      maxPendingOrdersCount: parseCount(maxPendingCount, 2),
      dailyOrderLimitEnabled: parseBoolean(dailyLimitEnabled),
      dailyOrderLimitCount: parseCount(dailyLimitCount, 3),
      orderCooldownEnabled: parseBoolean(cooldownEnabled),
      orderCooldownMinutes: parseCount(cooldownMinutes, 5),
      junkFilterEnabled: parseBoolean(junkFilterEnabled),
    };
  } catch {
    return PERMISSIVE_ORDER_RULES;
  }
}

/* ------------------------------------------------------------------ */
/* Evaluation (pure)                                                   */
/* ------------------------------------------------------------------ */

export type CodViolation =
  | { rule: "orders.rules.cod_disabled_districts"; match: string }
  | { rule: "orders.rules.cod_disabled_categories"; match: string };

/**
 * COD availability for one order. `district` is the submitted address
 * district (geo-validated upstream by the checkout cascade) and
 * `categorySlugs` the distinct category slugs of the order's items —
 * both matched case-insensitively after trimming, mirroring how the
 * settings lists are parsed.
 */
export function codViolation(
  rules: OrderRules,
  input: { district: string; categorySlugs: readonly string[] },
): CodViolation | null {
  const district = input.district.trim().toLowerCase();
  if (district !== "" && rules.codDisabledDistricts.includes(district)) {
    return { rule: "orders.rules.cod_disabled_districts", match: district };
  }
  for (const slug of input.categorySlugs) {
    const normalized = slug.trim().toLowerCase();
    if (normalized !== "" && rules.codDisabledCategories.includes(normalized)) {
      return { rule: "orders.rules.cod_disabled_categories", match: normalized };
    }
  }
  return null;
}

/** Minimum-order check against the merchandise subtotal (pre-shipping). */
export function belowMinimum(rules: OrderRules, subtotalPoisha: number): boolean {
  return rules.minOrderPoisha > 0 && subtotalPoisha < rules.minOrderPoisha;
}

export interface AdvanceRuleResult {
  advanceRequired: boolean;
  /** Poisha asked as advance (percent of the grand total); 0 when off. */
  advancePoisha: number;
}

/**
 * The mandatory-advance rule: COD only (a prepaid method already
 * collects), grand total strictly above the configured threshold.
 */
export function evaluateAdvanceRule(
  rules: OrderRules,
  input: { paymentMethod: string; grandTotalPoisha: number },
): AdvanceRuleResult {
  if (
    rules.advanceRequiredAbovePoisha <= 0 ||
    input.paymentMethod !== "cod" ||
    input.grandTotalPoisha <= rules.advanceRequiredAbovePoisha
  ) {
    return { advanceRequired: false, advancePoisha: 0 };
  }
  return {
    advanceRequired: true,
    advancePoisha: Math.round((input.grandTotalPoisha * rules.advancePercent) / 100),
  };
}

/**
 * Checks if a customer exceeds the pending orders limit.
 * Counts orders that are currently in "PENDING" status.
 */
export function exceedsPendingOrderLimit(
  rules: OrderRules,
  priorOrders: readonly { status: string }[],
): boolean {
  if (!rules.maxPendingOrdersEnabled || rules.maxPendingOrdersCount <= 0) return false;
  const pendingCount = priorOrders.filter((o) => o.status === "PENDING").length;
  return pendingCount >= rules.maxPendingOrdersCount;
}

/**
 * Checks if a customer exceeds the daily order limit.
 * Counts non-cancelled orders created within the last 24 hours.
 */
export function exceedsDailyOrderLimit(
  rules: OrderRules,
  priorOrders: readonly { status: string; createdAt: string | Date }[],
  nowMs: number = Date.now(),
): boolean {
  if (!rules.dailyOrderLimitEnabled || rules.dailyOrderLimitCount <= 0) return false;
  const oneDayAgo = nowMs - 24 * 60 * 60 * 1000;
  const dailyCount = priorOrders.filter((o) => {
    if (o.status === "CANCELLED") return false;
    const orderTime = new Date(o.createdAt).getTime();
    return orderTime >= oneDayAgo && orderTime <= nowMs;
  }).length;
  return dailyCount >= rules.dailyOrderLimitCount;
}

/**
 * Checks if a customer violates the cooldown period between subsequent orders.
 */
export function violatesOrderCooldown(
  rules: OrderRules,
  priorOrders: readonly { status: string; createdAt: string | Date }[],
  nowMs: number = Date.now(),
): { inCooldown: boolean; remainingSeconds: number } {
  if (!rules.orderCooldownEnabled || rules.orderCooldownMinutes <= 0) {
    return { inCooldown: false, remainingSeconds: 0 };
  }
  const cooldownMs = rules.orderCooldownMinutes * 60 * 1000;
  // Look for the newest non-cancelled order
  const validOrders = priorOrders
    .filter((o) => o.status !== "CANCELLED" && o.status !== "INCOMPLETE")
    .map((o) => new Date(o.createdAt).getTime())
    .filter((time) => !Number.isNaN(time))
    .sort((a, b) => b - a);

  if (validOrders.length === 0) {
    return { inCooldown: false, remainingSeconds: 0 };
  }

  const lastOrderTime = validOrders[0];
  const elapsedMs = nowMs - lastOrderTime;
  if (elapsedMs < cooldownMs) {
    const remainingSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
    return { inCooldown: true, remainingSeconds };
  }

  return { inCooldown: false, remainingSeconds: 0 };
}

/**
 * Detects mock, gibberish or spam texts in customer names and address lines.
 */
export function isJunkText(input?: string | null): boolean {
  if (!input) return false;
  const s = input.trim();
  if (s.length < 3) return true;

  // 1. Same character repeated 4+ times consecutively
  if (/(.)\1{3,}/i.test(s)) return true;

  // 2. Obvious keyboard mash patterns and mock words
  const mashPatterns = [
    /asdf/i,
    /qwerty/i,
    /zxcvb/i,
    /123456/i,
    /abcdef/i,
    /\b(test|fake|dummy|asdfgh|unknown|demo|sample)\b/i,
  ];
  for (const pattern of mashPatterns) {
    if (pattern.test(s)) return true;
  }

  // 3. Must contain at least one letter (Bengali or English)
  const hasLetters = /[\p{L}]/u.test(s);
  if (!hasLetters) return true;

  return false;
}

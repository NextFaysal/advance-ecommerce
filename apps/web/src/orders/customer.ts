// Customer metrics + risk — pure functions, no DB access.
// Risk badge: Low 0-39 (emerald), Medium 40-69 (amber), High 70-100 (rose).
// These are display helpers; the real risk score (fraud engine, v2) is computed
// server-side from courier success rate, duplicates, blacklist, etc.
import type { Customer } from "./types";
import { maskPhone } from "../checkout/validation";

export type RiskLevel = "Low" | "Medium" | "High";

export function riskLevel(score: number): RiskLevel {
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

/** Delivery success rate over delivered+cancelled+returned orders, 0-100. */
export function customerSuccessRate(customer: Customer): number {
  const total =
    customer.deliveredOrders + customer.cancelledOrders + customer.returnedOrders;
  if (total === 0) return 100;
  return Math.round((customer.deliveredOrders / total) * 100);
}

/** Average order value over delivered orders, integer poisha. */
export function customerAovPoisha(customer: Customer): number {
  if (customer.deliveredOrders === 0) return 0;
  return Math.round(customer.lifetimeValuePoisha / customer.deliveredOrders);
}

/**
 * Default display: masked phone. Full phone only when the viewer holds
 * `customers.view_full_phone` — enforced server-side; the UI must never render
 * the full number for a masked viewer, and full views must be audit-logged.
 */
export function displayPhone(
  normalizedPhone: string,
  canViewFullPhone: boolean,
): string {
  return canViewFullPhone ? normalizedPhone : maskPhone(normalizedPhone);
}

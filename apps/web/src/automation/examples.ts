/**
 * Example automation rules — Agent 13. Reference rules a merchant can copy;
 * they are NOT installed into the demo store automatically (an admin creates
 * rules explicitly). Money thresholds are integer poisha.
 * Test cases (each rule against a sample event) are noted in comments and
 * exercise: confirm_order validity, AND/OR composition, delayed scheduling,
 * and the send_sms effect (executed for real by the worker, ADV-7).
 */
import { and, condition, or, type AutomationRule } from "./types";

const AT = "2026-01-01T00:00:00.000Z";

export const EXAMPLE_RULES: AutomationRule[] = [
  {
    id: "rule_auto_confirm_low_risk_cod",
    name: "Low-risk COD order — auto confirm",
    description: "Risk score < 40 and COD: confirm without waiting for a staff member.",
    trigger: "order.created",
    // Test: order.created, riskScore 12, paymentMethod "cod", status PENDING
    //   -> matched, effect confirm_order applied (PENDING -> CONFIRMED valid).
    // Test: riskScore 55 -> not matched (first leaf fails, AND group fails).
    conditions: and(
      condition("riskScore", "lt", 40),
      condition("paymentMethod", "eq", "cod"),
    ),
    actions: [{ type: "confirm_order" }],
    delaySeconds: 0,
    enabled: true,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "rule_assign_steadfast_inside_dhaka",
    name: "Inside Dhaka — assign Steadfast",
    description: "Orders shipping inside Dhaka division go to Steadfast by default (auto courier assignment).",
    trigger: "order.created",
    // Test: division "Dhaka" -> matched, effect assign_courier steadfast.
    conditions: condition("division", "eq", "Dhaka"),
    actions: [{ type: "assign_courier", courier: "steadfast" }],
    delaySeconds: 0,
    enabled: true,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "rule_abandoned_checkout_sms",
    name: "Abandoned checkout — SMS after 30 minutes",
    description: "Checkout abandoned for 30+ minutes with a cart of ৳500 or more: schedule a recovery SMS.",
    trigger: "checkout.abandoned",
    // Test: checkout.abandoned, abandonedMinutes 45, totalPoisha 75000
    //   -> matched, status "scheduled", executeAfter = occurredAt + 1800s,
    //      effect send_sms planned; the worker's delayed re-invocation
    //      executes it for real (ADV-7).
    conditions: and(
      condition("abandonedMinutes", "gte", 30),
      condition("totalPoisha", "gte", 50000),
    ),
    actions: [{ type: "send_sms", templateKey: "abandoned_recovery" }],
    delaySeconds: 1800,
    enabled: true,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "rule_low_stock_notify",
    name: "Low stock — notify staff",
    description: "Any SKU at 5 units or fewer: notify staff before it stocks out.",
    trigger: "stock.low",
    // Test: stock.low, stockAvailable 3 -> matched, effect notify_staff.
    conditions: condition("stockAvailable", "lte", 5),
    actions: [{ type: "notify_staff", message: "Low stock — check inventory and create a purchase order." }],
    delaySeconds: 0,
    enabled: true,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "rule_high_value_paid_tag_vip",
    name: "High-value payment — tag order VIP",
    description: "A succeeded payment of ৳10,000 or more, or an order already tagged wholesale: tag VIP for priority packing.",
    trigger: "payment.succeeded",
    // Test: payment.succeeded, paymentAmountPoisha 1200000 -> matched (OR, first leaf).
    // Test: paymentAmountPoisha 50000, tags ["wholesale"] -> matched (OR, second leaf).
    conditions: or(
      condition("paymentAmountPoisha", "gte", 1000000),
      condition("tags", "contains", "wholesale"),
    ),
    actions: [{ type: "add_tag", tag: "vip" }],
    delaySeconds: 0,
    enabled: true,
    createdAt: AT,
    updatedAt: AT,
  },
  {
    id: "rule_failed_payment_email",
    name: "Payment failed — send payment-help email",
    description: "When an order's payment status becomes FAILED, email the customer a payment-help message.",
    trigger: "order.status_changed",
    conditions: condition("paymentStatus", "eq", "FAILED"),
    actions: [{ type: "send_email", templateKey: "payment_help" }],
    delaySeconds: 0,
    enabled: false,
    createdAt: AT,
    updatedAt: AT,
  },
];

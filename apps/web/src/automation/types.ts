/**
 * Automation engine types — Agent 13, Execution Plan Step 43 (A1).
 *
 * Pure domain types + Zod schemas. No DB, no provider calls: actions are
 * DESCRIBED as effects by the engine; the jobs owner (BullMQ, QUEUE_NAMES
 * .automation = "automation-run") executes the send effects for matched
 * runs (ADV-7, src/automation/effects.ts) and records the outcomes in
 * the run log. Money is integer poisha.
 * Customer phone exists in the rule context for matching only — it must
 * never be written to a run log unmasked (engine masks it, see engine.ts).
 */
import { z } from "zod";
import type { OrderStatus, PaymentStatus } from "../orders/types";

/* ------------------------------------------------------------------ */
/* Triggers — domain events (Master Prompt § events)                   */
/* ------------------------------------------------------------------ */

export const AUTOMATION_TRIGGERS = [
  "order.created",
  "order.status_changed",
  "payment.succeeded",
  "stock.low",
  "checkout.abandoned",
  // Schema wave 2: the DB enum gained CUSTOMER_REGISTERED and
  // registerCustomer now dispatches through the producer seam.
  "customer.registered",
] as const;

export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

/* ------------------------------------------------------------------ */
/* Rule context — the flat field map conditions match against.         */
/* Built from an event by buildRuleContext() in engine.ts.             */
/* ------------------------------------------------------------------ */

export interface RuleContext {
  orderId?: string;
  orderNo?: string;
  orderStatus?: OrderStatus;
  paymentStatus?: PaymentStatus;
  paymentMethod?: string;
  /** Order grand total, integer poisha. */
  totalPoisha?: number;
  itemCount?: number;
  /** Normalized +8801XXXXXXXXX. Matching only — logs always mask it. */
  customerPhone?: string;
  district?: string;
  division?: string;
  courier?: string;
  /** Fraud score 0-100 for the order, when scoring has run. */
  riskScore?: number;
  tags?: string[];
  stockAvailable?: number;
  sku?: string;
  variantId?: string;
  /** Minutes since the checkout was abandoned (checkout.abandoned). */
  abandonedMinutes?: number;
  /** Succeeded payment amount, integer poisha (payment.succeeded). */
  paymentAmountPoisha?: number;
}

export const CONDITION_FIELDS = [
  "orderStatus",
  "paymentStatus",
  "paymentMethod",
  "totalPoisha",
  "itemCount",
  "district",
  "division",
  "courier",
  "riskScore",
  "tags",
  "stockAvailable",
  "sku",
  "abandonedMinutes",
  "paymentAmountPoisha",
] as const;

export type ConditionField = (typeof CONDITION_FIELDS)[number];

/* ------------------------------------------------------------------ */
/* Conditions — field / operator / value, composed with AND / OR.      */
/* A ConditionNode is a leaf condition or a logic group of nodes,      */
/* so rules can nest: (A AND B) OR C.                                  */
/* ------------------------------------------------------------------ */

export const CONDITION_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "not_in",
  "contains",
  "not_contains",
  "exists",
  "not_exists",
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export type ConditionValue = string | number | boolean | string[] | number[];

export interface Condition {
  kind: "condition";
  field: ConditionField;
  operator: ConditionOperator;
  /** Omit for exists / not_exists. Array for in / not_in / contains-any. */
  value?: ConditionValue;
}

export interface ConditionGroup {
  kind: "group";
  logic: "AND" | "OR";
  nodes: ConditionNode[];
}

export type ConditionNode = Condition | ConditionGroup;

export function condition(
  field: ConditionField,
  operator: ConditionOperator,
  value?: ConditionValue,
): Condition {
  return value === undefined
    ? { kind: "condition", field, operator }
    : { kind: "condition", field, operator, value };
}

export function and(...nodes: ConditionNode[]): ConditionGroup {
  return { kind: "group", logic: "AND", nodes };
}

export function or(...nodes: ConditionNode[]): ConditionGroup {
  return { kind: "group", logic: "OR", nodes };
}

/* ------------------------------------------------------------------ */
/* Actions — described as effects by the engine. For matched          */
/* immediate runs the automation worker executes send_sms (through    */
/* the SMS send path: configured gateway, or the sandbox simulator     */
/* labelled simulated), send_email (queued through the ADV-3 email     */
/* producer), confirm_order (through the order funnel, gates intact), */
/* add_tag / remove_tag (the OrderTag store / Customer.tags) and       */
/* assign_courier (createSplitShipment, the staff booking seam) and    */
/* rewrites the effect descriptions with the real outcomes;            */
/* notify_staff has no delivery channel and stays plan-only,          */
/* re-labelled as such at execution. Dry-run / scheduled effects stay  */
/* "planned" descriptions.                                             */
/* ------------------------------------------------------------------ */

export type AutomationAction =
  | { type: "confirm_order" }
  | { type: "assign_courier"; courier: string }
  | { type: "send_sms"; templateKey: string }
  | {
      type: "send_email";
      templateKey: string;
      /** automation_notice only: the merchant-written email subject. */
      subject?: string;
      /** automation_notice only: the merchant-written email body text. */
      message?: string;
    }
  | { type: "add_tag"; tag: string }
  | { type: "remove_tag"; tag: string }
  | { type: "notify_staff"; message: string };

/**
 * The email templates the email worker can actually RENDER
 * (src/email/send.ts processEmailJob). A send_email action naming any
 * other key can never send — the effect executor validates against
 * this list BEFORE enqueueing and records an honest skip instead of
 * queueing an email that would silently die in the worker (the
 * automation-email fix, 2026-10-30; staff_invite / report_delivery /
 * daily_digest are platform-internal templates, not rule-usable).
 * "automation_notice" renders the action's own subject + message to
 * the order's customer.
 */
export const RENDERABLE_EMAIL_TEMPLATES = [
  "order_confirmation",
  "order_shipped",
  "order_delivered",
  "order_cancelled",
  "automation_notice",
] as const;

export type RenderableEmailTemplate = (typeof RENDERABLE_EMAIL_TEMPLATES)[number];

export type AutomationActionType = AutomationAction["type"];

/* ------------------------------------------------------------------ */
/* Rule                                                                */
/* ------------------------------------------------------------------ */

export interface AutomationRule {
  id: string;
  name: string;
  description?: string;
  trigger: AutomationTrigger;
  conditions: ConditionNode;
  actions: AutomationAction[];
  /** 0 = run immediately. >0 = engine schedules (run log status "scheduled", executeAfter set); the BullMQ worker re-invokes after the delay. */
  delaySeconds: number;
  enabled: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export interface AutomationEvent {
  type: AutomationTrigger;
  /** ISO timestamp; injected by callers so evaluation is deterministic in tests. */
  occurredAt: string;
  order?: {
    id: string;
    orderNo: string;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    paymentMethod: string;
    totalPoisha: number;
    itemCount: number;
    customerPhone: string;
    district: string;
    division: string;
    courier?: string;
    riskScore?: number;
    tags: string[];
  };
  stock?: { variantId: string; sku: string; available: number };
  checkout?: { id: string; totalPoisha: number; abandonedMinutes: number };
  payment?: { amountPoisha: number; method: string };
  /** customer.registered (schema wave 2). Built from the Customer
   *  row at execution time like every other branch; the phone rides
   *  the event only so SMS effects + log masking behave exactly as
   *  they do for orders — run logs store it masked, never raw. */
  customer?: { id: string; tags: string[]; customerPhone: string };
}

/* ------------------------------------------------------------------ */
/* Run log                                                             */
/* ------------------------------------------------------------------ */

export type ConditionTrace = {
  field: ConditionField;
  operator: ConditionOperator;
  expected?: ConditionValue;
  /** Actual context value, with phone never present (field is not a condition field). */
  actual?: ConditionValue;
  matched: boolean;
};

export interface ActionEffect {
  action: AutomationAction;
  status: "applied" | "planned" | "skipped";
  /** Human-readable, phone-masked. Safe to store / display. */
  description: string;
  reason?: string;
}

export type RunStatus = "matched" | "not_matched" | "scheduled" | "dry_run";

export interface AutomationRunLog {
  id: string;
  ruleId: string;
  ruleName: string;
  trigger: AutomationTrigger;
  dryRun: boolean;
  status: RunStatus;
  matched: boolean;
  /** Leaf-condition results, in evaluation order. */
  trace: ConditionTrace[];
  /** Effects that were applied (immediate, real run), planned (scheduled), or skipped with a reason. Empty when not matched. */
  effects: ActionEffect[];
  /** Masked phone of the triggering order, when any — full phone is never logged. */
  customerPhoneMasked?: string;
  orderId?: string;
  /** ISO time the actions should execute when status is "scheduled". */
  executeAfter?: string;
  evaluatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Zod schemas — every API input in this slice goes through these.     */
/* ------------------------------------------------------------------ */

const conditionValueSchema: z.ZodType<ConditionValue> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
]);

const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.object({
    kind: z.literal("condition"),
    field: z.enum(CONDITION_FIELDS),
    operator: z.enum(CONDITION_OPERATORS),
    value: conditionValueSchema.optional(),
  }),
);

export const conditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([
    conditionSchema,
    z.object({
      kind: z.literal("group"),
      logic: z.enum(["AND", "OR"]),
      nodes: z.array(conditionNodeSchema).min(1),
    }),
  ]),
);

export const automationActionSchema: z.ZodType<AutomationAction> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("confirm_order") }),
    z.object({ type: z.literal("assign_courier"), courier: z.string().min(1).max(50) }),
    z.object({ type: z.literal("send_sms"), templateKey: z.string().min(1).max(100) }),
    z.object({
      type: z.literal("send_email"),
      templateKey: z.string().min(1).max(100),
      // Meaningful only with templateKey "automation_notice" (the
      // effect executor requires both non-empty there and skips
      // honestly when they are missing).
      subject: z.string().max(200).optional(),
      message: z.string().max(5000).optional(),
    }),
    z.object({ type: z.literal("add_tag"), tag: z.string().min(1).max(50) }),
    z.object({ type: z.literal("remove_tag"), tag: z.string().min(1).max(50) }),
    z.object({ type: z.literal("notify_staff"), message: z.string().min(1).max(500) }),
  ]),
);

export const createRuleSchema = z.object({
  name: z.string().min(3).max(120),
  description: z.string().max(500).optional(),
  trigger: z.enum(AUTOMATION_TRIGGERS),
  conditions: conditionNodeSchema,
  actions: z.array(automationActionSchema).min(1),
  delaySeconds: z.number().int().min(0).max(7 * 24 * 3600).default(0),
  enabled: z.boolean().default(true),
});

export type CreateRuleInput = z.infer<typeof createRuleSchema>;

export const updateRuleSchema = createRuleSchema.partial().extend({
  enabled: z.boolean().optional(),
});

export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;

const orderStatusSchema = z.enum([
  "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED",
  "FAILED", "RETURN_REQUESTED", "RETURNING", "RETURNED", "CANCELLED",
  "REFUNDED", "EXCHANGED",
]);

const paymentStatusSchema = z.enum([
  "UNPAID", "PARTIAL", "PAID", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED",
]);

export const automationEventSchema: z.ZodType<AutomationEvent> = z.lazy(() =>
  z.object({
    type: z.enum(AUTOMATION_TRIGGERS),
    occurredAt: z.string().datetime(),
    order: z
      .object({
        id: z.string().min(1),
        orderNo: z.string().min(1),
        status: orderStatusSchema,
        paymentStatus: paymentStatusSchema,
        paymentMethod: z.string().min(1),
        totalPoisha: z.number().int().nonnegative(),
        itemCount: z.number().int().nonnegative(),
        customerPhone: z.string().min(1),
        district: z.string().min(1),
        division: z.string().min(1),
        courier: z.string().optional(),
        riskScore: z.number().int().min(0).max(100).optional(),
        tags: z.array(z.string()),
      })
      .optional(),
    stock: z
      .object({
        variantId: z.string().min(1),
        sku: z.string().min(1),
        available: z.number().int().nonnegative(),
      })
      .optional(),
    checkout: z
      .object({
        id: z.string().min(1),
        totalPoisha: z.number().int().nonnegative(),
        abandonedMinutes: z.number().int().nonnegative(),
      })
      .optional(),
    payment: z
      .object({
        amountPoisha: z.number().int().nonnegative(),
        method: z.string().min(1),
      })
      .optional(),
    customer: z
      .object({
        id: z.string().min(1),
        tags: z.array(z.string()),
        customerPhone: z.string().min(1),
      })
      .optional(),
  }),
);

/** Dry-run request: a full rule draft (or stored rule id) + a sample event. */
export const dryRunSchema = z.object({
  ruleId: z.string().min(1).optional(),
  rule: createRuleSchema.optional(),
  event: automationEventSchema,
});

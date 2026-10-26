/**
 * Automation engine — Agent 13, Step 43 (A1). Pure and unit-testable:
 * no DB, no provider calls, no Date.now() (timestamps come from the event /
 * injected clock), no id generation (ids are injected).
 *
 * Flow: domain event -> buildRuleContext() -> evaluateConditions() ->
 * describeActions() as effects. The engine itself performs no side
 * effects; execution belongs to the automation-run worker
 * (src/jobs/runners.ts createAutomationRunner, ADV-7): for a matched
 * immediate run it executes the send_sms effect through the platform
 * SMS send path and the send_email effect through the email producer,
 * and rewrites those effect entries with the REAL provider outcomes
 * before the run log persists. The descriptions below are therefore
 * the PRE-execution wording (intent); "planned" mode (dry-run /
 * scheduled) is the final truth for those runs — nothing executes
 * there, by contract. A run log entry is produced for every
 * evaluation, matched or not, so the admin run log can explain every
 * decision.
 */
import { maskPhone } from "../checkout/validation";
import { canTransition } from "../orders/state-machine";
import type {
  ActionEffect,
  AutomationAction,
  AutomationEvent,
  AutomationRule,
  AutomationRunLog,
  Condition,
  ConditionNode,
  ConditionTrace,
  ConditionValue,
  RuleContext,
} from "./types";

/* ------------------------------------------------------------------ */
/* Context                                                             */
/* ------------------------------------------------------------------ */

export function buildRuleContext(event: AutomationEvent): RuleContext {
  const ctx: RuleContext = {};
  if (event.order) {
    ctx.orderId = event.order.id;
    ctx.orderNo = event.order.orderNo;
    ctx.orderStatus = event.order.status;
    ctx.paymentStatus = event.order.paymentStatus;
    ctx.paymentMethod = event.order.paymentMethod;
    ctx.totalPoisha = event.order.totalPoisha;
    ctx.itemCount = event.order.itemCount;
    ctx.customerPhone = event.order.customerPhone;
    ctx.district = event.order.district;
    ctx.division = event.order.division;
    ctx.courier = event.order.courier;
    ctx.riskScore = event.order.riskScore;
    ctx.tags = event.order.tags;
  }
  if (event.stock) {
    ctx.stockAvailable = event.stock.available;
    ctx.sku = event.stock.sku;
    ctx.variantId = event.stock.variantId;
  }
  if (event.checkout) {
    ctx.abandonedMinutes = event.checkout.abandonedMinutes;
    ctx.totalPoisha = ctx.totalPoisha ?? event.checkout.totalPoisha;
  }
  if (event.payment) {
    ctx.paymentAmountPoisha = event.payment.amountPoisha;
    ctx.paymentMethod = ctx.paymentMethod ?? event.payment.method;
    ctx.totalPoisha = ctx.totalPoisha ?? event.payment.amountPoisha;
  }
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Condition evaluation                                                */
/* ------------------------------------------------------------------ */

function fieldValue(ctx: RuleContext, field: Condition["field"]): ConditionValue | undefined {
  const value: ConditionValue | undefined = ctx[field];
  return value;
}

function containsValue(actual: ConditionValue | undefined, expected: ConditionValue | undefined): boolean {
  if (typeof expected !== "string") return false;
  if (Array.isArray(actual)) return (actual as readonly unknown[]).some((v) => v === expected);
  if (typeof actual === "string") return actual.includes(expected);
  return false;
}

function asNumber(value: ConditionValue | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function valuesEqual(a: ConditionValue | undefined, b: ConditionValue | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return false;
  return a === b;
}

export function evaluateLeaf(cond: Condition, ctx: RuleContext): ConditionTrace {
  const actual = fieldValue(ctx, cond.field);
  const expected = cond.value;
  let matched = false;

  switch (cond.operator) {
    case "exists":
      matched = actual !== undefined;
      break;
    case "not_exists":
      matched = actual === undefined;
      break;
    case "eq":
      matched = valuesEqual(actual, expected);
      break;
    case "neq":
      matched = actual !== undefined && !valuesEqual(actual, expected);
      break;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = asNumber(actual);
      const b = asNumber(expected);
      if (a !== null && b !== null) {
        matched =
          cond.operator === "gt" ? a > b
          : cond.operator === "gte" ? a >= b
          : cond.operator === "lt" ? a < b
          : a <= b;
      }
      break;
    }
    case "in":
      matched = Array.isArray(expected) && expected.some((v) => valuesEqual(actual, v));
      break;
    case "not_in":
      matched = actual !== undefined && Array.isArray(expected) && !expected.some((v) => valuesEqual(actual, v));
      break;
    case "contains": {
      // Array field (tags): membership. String field: substring.
      matched = containsValue(actual, expected);
      break;
    }
    case "not_contains": {
      const isContainer = Array.isArray(actual) || typeof actual === "string";
      matched = isContainer && typeof expected === "string" ? !containsValue(actual, expected) : false;
      break;
    }
  }

  const trace: ConditionTrace = { field: cond.field, operator: cond.operator, matched };
  if (expected !== undefined) trace.expected = expected;
  if (actual !== undefined) trace.actual = actual;
  return trace;
}

/** Evaluate a condition tree, collecting a trace entry for every leaf. */
export function evaluateConditions(
  node: ConditionNode,
  ctx: RuleContext,
): { matched: boolean; trace: ConditionTrace[] } {
  if (node.kind === "condition") {
    const trace = evaluateLeaf(node, ctx);
    return { matched: trace.matched, trace: [trace] };
  }
  const traces: ConditionTrace[] = [];
  let matched = node.logic === "AND";
  for (const child of node.nodes) {
    const result = evaluateConditions(child, ctx);
    traces.push(...result.trace);
    matched = node.logic === "AND" ? matched && result.matched : matched || result.matched;
  }
  return { matched, trace: traces };
}

/* ------------------------------------------------------------------ */
/* Actions -> effects (described here; the runner executes the send  */
/* effects for matched immediate runs and rewrites their outcomes).  */
/* ------------------------------------------------------------------ */

function describeAction(
  action: AutomationAction,
  ctx: RuleContext,
  mode: "applied" | "planned",
): ActionEffect {
  const masked = ctx.customerPhone ? maskPhone(ctx.customerPhone) : undefined;
  switch (action.type) {
    case "confirm_order": {
      if (ctx.orderStatus === undefined) {
        return { action, status: "skipped", description: "Confirm order — no order in context.", reason: "no_order_context" };
      }
      if (!canTransition(ctx.orderStatus, "CONFIRMED")) {
        return {
          action,
          status: "skipped",
          description: `Confirm order — skipped, order is ${ctx.orderStatus} and cannot move to CONFIRMED.`,
          reason: "invalid_transition",
        };
      }
      return { action, status: mode, description: `Confirm order ${ctx.orderNo ?? ctx.orderId ?? ""} (PENDING -> CONFIRMED).` };
    }
    case "assign_courier":
      return { action, status: mode, description: `Assign courier ${action.courier} to order ${ctx.orderNo ?? ctx.orderId ?? ""}.` };
    case "send_sms":
      return {
        action,
        status: mode,
        description:
          mode === "applied"
            ? `Send SMS (template ${action.templateKey}) to ${masked ?? "customer"} via the configured SMS provider — dispatched to the automation worker, which records the provider outcome on this effect.`
            : `Would send SMS (template ${action.templateKey}) to ${masked ?? "customer"} — planned only; nothing is sent by a planned run.`,
      };
    case "send_email":
      return {
        action,
        status: mode,
        description:
          mode === "applied"
            ? `Send email (template ${action.templateKey}) for order ${ctx.orderNo ?? ctx.orderId ?? ""} — dispatched to the automation worker, which queues it through the email producer and records the outcome on this effect.`
            : `Would send email (template ${action.templateKey}) for order ${ctx.orderNo ?? ctx.orderId ?? ""} — planned only; nothing is sent by a planned run.`,
      };
    case "add_tag":
      return { action, status: mode, description: `Add tag "${action.tag}" to order ${ctx.orderNo ?? ctx.orderId ?? ""}.` };
    case "remove_tag":
      return { action, status: mode, description: `Remove tag "${action.tag}" from order ${ctx.orderNo ?? ctx.orderId ?? ""}.` };
    case "notify_staff":
      return { action, status: mode, description: `Notify staff: ${action.message}` };
  }
}

/* ------------------------------------------------------------------ */
/* Running rules                                                       */
/* ------------------------------------------------------------------ */

export interface RunOptions {
  /** When true, evaluate only — effects are "planned" descriptions and the caller must not persist or execute them. */
  dryRun: boolean;
  /** Run log id, injected for determinism. */
  runId: string;
}

/**
 * Evaluate one rule against one event. Trigger mismatch is NOT an error:
 * it returns a not_matched run log with an empty trace, so batch callers can
 * log uniformly. Disabled rules are likewise evaluated as not_matched with
 * no effects — enable/disable is the store's/route's state, the engine
 * honours it but never mutates it.
 */
export function runRule(rule: AutomationRule, event: AutomationEvent, opts: RunOptions): AutomationRunLog {
  const ctx = buildRuleContext(event);
  const base: Omit<AutomationRunLog, "status" | "matched" | "trace" | "effects"> = {
    id: opts.runId,
    ruleId: rule.id,
    ruleName: rule.name,
    trigger: event.type,
    dryRun: opts.dryRun,
    evaluatedAt: event.occurredAt,
  };
  if (ctx.orderId !== undefined) base.orderId = ctx.orderId;
  if (ctx.customerPhone !== undefined) base.customerPhoneMasked = maskPhone(ctx.customerPhone);

  if (!rule.enabled || rule.trigger !== event.type) {
    return { ...base, status: "not_matched", matched: false, trace: [], effects: [] };
  }

  const { matched, trace } = evaluateConditions(rule.conditions, ctx);
  if (!matched) {
    return { ...base, status: opts.dryRun ? "dry_run" : "not_matched", matched: false, trace, effects: [] };
  }

  if (rule.delaySeconds > 0 && !opts.dryRun) {
    const executeAfter = new Date(
      new Date(event.occurredAt).getTime() + rule.delaySeconds * 1000,
    ).toISOString();
    return {
      ...base,
      status: "scheduled",
      matched: true,
      trace,
      effects: rule.actions.map((a) => describeAction(a, ctx, "planned")),
      executeAfter,
    };
  }

  const mode = opts.dryRun ? "planned" : "applied";
  return {
    ...base,
    status: opts.dryRun ? "dry_run" : "matched",
    matched: true,
    trace,
    effects: rule.actions.map((a) => describeAction(a, ctx, mode)),
  };
}

/**
 * Batch entry point for an event dispatcher: every rule is evaluated,
 * run logs are returned in input order. The caller persists the logs and,
 * for non-dry-run "matched" entries, enqueues the effects on the
 * "automation-run" BullMQ queue; "scheduled" entries are enqueued with the
 * rule's delay. This function applies nothing itself.
 */
export function processEvent(
  rules: readonly AutomationRule[],
  event: AutomationEvent,
  opts: { dryRun: boolean; runIdFor: (rule: AutomationRule, index: number) => string },
): AutomationRunLog[] {
  return rules.map((rule, i) => runRule(rule, event, { dryRun: opts.dryRun, runId: opts.runIdFor(rule, i) }));
}

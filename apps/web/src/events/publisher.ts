/**
 * Domain Event Publisher — Event-driven bus for Automations, Hooks, and Outbound Webhooks.
 *
 * Implements the domain event integration specified in BACKLOG:
 * - Automation engine: evaluates active rules via processEvent() and records runs
 * - Plugin & extensibility: dispatches to registered hook handlers
 * - Outbound webhooks: dispatches signed payloads to subscribed endpoints
 * - Non-blocking: failures in rules/hooks/webhooks are logged and never block
 *   the calling domain transaction.
 */
import type { DomainEvent, HookEventPayload } from "../extensibility/types";

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
import { demoHookRegistry } from "../extensibility/registry";
import { webhookSubscriptionStore } from "../extensibility/db-store";
import { signWebhookPayload, webhookHeaders, subscriptionsForEvent } from "../extensibility/webhooks";
import { automationStore } from "../automation/store";
import { processEvent } from "../automation/engine";
import type { AutomationEvent, AutomationTrigger } from "../automation/types";

export interface PublishDomainEventInput {
  event: DomainEvent;
  entityType: string;
  entityId: string;
  data: Record<string, string | number | boolean | null>;
  occurredAt?: string;
  automationContext?: Partial<AutomationEvent>;
}

export interface PublishResult {
  published: boolean;
  event: DomainEvent;
  hooksDispatched: number;
  automationRulesTriggered: number;
  webhooksSent: number;
}

/** Maps a DomainEvent to an AutomationTrigger */
function toAutomationTrigger(event: DomainEvent): AutomationTrigger | null {
  switch (event) {
    case "order.created":
      return "order.created";
    case "order.status_changed":
    case "order.cancelled":
    case "order.delivered":
    case "order.returned":
      return "order.status_changed";
    case "payment.succeeded":
      return "payment.succeeded";
    case "stock.low":
      return "stock.low";
    case "checkout.abandoned":
      return "checkout.abandoned";
    default:
      return null;
  }
}

/**
 * Publishes a domain event across hooks, automations, and outbound webhooks.
 * Executes safely without failing the caller.
 */
export async function publishDomainEvent(input: PublishDomainEventInput): Promise<PublishResult> {
  const occurredAt = input.occurredAt || new Date().toISOString();
  let hooksDispatched = 0;
  let automationRulesTriggered = 0;
  let webhooksSent = 0;

  // 1. Hook Dispatch
  try {
    const hookPayload: HookEventPayload = {
      event: input.event,
      entityType: input.entityType,
      entityId: input.entityId,
      occurredAt,
      data: input.data,
    };
    const dispatchResults = await demoHookRegistry.dispatch(hookPayload);
    hooksDispatched = dispatchResults.length;
  } catch (err) {
    console.error(`[EventPublisher] Hook dispatch error on ${input.event}:`, err);
  }

  // 2. Automation Engine Processing
  try {
    const trigger = toAutomationTrigger(input.event);
    if (trigger) {
      const allRules = await automationStore.listRules();
      const matchingRules = allRules.filter((r) => r.enabled && r.trigger === trigger);

      if (matchingRules.length > 0) {
        const autoEvent: AutomationEvent = {
          type: trigger,
          occurredAt,
          ...input.automationContext,
        };

        const logs = processEvent(matchingRules, autoEvent, {
          dryRun: false,
          runIdFor: () => generateUUID(),
        });

        for (const log of logs) {
          await automationStore.appendRun(log);
          if (log.status === "matched" || log.status === "scheduled") {
            automationRulesTriggered += 1;
          }
        }
      }
    }
  } catch (err) {
    console.error(`[EventPublisher] Automation engine error on ${input.event}:`, err);
  }

  // 3. Outbound Webhooks Dispatch
  try {
    const subs = await webhookSubscriptionStore.listForEvent(input.event);
    const activeSubs = subscriptionsForEvent(subs, input.event);
    const signingSecret = process.env.WEBHOOK_SIGNING_SECRET || "ae_webhook_default_secret";

    for (const sub of activeSubs) {
      const payloadString = JSON.stringify({
        event: input.event,
        entityType: input.entityType,
        entityId: input.entityId,
        occurredAt,
        data: input.data,
      });

      const signature = signWebhookPayload(signingSecret, occurredAt, payloadString);
      const headers = {
        "Content-Type": "application/json",
        ...webhookHeaders(signature, occurredAt, input.event),
      };

      // Fire outbound HTTP POST (with 5s abort timeout)
      fetch(sub.url, {
        method: "POST",
        headers,
        body: payloadString,
        signal: AbortSignal.timeout(5000),
      }).catch((e) => {
        console.warn(`[EventPublisher] Webhook deliver failed to ${sub.url}:`, e?.message);
      });

      webhooksSent += 1;
    }
  } catch (err) {
    console.error(`[EventPublisher] Webhook query error on ${input.event}:`, err);
  }

  return {
    published: true,
    event: input.event,
    hooksDispatched,
    automationRulesTriggered,
    webhooksSent,
  };
}

/** Convenience publishers */
export async function publishOrderCreated(order: {
  id: string;
  orderNo: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  totalPoisha: number;
  itemCount: number;
  customerPhone: string;
  district?: string;
  division?: string;
  riskScore?: number;
  tags?: string[];
}): Promise<PublishResult> {
  return publishDomainEvent({
    event: "order.created",
    entityType: "order",
    entityId: order.id,
    data: {
      orderNo: order.orderNo,
      totalPoisha: order.totalPoisha,
      itemCount: order.itemCount,
      paymentMethod: order.paymentMethod || "COD",
    },
    automationContext: {
      order: {
        id: order.id,
        orderNo: order.orderNo,
        status: (order.status as any) || "PENDING",
        paymentStatus: (order.paymentStatus as any) || "UNPAID",
        paymentMethod: order.paymentMethod || "COD",
        totalPoisha: order.totalPoisha,
        itemCount: order.itemCount,
        customerPhone: order.customerPhone,
        district: order.district || "Dhaka",
        division: order.division || "Dhaka",
        riskScore: order.riskScore,
        tags: order.tags || [],
      },
    },
  });
}

export async function publishPaymentSucceeded(payment: {
  orderId: string;
  amountPoisha: number;
  method: string;
}): Promise<PublishResult> {
  return publishDomainEvent({
    event: "payment.succeeded",
    entityType: "payment",
    entityId: payment.orderId,
    data: {
      orderId: payment.orderId,
      amountPoisha: payment.amountPoisha,
      method: payment.method,
    },
    automationContext: {
      payment: {
        amountPoisha: payment.amountPoisha,
        method: payment.method,
      },
    },
  });
}

export async function publishStockLow(stock: {
  variantId: string;
  sku: string;
  available: number;
}): Promise<PublishResult> {
  return publishDomainEvent({
    event: "stock.low",
    entityType: "stock",
    entityId: stock.variantId,
    data: {
      sku: stock.sku,
      available: stock.available,
    },
    automationContext: {
      stock,
    },
  });
}

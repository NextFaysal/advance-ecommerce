/**
 * In-process domain-event bus for the admin order feed — Agent 64.
 *
 * HONEST SCOPE — read this before trusting the word "live":
 * This bus lives inside ONE Node.js process. Subscribers receive events
 * published by mutations running in the SAME process (the Next.js server
 * handling both the order routes and GET /api/v1/admin/orders/feed).
 * Events do NOT cross processes, do NOT survive a restart, and are NOT
 * shared between multiple server instances. The SSE feed therefore
 * reports `live: true, transport: "in-process", scope: "single-node"`.
 * That is the truthful single-process version of the feed — it replaces
 * the previous outline stream that emitted `live: false` and no events.
 *
 * REDIS SWAP POINT (when Redis lands with the DB wiring):
 * Only this module changes. `publishOrderEvent` becomes a Redis
 * `PUBLISH` of the same JSON-serialized DomainEvent on channel
 * "orders.events"; `subscribeOrderEvents` becomes a `PSUBSCRIBE` on
 * that channel feeding the same listener signature. The DomainEvent
 * shapes below are the wire contract and must not change, so every
 * publisher and the SSE route stay untouched.
 *
 * PUBLISH POINTS (funnels only — never scattered across route files):
 * - order.created — published ONCE in the public order-create route
 *   (app/api/v1/public/orders/route.ts), immediately after the new
 *   order is stored. The idempotent-replay return and the FRAUD_BLOCKED
 *   return both happen BEFORE that point, so a replay or a blocked
 *   checkout publishes nothing.
 * - order.status_changed — published inside transitionOrder()
 *   (src/orders/state-machine.ts), the single funnel every status
 *   change goes through (admin PATCH, bulk-actions processor, one-click
 *   flow). It fires ONLY on the success branch: an invalid transition,
 *   or a CANCELLED/REFUNDED without a reason, returns { ok: false }
 *   before the publish, so failed transitions emit nothing.
 *   Note: the one-click panel and admin order page are client
 *   components running the state machine on browser-side mock copies;
 *   those publishes land in the browser's own bus instance and never
 *   reach the server feed — correct, because they are not server
 *   mutations. Only server-side transitions reach subscribers.
 *
 * NOT YET WIRED (deliberately not faked):
 * - payment.succeeded — reserved in the feed contract
 *   (src/orders/realtime.ts) but NOT published: today no server-side
 *   mutation marks an ORDER paid. The sandbox webhook mutates payment
 *   ATTEMPT records and the manual-TrxID review returns a paymentStatus
 *   for the caller to apply — neither touches an order record (orders
 *   live in the create route's in-memory store, not shared). Once the
 *   DB lands and those flows update Order.paymentStatus in one place,
 *   add the event to the union below and publish from that funnel.
 * - stock.low — also contract-reserved; publishes from the inventory
 *   stock_movements ledger writer, which is post-DB as well.
 *
 * PAYLOAD SAFETY (same rule as src/jobs/queues.ts): events carry ids,
 * order numbers, amounts, district and statuses ONLY — never a phone
 * number (not even masked — it is simply absent), never a customer
 * name, never an address line, never a secret.
 *
 * NEVER-THROW RULE: publishing must never break an order mutation.
 * Every publish entry point swallows its own errors, and a listener
 * that throws (e.g. an SSE subscriber whose stream is already closed)
 * is dropped from the set immediately — a slow/dead subscriber can
 * never block or fail a publisher. Delivery is synchronous and
 * in-memory, so there is no buffer to fill; the drop-on-error rule is
 * the backpressure guard. (Real buffered backpressure arrives with
 * the Redis swap above.)
 */
import type { OrderStatus } from "./types";

/* ------------------------------------------------------------------ */
/* Event contract — keep in sync with src/orders/realtime.ts           */
/* ------------------------------------------------------------------ */

export interface OrderCreatedEvent {
  type: "order.created";
  orderId: string;
  orderNo: string;
  /** Grand total of the created order, integer poisha. */
  totalPoisha: number;
  /** Shipping district only — no finer address detail leaves the server. */
  district: string;
  at: string;
}

export interface OrderStatusChangedEvent {
  type: "order.status_changed";
  orderId: string;
  orderNo: string;
  from: OrderStatus;
  to: OrderStatus;
  /** Same value as `to` — the stable realtime.ts contract reads `status`. */
  status: OrderStatus;
  at: string;
}

export type DomainEvent = OrderCreatedEvent | OrderStatusChangedEvent;

export type OrderEventListener = (event: DomainEvent) => void;

/* ------------------------------------------------------------------ */
/* Bus                                                                 */
/* ------------------------------------------------------------------ */

const listeners = new Set<OrderEventListener>();

/** Subscribe to domain events. Returns the unsubscribe function;
 *  callers MUST unsubscribe on teardown (the SSE route does so on
 *  client disconnect) or the listener leaks for the process lifetime. */
export function subscribeOrderEvents(listener: OrderEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current subscriber count — used by the SSE route's lifecycle and by
 *  smoke tests to prove unsubscribe leaves no leaked listeners. */
export function orderEventListenerCount(): number {
  return listeners.size;
}

/**
 * Deliver an event to every current subscriber. NEVER throws: a
 * listener that throws is assumed dead (closed stream, broken pipe)
 * and is removed before delivery continues to the rest.
 */
export function publishOrderEvent(event: DomainEvent): void {
  try {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // Dead/slow subscriber: drop it, never block the publisher.
        listeners.delete(listener);
      }
    }
  } catch {
    // Publishing must never throw into the order mutation path.
  }
}

/* ------------------------------------------------------------------ */
/* Typed publish helpers — the only calls publishers should make       */
/* ------------------------------------------------------------------ */

/** Publish order.created for a freshly stored order. Never throws. */
export function publishOrderCreated(order: {
  id: string;
  orderNo: string;
  totalPoisha: number;
  address: { district: string };
}): void {
  try {
    publishOrderEvent({
      type: "order.created",
      orderId: order.id,
      orderNo: order.orderNo,
      totalPoisha: order.totalPoisha,
      district: order.address.district,
      at: new Date().toISOString(),
    });
  } catch {
    // Swallowed by design — see NEVER-THROW RULE in the header.
  }
}

/** Publish order.status_changed for a transition that has ALREADY
 *  succeeded. Callers must not call this for a rejected transition.
 *  Never throws. */
export function publishOrderStatusChanged(
  order: { id: string; orderNo: string },
  from: OrderStatus,
  to: OrderStatus,
): void {
  try {
    publishOrderEvent({
      type: "order.status_changed",
      orderId: order.id,
      orderNo: order.orderNo,
      from,
      to,
      status: to,
      at: new Date().toISOString(),
    });
  } catch {
    // Swallowed by design — see NEVER-THROW RULE in the header.
  }
}

/**
 * Webhook payload construction — ADV-26 (doc 22).
 *
 * The emit seam passes ids only; the SAFE public shape is built here,
 * at dispatch time, from the entity row. The discipline is the
 * inverse of the internal payloads: a webhook receiver is a THIRD
 * PARTY, so the payload carries what an integrator needs to react
 * (ids, order number, statuses, totals) and nothing they could use
 * to reach a customer — never a full phone, never an address, never
 * an email, never a name. An entity that has vanished between emit
 * and dispatch yields `{ id }` alone rather than an error: the
 * delivery record stays truthful ("this event fired for this id").
 */
import { prisma } from "@advance-ecommerce/db";
import type { WebhookEventName } from "./events";

export interface WebhookPayload {
  id: string; // the WebhookDelivery id — receivers dedupe on it
  event: WebhookEventName;
  createdAt: string; // ISO — when the delivery was created
  data: Record<string, unknown>;
}

async function orderData(orderId: string): Promise<Record<string, unknown>> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNo: true,
      status: true,
      paymentStatus: true,
      totalPoisha: true,
      createdAt: true,
      _count: { select: { items: true } },
    },
  });
  if (!order) return { id: orderId };
  return {
    id: order.id,
    orderNo: order.orderNo,
    status: order.status,
    paymentStatus: order.paymentStatus,
    totalPoisha: order.totalPoisha,
    itemCount: order._count.items,
    createdAt: order.createdAt.toISOString(),
  };
}

async function abandonedData(checkoutId: string): Promise<Record<string, unknown>> {
  const row = await prisma.abandonedCheckout.findUnique({
    where: { id: checkoutId },
    select: { id: true, subtotalPoisha: true, itemsJson: true, status: true, createdAt: true },
  });
  if (!row) return { id: checkoutId };
  return {
    id: row.id,
    subtotalPoisha: row.subtotalPoisha,
    itemCount: Array.isArray(row.itemsJson) ? row.itemsJson.length : 0,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

async function stockData(variantId: string): Promise<Record<string, unknown>> {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, sku: true, stock: true, productId: true },
  });
  if (!variant) return { variantId };
  return {
    variantId: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    available: variant.stock,
  };
}

async function customerData(customerId: string): Promise<Record<string, unknown>> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, createdAt: true },
  });
  if (!customer) return { customerId };
  return { customerId: customer.id, registeredAt: customer.createdAt.toISOString() };
}

/** Build the `data` block for an event. Never throws on a missing entity. */
export async function buildWebhookEventData(
  event: WebhookEventName,
  entityId: string | null,
): Promise<Record<string, unknown>> {
  if (entityId === null || entityId === "") return {};
  switch (event) {
    case "order.created":
    case "order.status_changed":
    case "payment.succeeded":
      return orderData(entityId);
    case "checkout.abandoned":
      return abandonedData(entityId);
    case "stock.low":
      return stockData(entityId);
    case "customer.registered":
      return customerData(entityId);
    case "webhook.test":
      return { test: true, entityId };
  }
}

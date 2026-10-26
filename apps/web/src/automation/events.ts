/**
 * Automation event builder — ADV-7 (doc 22). Moved out of
 * src/jobs/runners.ts so the runner AND any future dispatcher share
 * ONE mapping from (trigger, entityId) to the AutomationEvent the
 * engine evaluates. Entity ids only cross the queue; every field the
 * engine matches on is loaded here, from the DB, at execution time —
 * which is what makes delayed (scheduled) rules honest: a rule that
 * fires 30 minutes later evaluates the entity as it is THEN, not as
 * it was when the event was emitted.
 *
 * entityId is an order id or orderNo for order/payment triggers, a
 * variant id for stock.low, an AbandonedCheckout id for
 * checkout.abandoned, and a Customer id for customer.registered.
 *
 * checkout.abandoned history: this branch used to read prisma.cart —
 * but the storefront cart is browser-local (localStorage) and nothing
 * ever writes Cart rows; the real capture write is
 * src/checkout/abandoned.ts -> AbandonedCheckout. The branch now reads
 * that table. abandonedMinutes is measured from the capture's
 * lastSeenAt to NOW (execution time): a capture the shopper is still
 * actively editing keeps refreshing lastSeenAt, so a delayed job sees
 * the true idle time.
 */
import { prisma } from "@advance-ecommerce/db";
import { getOrderByIdOrNo } from "../orders/repository";
import type { AutomationEvent, AutomationTrigger } from "./types";
import { addQty } from "../lib/quantity";

export async function buildAutomationEvent(
  trigger: AutomationTrigger,
  entityId: string,
): Promise<AutomationEvent> {
  const occurredAt = new Date().toISOString();
  switch (trigger) {
    case "order.created":
    case "order.status_changed":
    case "payment.succeeded": {
      const order = await getOrderByIdOrNo(entityId);
      if (order === null) throw new Error(`ENTITY_NOT_FOUND:order:${entityId}`);
      const event: AutomationEvent = {
        type: trigger,
        occurredAt,
        order: {
          id: order.id,
          orderNo: order.orderNo,
          status: order.status,
          paymentStatus: order.paymentStatus,
          paymentMethod: order.paymentMethod,
          totalPoisha: order.totalPoisha,
          itemCount: order.items.reduce((sum, item) => addQty(sum, item.quantity), 0),
          customerPhone: order.customerPhone,
          district: order.address.district,
          division: order.address.division,
          ...(order.courier ? { courier: order.courier } : {}),
          riskScore: order.riskScore,
          tags: order.tags,
        },
      };
      if (trigger === "payment.succeeded") {
        // The succeeded amount comes from the Payment row itself —
        // never assumed from the order total. No PAID payment, no
        // payment block: conditions on paymentAmountPoisha then
        // honestly evaluate as not-exists.
        const payment = await prisma.payment.findFirst({
          where: { orderId: order.id, status: "PAID" },
          orderBy: { createdAt: "desc" },
        });
        if (payment !== null) {
          event.payment = {
            amountPoisha: payment.paidPoisha > 0 ? payment.paidPoisha : payment.amountPoisha,
            method: String(payment.method).toLowerCase(),
          };
        }
      }
      return event;
    }
    case "stock.low": {
      const variant = await prisma.productVariant.findUnique({
        where: { id: entityId },
        include: { inventoryItems: true },
      });
      if (variant === null) throw new Error(`ENTITY_NOT_FOUND:variant:${entityId}`);
      const available =
        variant.inventoryItems.length > 0
          ? variant.inventoryItems.reduce(
              (sum, item) => sum + (item.quantityOnHand - item.quantityReserved),
              0,
            )
          : variant.stock;
      return {
        type: trigger,
        occurredAt,
        stock: { variantId: variant.id, sku: variant.sku, available },
      };
    }
    case "checkout.abandoned": {
      const capture = await prisma.abandonedCheckout.findUnique({
        where: { id: entityId },
      });
      if (capture === null) {
        throw new Error(`ENTITY_NOT_FOUND:abandonedCheckout:${entityId}`);
      }
      return {
        type: trigger,
        occurredAt,
        checkout: {
          id: capture.id,
          totalPoisha: capture.subtotalPoisha,
          abandonedMinutes: Math.max(
            0,
            Math.floor((Date.now() - capture.lastSeenAt.getTime()) / 60_000),
          ),
        },
      };
    }
    case "customer.registered": {
      const customer = await prisma.customer.findFirst({
        where: { id: entityId, deletedAt: null },
        select: { id: true, phone: true, tags: true },
      });
      if (customer === null) {
        throw new Error(`ENTITY_NOT_FOUND:customer:${entityId}`);
      }
      return {
        type: trigger,
        occurredAt,
        customer: {
          id: customer.id,
          tags: customer.tags,
          customerPhone: customer.phone,
        },
      };
    }
  }
}

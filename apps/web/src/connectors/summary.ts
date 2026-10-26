/**
 * Safe-summary loader (ADV-25 part 2).
 *
 * The automation seam hands the fan-out an ids-only payload
 * ({ entityId }); this loader expands it into the SAFE summary the
 * channels may see: orderNo, totals, statuses, item count, customer
 * first name line, and the phone ALREADY MASKED. The address, email
 * and full phone never enter a summary, so no channel adapter can
 * leak them by accident.
 *
 * Entity id meaning follows the emit sites: order events carry the
 * Order id; stock.low carries the ProductVariant id (inventory
 * repository emit).
 */
import { maskPhone } from "../checkout/validation";
import type { ConnectorEvent, ConnectorSummary } from "./types";

export async function loadConnectorSummary(
  event: ConnectorEvent,
  entityId: string,
): Promise<ConnectorSummary | null> {
  const { prisma } = await import("@advance-ecommerce/db");

  if (event === "stock.low") {
    const variant = await prisma.productVariant.findUnique({
      where: { id: entityId },
      select: {
        sku: true,
        stock: true,
        product: { select: { titleBn: true, titleEn: true } },
      },
    });
    if (variant === null) return null;
    return {
      kind: "stock",
      stock: {
        sku: variant.sku,
        available: variant.stock,
        productName: variant.product?.titleBn || variant.product?.titleEn,
      },
    };
  }

  const order = await prisma.order.findUnique({
    where: { id: entityId },
    select: {
      orderNo: true,
      customerName: true,
      customerPhone: true,
      totalPoisha: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      _count: { select: { items: true } },
    },
  });
  if (order === null) return null;
  return {
    kind: "order",
    order: {
      orderNo: order.orderNo,
      customerName: order.customerName,
      phoneMasked: maskPhone(order.customerPhone),
      totalPoisha: order.totalPoisha,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      itemCount: order._count.items,
    },
  };
}

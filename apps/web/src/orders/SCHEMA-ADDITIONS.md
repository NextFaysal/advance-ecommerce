# Schema Additions — Orders, Cart & CRM (Agent 4 proposal)

> DO NOT edit `packages/db/prisma/schema.prisma` from this file. This is a
> proposal for the DB/schema owner to merge. Existing Phase 1 models
> (users, roles, permissions, sessions, audit_logs, settings, feature_flags,
> geo) are NOT repeated here except where a relation is needed.
> All money fields are integer poisha. All business tables get
> `deletedAt` (soft delete) + `createdAt`/`updatedAt` + audit logging.

## Cart (guest -> login merge)
- `Cart`: id, userId? (nullable for guest), guestKey? (cookie/device id, unique when guest), couponCode?, expiresAt?, deletedAt, createdAt, updatedAt. Index: userId, guestKey.
- `CartItem`: id, cartId, variantId (FK to product_variants, owner: Catalog agent), quantity Int, unitPricePoisha Int snapshot (server re-validates at checkout). Unique (cartId, variantId).
- Merge rule: on login, guest items merge into the user cart by variantId (quantities add), then the guest cart is cleared. Implemented purely in `src/cart/types.ts:mergeGuestIntoUserCart`.

## Customer (extends the platform Customer concept; do not duplicate User)
- `Customer`: id, name, phone (unique, normalized +8801XXXXXXXXX), email?, tags (String[] or join table — owner's choice), blocked Boolean @default(false), blacklistReason?, deletedAt, createdAt, updatedAt. Index: phone.
- `Address`: id, customerId, label?, division, district, upazila, union?, addressLine, isDefault Boolean. Mirrors `BdAddress` in checkout validation.
- Derived metrics (do NOT store as source of truth if avoidable; compute or cache): totalOrders, deliveredOrders, cancelledOrders, returnedOrders, lifetimeValuePoisha (delivered only), successRate. See `src/orders/customer.ts`.

## Order
- `Order`: id, orderNo String @unique (e.g. ORD-100245, mono font in UI), customerId, customerName snapshot, customerPhone snapshot (normalized), address snapshot (division/district/upazila/union/addressLine as plain fields — order history must survive later address edits), status OrderStatus @default(PENDING), paymentMethod, paymentStatus @default(UNPAID), subtotalPoisha Int, discountPoisha Int, shippingPoisha Int, codFeePoisha Int, taxPoisha Int, totalPoisha Int, courier?, trackingId?, riskScore Int @default(0), assigneeId? (FK users), source? (website/facebook/whatsapp/call/pos), idempotencyKey String @unique (see checkout/idempotency.ts), deletedAt, createdAt, updatedAt. Indexes: customerId, status, paymentStatus, createdAt, idempotencyKey.
- `OrderItem`: id, orderId, variantId, productName snapshot, sku snapshot, unitPricePoisha Int snapshot, quantity Int. Unique/order FK as owner decides.
- `OrderStatusHistory`: id, orderId, from OrderStatus?, to OrderStatus, changedById? (FK users), reason?, createdAt. Index: orderId, createdAt. Every transition writes one row; invalid transitions never write.
- `OrderNote`: id, orderId, authorId?, text, createdAt. Supports @mention in UI; mention notifications are the notifications owner's job.
- `OrderTag`: id, orderId, tag String. Index: tag.

## Payment (summary here; gateway adapters are Agent 5 / payment owner)
- `Payment`: id, orderId, method, amountPoisha Int, status PaymentStatus, providerRef? (TrxID / gateway txn id), senderNumber? (manual mobile banking), approvedById?, approvedAt?, deletedAt, createdAt, updatedAt. Index: orderId, providerRef (for duplicate-TrxID detection — unique where the gateway owner requires it).
- `PaymentAttempt`: id, orderId, method, amountPoisha Int, status, gatewayResponse Json?, createdAt. Webhook/IPN handling must be idempotent on gateway txn id.
- `Refund`: id, orderId, paymentId?, amountPoisha Int, reason, method, status, createdAt.

## Return / exchange
- `Return`: id, orderId, type (RETURN | EXCHANGE), reason, status (REQUESTED | RETURNING | RETURNED | REFUNDED | EXCHANGED), qcNote?, restockDecision?, createdAt, updatedAt. The order status machine already models RETURN_REQUESTED -> RETURNING -> RETURNED -> REFUNDED/EXCHANGED; this table is the operational record behind it.

## Shipment (summary; courier adapters are Agent 5 / courier owner)
- `Shipment`: id, orderId, courier (steadfast/pathao/redx/paperfly/ecourier), trackingId? @unique, status ShipmentStatus (CREATED | PICKED_UP | IN_TRANSIT | OUT_FOR_DELIVERY | DELIVERED | FAILED | RETURNING | RETURNED), codAmountPoisha Int, createdAt, updatedAt.
- `ShipmentEvent`: id, shipmentId, status, rawStatus?, location?, createdAt. Courier webhooks + cron sync append here and map to the order status machine; mapping is the courier owner's table, not duplicated here.

## Enums to add
- `OrderStatus`: PENDING, CONFIRMED, PROCESSING, PACKED, SHIPPED, DELIVERED, FAILED, RETURN_REQUESTED, RETURNING, RETURNED, CANCELLED, REFUNDED, EXCHANGED.
- `PaymentStatus`: UNPAID, PARTIAL, PAID, FAILED, REFUNDED, PARTIALLY_REFUNDED.
- `ShipmentStatus`: as above.
- `PaymentMethod`: cod, bkash, nagad, sslcommerz, aamarpay, shurjopay (+ rocket/upay/stripe/paypal when their adapters land).

## What this agent did NOT do (remains for others)
- Real Prisma migration, real API routes, real payment/courier adapter calls, real SMS sending, real SSE endpoint, real stock reservation transaction. All are listed as wiring checklists in the code comments of this slice.

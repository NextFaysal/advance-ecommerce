# SCHEMA-ADDITIONS.md — Agent 5 proposals (DO NOT edit packages/db/prisma/schema.prisma)

These tables are proposed for the DB owner to add in Steps 19-27. They are not yet
in the Prisma schema, and no migration has been run. Money is integer poisha.
Secrets are never stored in plain text: credential columns here mean an encrypted
reference/value handled by the settings service, never a raw key in a log or API response.

## Payment (Steps 19-20)
- `payments`: id, orderId, method (cod/bkash/nagad/rocket/upay/sslcommerz/aamarpay/shurjopay/stripe/paypal/manual_mobile_banking), status (UNPAID/PARTIAL/PAID/FAILED/REFUNDED/PARTIALLY_REFUNDED), amountPoisha, paidPoisha, gatewayTransactionId (unique per method), createdAt, updatedAt, deletedAt.
- `payment_attempts`: id, paymentId, gatewayTransactionId, status, rawResponseRef (not raw secret payload), idempotencyKey (unique), createdAt.
- `manual_trx_submissions`: id, orderId, method, trxId, senderPhone, amountPoisha, status (pending/approved/rejected), reviewedById, reviewNote, submittedAt. Unique index on (method, trxId) for duplicate detection — a second approval of the same pair must be rejected.
- `refunds`: id, paymentId, amountPoisha, reason, status, createdAt. Invariant: sum(refunds for a payment) <= paidPoisha.

## Courier (Steps 21-22)
- `shipments`: id, orderId, provider (steadfast/pathao/redx/paperfly/ecourier), trackingId (unique), status (CREATED/PICKED_UP/IN_TRANSIT/OUT_FOR_DELIVERY/DELIVERED/FAILED/RETURNING/RETURNED), codAmountPoisha, chargePoisha, weightGrams, labelUrl, createdAt, updatedAt.
- `shipment_events`: id, shipmentId, status, providerRawStatus, occurredAt, idempotencyKey (unique) — webhook replays must not duplicate events.
- `courier_accounts`: id, provider, enabled, mode (sandbox/live), credentialRef (encrypted), createdAt, updatedAt. Admin > Settings > Shipping edits this, not env alone.
- `shipping_zones`: id, name (inside_dhaka/outside_dhaka/district), district (nullable), createdAt.
- `shipping_rates`: id, zoneId, provider, minWeightGrams, maxWeightGrams, chargePoisha, freeAbovePoisha (nullable).

## Notification / integration settings (Steps 26/31, shared with Step 7 settings table)
- Reuse the existing `settings` table (key, value, valueEncrypted, category) with keys listed in
  `src/integrations/settings.ts`. No new table is proposed for provider config itself.
- `notification_logs` (proposed): id, channel (sms/email/in_app), templateKey, recipientRef (masked phone/email), orderId, status (queued/sent/failed), provider, segments, errorRef, createdAt. Never store message bodies containing full phone numbers or secrets in logs.

## Inventory (Steps 23-24, types in src/inventory/)
- `inventory_items`: id, variantId, warehouseId, quantityOnHand, quantityReserved, updatedAt. Invariant: onHand >= 0, reserved <= onHand.
- `stock_movements`: id, variantId, warehouseId, type (see inventory/types.ts), quantityDelta, quantityBefore, quantityAfter, referenceType (order/purchase/adjustment/transfer/return), referenceId, reason, actorId, createdAt. Append-only: never update or delete a movement row; corrections are new movements.
- `warehouses`: id, name, addressRef, isActive, createdAt.
- `purchase_orders` / `suppliers`: proposed in Step 23 detail, not in this base.

## Marketing (Steps 25-27, types in src/marketing/)
- `coupons`: id, code (unique, case-insensitive), type, valuePoisha/valuePercent, minCartPoisha, maxDiscountPoisha, usageLimit, perUserLimit, startsAt, endsAt, productIds/categoryIds/customerGroup (nullable filters), stackable, isActive, createdAt.
- `coupon_usages`: id, couponId, orderId, userId (nullable), discountPoisha, usedAt. Unique per (couponId, orderId).
- `flash_sales`: id, name, startsAt, endsAt, stockCap, soldCount, isActive, createdAt. Invariant: soldCount <= stockCap.
- `campaigns`: id, channel (sms/email), segmentRef, templateKey, scheduledAt, sentCount, deliveredCount, failedCount, costEstimatePoisha (nullable), status, createdAt.

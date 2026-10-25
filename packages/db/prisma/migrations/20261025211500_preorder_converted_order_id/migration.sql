-- Doc 17 batch O9-1: link a fulfilled PreOrder to the real Order it
-- became (fulfilPreorder in apps/web/src/orders/convert.ts). Quotation
-- already carries convertedOrderId; PreOrder had no field to hold the
-- link, so this is the one small additive column for that batch.
ALTER TABLE "PreOrder" ADD COLUMN "convertedOrderId" TEXT;

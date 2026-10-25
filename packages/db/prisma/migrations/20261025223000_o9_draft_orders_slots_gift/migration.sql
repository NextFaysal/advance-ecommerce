-- Doc 17 batch O9-2 (wave 27): draft orders + delivery slot / gift
-- options on real orders.
--
-- DraftOrder parks a half-built manual order (the manual builder used
-- to be submit-or-lose-it). It is NOT an order: it takes no order
-- number, reserves no stock and appears in no order report. The
-- payload is a ManualCreateInput-shaped JSON document; conversion
-- re-runs the payload through createManualOrder, which re-validates
-- variants + prices at conversion time exactly like a fresh manual
-- create — the stored payload is never trusted as priced truth.
--
-- Order.deliverySlot / Order.giftMessage: the Order model has no JSON
-- meta column (API "meta" blocks are composed at read time), so the
-- customer's checkout choices get real columns — deliverySlot stores
-- the slot id from Settings orders.delivery_slots (labels resolve
-- from the setting at display time), giftMessage stores the gift
-- message verbatim (empty string = gift requested, no message;
-- NULL = no gift). No gift-wrap fee exists — there is no charge seam
-- for one, and none is implied by these columns.

-- CreateEnum
CREATE TYPE "DraftOrderStatus" AS ENUM ('OPEN', 'CONVERTED', 'DISCARDED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "deliverySlot" TEXT;
ALTER TABLE "Order" ADD COLUMN "giftMessage" TEXT;

-- CreateTable
CREATE TABLE "DraftOrder" (
    "id" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "totalPreviewPoisha" INTEGER,
    "createdById" TEXT NOT NULL,
    "status" "DraftOrderStatus" NOT NULL DEFAULT 'OPEN',
    "convertedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DraftOrder_status_createdAt_idx" ON "DraftOrder"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "DraftOrder" ADD CONSTRAINT "DraftOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

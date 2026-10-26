-- Restaurant + KDS (ADV-23 vertical 1, doc 23 wave 56): one kitchen
-- ticket per restaurant order. Created inside the order-create
-- transaction when the order carries a validated `restaurant`
-- selection and module.restaurant is ON; the KDS board advances
-- QUEUED -> PREPARING -> READY -> SERVED, and an order cancellation
-- moves a live ticket to CANCELLED. Status/fulfilment are TEXT by
-- design (the Subscription precedent) — allowed values are owned by
-- src/restaurant/selection.ts and enforced at the write seams.

-- CreateTable
CREATE TABLE "KitchenTicket" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fulfilmentType" TEXT NOT NULL,
    "tableLabel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3),

    CONSTRAINT "KitchenTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KitchenTicket_orderId_key" ON "KitchenTicket"("orderId");

-- CreateIndex
CREATE INDEX "KitchenTicket_status_createdAt_idx" ON "KitchenTicket"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "KitchenTicket" ADD CONSTRAINT "KitchenTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

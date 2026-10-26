-- Services + appointment booking (ADV-23 vertical 2, doc 23 wave 56):
-- one booking row per booked order. Created inside the order-create
-- transaction when the order carries a validated `booking` selection
-- and module.services is ON; the admin bookings board advances
-- BOOKED -> COMPLETED / NO_SHOW, and an order cancellation moves a
-- BOOKED row to CANCELLED. serviceDate is the Asia/Dhaka day stored
-- as that day's Dhaka-midnight instant; slotStart/slotEnd are
-- "HH:MM" strings on the merchant's services.config slot grid.
-- Status is TEXT by design (the Subscription/KitchenTicket
-- precedent) — allowed values are owned by src/services/selection.ts
-- and enforced at the write seams.

-- CreateTable
CREATE TABLE "ServiceBooking" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3) NOT NULL,
    "slotStart" TEXT NOT NULL,
    "slotEnd" TEXT NOT NULL,
    "staffLabel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceBooking_orderId_key" ON "ServiceBooking"("orderId");

-- CreateIndex
CREATE INDEX "ServiceBooking_serviceDate_variantId_idx" ON "ServiceBooking"("serviceDate", "variantId");

-- AddForeignKey
ALTER TABLE "ServiceBooking" ADD CONSTRAINT "ServiceBooking_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

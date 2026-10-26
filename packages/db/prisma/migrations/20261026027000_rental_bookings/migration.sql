-- Rental bookings (ADV-23 vertical 3, doc 23 wave 56): one rental
-- row per rental order. Created inside the order-create transaction
-- when the order carries a validated `rental` selection and
-- module.rental is ON; the admin rentals board advances
-- ACTIVE -> RETURNED / OVERDUE, and an order cancellation moves an
-- ACTIVE row to CANCELLED. startDate/endDate are Asia/Dhaka days
-- stored as those days' Dhaka-midnight instants; days is the
-- inclusive day count frozen at order time; depositPoisha is the
-- security deposit frozen at order time (it was charged inside the
-- order total as a rentalDepositPoisha pricing line — the refund
-- on return is a manual admin action in v1). Status is TEXT by
-- design (the Subscription/KitchenTicket/ServiceBooking precedent)
-- — allowed values are owned by src/rental/selection.ts and
-- enforced at the write seams.

-- CreateTable
CREATE TABLE "RentalBooking" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "days" INTEGER NOT NULL,
    "depositPoisha" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalBooking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RentalBooking_orderId_key" ON "RentalBooking"("orderId");

-- CreateIndex
CREATE INDEX "RentalBooking_variantId_startDate_endDate_idx" ON "RentalBooking"("variantId", "startDate", "endDate");

-- AddForeignKey
ALTER TABLE "RentalBooking" ADD CONSTRAINT "RentalBooking_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

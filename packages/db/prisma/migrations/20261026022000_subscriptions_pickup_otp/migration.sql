-- AlterTable: pickup OTP columns (ADV-19 remainder) — a separate code
-- lifecycle from the CONFIRMED-gate otp* columns, hash-only storage.
ALTER TABLE "Order" ADD COLUMN "pickupOtpCodeHash" TEXT;
ALTER TABLE "Order" ADD COLUMN "pickupOtpExpiresAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "pickupOtpAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "pickupOtpVerifiedAt" TIMESTAMP(3);

-- CreateTable: customer subscriptions / auto-replenish (ADV-18 remainder)
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "interval" TEXT NOT NULL DEFAULT 'MONTHLY',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "paymentMethod" TEXT NOT NULL DEFAULT 'cod',
    "division" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "upazila" TEXT NOT NULL,
    "union" TEXT,
    "addressLine" TEXT NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastOrderId" TEXT,
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Subscription_customerId_status_idx" ON "Subscription"("customerId", "status");

-- CreateIndex
CREATE INDEX "Subscription_status_nextRunAt_idx" ON "Subscription"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "Subscription_variantId_idx" ON "Subscription"("variantId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

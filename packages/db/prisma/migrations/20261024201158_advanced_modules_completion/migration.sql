-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "resellerId" TEXT;

-- CreateTable
CREATE TABLE "VendorProduct" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "productName" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "pricePoisha" INTEGER NOT NULL,
    "approval" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "rejectionReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorCommissionLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "grossPoisha" INTEGER NOT NULL,
    "commissionBps" INTEGER NOT NULL,
    "commissionPoisha" INTEGER NOT NULL,
    "vendorEarningPoisha" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorCommissionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorRefund" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "orderId" TEXT,
    "amountPoisha" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "customerId" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendorProduct_vendorId_approval_idx" ON "VendorProduct"("vendorId", "approval");

-- CreateIndex
CREATE INDEX "VendorProduct_variantId_idx" ON "VendorProduct"("variantId");

-- CreateIndex
CREATE INDEX "VendorCommissionLine_vendorId_createdAt_idx" ON "VendorCommissionLine"("vendorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VendorCommissionLine_orderId_vendorId_key" ON "VendorCommissionLine"("orderId", "vendorId");

-- CreateIndex
CREATE INDEX "VendorRefund_vendorId_createdAt_idx" ON "VendorRefund"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorRefund_orderId_idx" ON "VendorRefund"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_customerId_idx" ON "PushSubscription"("customerId");

-- CreateIndex
CREATE INDEX "Order_resellerId_idx" ON "Order"("resellerId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorProduct" ADD CONSTRAINT "VendorProduct_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorProduct" ADD CONSTRAINT "VendorProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorProduct" ADD CONSTRAINT "VendorProduct_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCommissionLine" ADD CONSTRAINT "VendorCommissionLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCommissionLine" ADD CONSTRAINT "VendorCommissionLine_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorRefund" ADD CONSTRAINT "VendorRefund_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorRefund" ADD CONSTRAINT "VendorRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

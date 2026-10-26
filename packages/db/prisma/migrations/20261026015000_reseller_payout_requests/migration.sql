-- CreateTable
CREATE TABLE "ResellerPayoutRequest" (
    "id" TEXT NOT NULL,
    "resellerId" TEXT NOT NULL,
    "amountPoisha" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "accountNote" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResellerPayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResellerPayoutRequest_resellerId_status_idx" ON "ResellerPayoutRequest"("resellerId", "status");

-- AddForeignKey
ALTER TABLE "ResellerPayoutRequest" ADD CONSTRAINT "ResellerPayoutRequest_resellerId_fkey" FOREIGN KEY ("resellerId") REFERENCES "Reseller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

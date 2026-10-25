-- RMA flow (wave 25, doc 17 batch O7): complete the Return model
-- minimally so src/orders/returns.ts can run a real lifecycle —
-- per-line items with a receive-step condition, the lifecycle
-- statuses the flow moves through, the completion's refund link,
-- and a dedicated restock ledger type.

-- AlterEnum
ALTER TYPE "ReturnStatus" ADD VALUE 'APPROVED';
ALTER TYPE "ReturnStatus" ADD VALUE 'REJECTED';
ALTER TYPE "ReturnStatus" ADD VALUE 'RECEIVED';
ALTER TYPE "ReturnStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "ReturnStatus" ADD VALUE 'CLOSED';

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'RETURN_RESTOCK';

-- CreateEnum
CREATE TYPE "ReturnItemCondition" AS ENUM ('RESTOCKABLE', 'DAMAGED');

-- AlterTable
ALTER TABLE "Return" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'admin',
ADD COLUMN     "customerNote" TEXT,
ADD COLUMN     "decisionReason" TEXT,
ADD COLUMN     "actorLabel" TEXT,
ADD COLUMN     "refundId" TEXT;

-- CreateTable
CREATE TABLE "ReturnItem" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "condition" "ReturnItemCondition",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Return_status_idx" ON "Return"("status");

-- CreateIndex
CREATE INDEX "ReturnItem_returnId_idx" ON "ReturnItem"("returnId");

-- CreateIndex
CREATE INDEX "ReturnItem_orderItemId_idx" ON "ReturnItem"("orderItemId");

-- AddForeignKey
ALTER TABLE "Return" ADD CONSTRAINT "Return_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "Return"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

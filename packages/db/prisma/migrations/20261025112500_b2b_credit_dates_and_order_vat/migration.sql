-- AlterTable
ALTER TABLE "B2bCustomer" ADD COLUMN     "oldestDueDate" TIMESTAMP(3),
ADD COLUMN     "tradeLicenseNo" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "vatPoisha" INTEGER,
ADD COLUMN     "vatRateBps" INTEGER;


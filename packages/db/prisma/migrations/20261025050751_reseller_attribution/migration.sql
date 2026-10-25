-- AlterTable
ALTER TABLE "Reseller" ADD COLUMN     "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Reseller_code_key" ON "Reseller"("code");


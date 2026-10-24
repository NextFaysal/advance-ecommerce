-- AlterTable
ALTER TABLE "User" ADD COLUMN     "inviteExpiresAt" TIMESTAMP(3),
ADD COLUMN     "inviteTokenHash" TEXT,
ADD COLUMN     "invitedById" TEXT;

-- CreateIndex
CREATE INDEX "User_inviteTokenHash_idx" ON "User"("inviteTokenHash");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

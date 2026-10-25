-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "advanceRequiredPoisha" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "advanceReason" TEXT,
ADD COLUMN     "advanceSatisfiedAt" TIMESTAMP(3),
ADD COLUMN     "otpAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "otpCodeHash" TEXT,
ADD COLUMN     "otpExpiresAt" TIMESTAMP(3),
ADD COLUMN     "otpVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "requiresOtp" BOOLEAN NOT NULL DEFAULT false;

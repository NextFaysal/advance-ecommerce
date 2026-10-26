-- Staff passkeys / WebAuthn credentials (doc 23 wave 55, staff-first):
-- one row per authenticator a staff member registers for admin
-- sign-in. credentialId + publicKey are public material (the private
-- key never leaves the device); counter tracks the authenticator's
-- signature counter for clone detection. Hand-written in the wave-2
-- style (parent integrates/migrates serially).

-- CreateTable
CREATE TABLE "StaffWebAuthnCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT,
    "deviceLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "StaffWebAuthnCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffWebAuthnCredential_credentialId_key" ON "StaffWebAuthnCredential"("credentialId");

-- CreateIndex
CREATE INDEX "StaffWebAuthnCredential_userId_idx" ON "StaffWebAuthnCredential"("userId");

-- AddForeignKey
ALTER TABLE "StaffWebAuthnCredential" ADD CONSTRAINT "StaffWebAuthnCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

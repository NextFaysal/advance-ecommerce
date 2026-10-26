-- Doc 21 G3-8 (wave W0-D): DB-backed SMS TrxID claim registry.
--
-- Until now the verify-side duplicate-Trx registry was the in-memory
-- demoTrxRegistry (src/bd/sms-autoverify.ts): claims lived in one
-- process's Map and reset on every restart/redeploy, so the same
-- (provider, TrxID) could be verified twice — once per process
-- lifetime. This table is the durable claim log: sms-verify inserts
-- one row on a successful match, and the UNIQUE(method, trxId) index
-- makes the claim atomic (an insert conflict IS the duplicate
-- signal — the verify flow never double-counts money).
--
-- Distinct from the sms_ingestions table: that one dedupes ingestion
-- RECORDS (what SMS arrived); this one records VERIFICATION CLAIMS
-- (which order a TrxID's money was verified for). Ingestion consults
-- this table read-only to flag already-verified TrxIDs.

-- CreateTable
CREATE TABLE "SmsTrxClaim" (
    "id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "trxId" TEXT NOT NULL,
    "orderId" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsTrxClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SmsTrxClaim_method_trxId_key" ON "SmsTrxClaim"("method", "trxId");

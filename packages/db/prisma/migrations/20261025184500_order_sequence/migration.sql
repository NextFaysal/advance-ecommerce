-- CreateTable
CREATE TABLE "OrderSequence" (
    "day" TEXT NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderSequence_pkey" PRIMARY KEY ("day")
);

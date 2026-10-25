-- AlterTable
ALTER TABLE "CallLogEntry" ADD COLUMN     "disposition" TEXT,
ADD COLUMN     "durationSeconds" INTEGER,
ADD COLUMN     "qaComment" TEXT,
ADD COLUMN     "qaScore" INTEGER,
ADD COLUMN     "scriptVersion" TEXT;

-- AlterTable
ALTER TABLE "CallTask" ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "customerPhone" TEXT,
ADD COLUMN     "note" TEXT;

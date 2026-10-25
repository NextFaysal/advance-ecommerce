-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "faqItems" JSONB,
ADD COLUMN     "heightMm" INTEGER,
ADD COLUMN     "lengthMm" INTEGER,
ADD COLUMN     "lowStockThreshold" INTEGER,
ADD COLUMN     "publishAt" TIMESTAMP(3),
ADD COLUMN     "relatedIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "saleEndsAt" TIMESTAMP(3),
ADD COLUMN     "saleStartsAt" TIMESTAMP(3),
ADD COLUMN     "sizeChart" JSONB,
ADD COLUMN     "videoUrl" TEXT,
ADD COLUMN     "weightGrams" INTEGER,
ADD COLUMN     "widthMm" INTEGER;

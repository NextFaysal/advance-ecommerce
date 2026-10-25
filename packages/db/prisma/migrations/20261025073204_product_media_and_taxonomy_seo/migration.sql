-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "description" TEXT;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "seoDescriptionBn" TEXT,
ADD COLUMN     "seoDescriptionEn" TEXT,
ADD COLUMN     "seoTitleBn" TEXT,
ADD COLUMN     "seoTitleEn" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "ogImage" TEXT;

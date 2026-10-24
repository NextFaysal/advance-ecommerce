# SCHEMA-ADDITIONS.md — Catalog tables proposed for Step 8 (DO NOT edit schema.prisma yet)

Owner: Agent 3 (Catalog & Storefront). This is a proposal for the DB owner (Agent 1 / Phase 1 team)
to merge into `packages/db/prisma/schema.prisma` in Step 8. No schema file was edited by Agent 3.

## Proposed models (Prisma sketch)

```prisma
model Category {
  id          String     @id @default(cuid())
  slug        String     @unique
  nameBn      String
  nameEn      String
  parentId    String?
  parent      Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  children    Category[] @relation("CategoryTree")
  imageUrl    String?
  sortOrder   Int        @default(0)
  isActive    Boolean    @default(true)
  deletedAt   DateTime?
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  products    Product[]
}

model Brand {
  id        String    @id @default(cuid())
  name      String    @unique
  slug      String    @unique
  logoUrl   String?
  deletedAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  products  Product[]
}

model Product {
  id              String           @id @default(cuid())
  slug            String           @unique
  titleBn         String
  titleEn         String
  descriptionBn   String           @db.Text
  descriptionEn   String           @db.Text
  categoryId      String
  category        Category         @relation(fields: [categoryId], references: [id])
  brandId         String?
  brand           Brand?           @relation(fields: [brandId], references: [id])
  status          String           @default("DRAFT") // DRAFT | ACTIVE | ARCHIVED
  tags            String[]
  ratingAverage   Float?
  reviewCount     Int              @default(0)
  seoTitleBn      String?
  seoTitleEn      String?
  seoDescriptionBn String?
  seoDescriptionEn String?
  deletedAt       DateTime?
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
  images          ProductImage[]
  variants        ProductVariant[]
  @@index([categoryId])
  @@index([status])
}

model ProductVariant {
  id               String   @id @default(cuid())
  productId        String
  product          Product  @relation(fields: [productId], references: [id])
  // attributes as JSON: { "color": "লাল", "size": "M" } — keeps attribute sets flexible
  attributes       Json
  sku              String   @unique
  barcode          String?  @unique
  pricePoisha      Int      // integer poisha, never float
  compareAtPoisha  Int?
  costPoisha       Int?     // staff-only, never in public API (see types.ts toPublicProduct)
  stock            Int      @default(0)
  imageUrl         String?
  isActive         Boolean  @default(true)
  deletedAt        DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  @@index([productId])
}

model ProductImage {
  id        String   @id @default(cuid())
  productId String
  product   Product  @relation(fields: [productId], references: [id])
  // R2/CDN URL. Upload pipeline must generate WebP + AVIF + thumbnails (Step 9).
  // Store originalUrl separately if re-encode is needed later.
  url       String
  altBn     String
  altEn     String
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
}

model ProductAttribute {
  id        String   @id @default(cuid())
  key       String   @unique // color | size | material
  labelBn   String
  labelEn   String
  values    String[] // allowed values; editor can add new values with approval
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// Later (Step 13, not Step 8):
// model Wishlist { customerId, productId, createdAt, @@unique([customerId, productId]) }
// model Review { productId, customerId, rating, commentBn, commentEn, status, ... }
```

## Swap plan (mock -> Prisma)
1. Add the models above, run `prisma migrate dev` (local only).
2. Create `src/catalog/service.ts` with `getProducts(filter)`, `getProductBySlug(slug)`,
   `getCategories()` using Prisma, mapping rows to `src/catalog/types.ts` shapes,
   stripping `costPoisha` for public callers via `toPublicProduct()`.
3. Replace `MOCK_*` imports in storefront/admin pages with the service.
4. Delete `src/catalog/mock.ts`.
5. Meilisearch indexer (Step 10) reads from the same service and writes
   `MeilisearchProductDocument` (see `search.ts`).

## Notes
- Money: every price/cost field is `Int` poisha. No Decimal/Float for money.
- Soft delete: `deletedAt` on all business models, per Master Prompt.
- Audit: product/variant price + stock changes must write `audit_logs` (Phase 1 table)
  and, for stock, a `stock_movements` ledger row (Step 23) — never a silent direct edit.
- Images: WebP/AVIF + responsive sizes via Next.js `next/image` + R2/CDN in Step 9.
  This skeleton deliberately uses placeholder divs, not fake product photos.

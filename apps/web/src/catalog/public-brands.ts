/**
 * Public brands list (Wave 14-2, doc 16 §P6).
 *
 * Backs GET /api/v1/public/brands and the /shop sidebar. Until now the
 * shop derived its brand facet from the CURRENT RESULT SET (so brands
 * vanished as soon as a filter excluded their products, and a brand
 * whose products were all filtered out could never be discovered).
 * This read is independent of any result set: every live brand that
 * has at least one ACTIVE, non-deleted product, with that count.
 *
 * Talks to Prisma directly (like category-tree.ts / taxonomy-admin.ts)
 * because the catalog repository contract has no brand-list method.
 * DB failures propagate — the route turns them into the standard
 * error shape and the shop page degrades to hiding the facet.
 */
import { prisma } from "@advance-ecommerce/db";

export interface PublicBrand {
  name: string;
  slug: string;
  productCount: number;
}

export async function listPublicBrands(): Promise<PublicBrand[]> {
  const rows = await prisma.brand.findMany({
    where: {
      deletedAt: null,
      products: { some: { deletedAt: null, status: "ACTIVE" } },
    },
    select: {
      name: true,
      slug: true,
      _count: {
        select: { products: { where: { deletedAt: null, status: "ACTIVE" } } },
      },
    },
    orderBy: [{ name: "asc" }],
  });
  return rows
    .map((r) => ({ name: r.name, slug: r.slug, productCount: r._count.products }))
    .filter((b) => b.productCount > 0);
}

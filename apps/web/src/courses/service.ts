/**
 * Courses read models + the ACCESS RULE — ADV-23 vertical 6
 * (doc 23, wave 56) — SERVER ONLY.
 *
 * NO ENROLMENT TABLE (deliberate v1 design): access is DERIVED
 * from orders at read time, on every lesson view. A customer can
 * view a course product's lessons iff they own at least one order
 * that
 *
 *   - belongs to them (Order.customerId) and is not soft-deleted,
 *   - contains an OrderItem whose variantId is on
 *     courses.config.courseVariantIds FOR THAT PRODUCT,
 *   - is PAID in the platform's own sense (below), and
 *   - has not been reversed (below).
 *
 * "PAID" reuses the definition the wave-15 digital fulfilment
 * machinery already runs on: runDigitalFulfilmentForOrder
 * (src/catalog/product-types.ts) fires only when markOrderPayment
 * (src/orders/repository.ts — THE order-paid funnel) moves an
 * order INTO PaymentStatus PAID, i.e. net paid >= total after the
 * funnel's recomputation from Payment + APPROVED manual-Trx +
 * money-moved Refund rows. So:
 *
 *   paid  := paymentStatus = "PAID" OR status = "DELIVERED"
 *
 * The DELIVERED arm covers the hand-over-completed paths (a
 * delivered COD order is a completed sale even while its
 * remittance bookkeeping settles); a course is a DIGITAL product
 * bought through the ordinary checkout, so in practice prepaid
 * orders grant access the moment they turn PAID — before any
 * physical delivery step, exactly like download grants.
 *
 * REVERSAL — derived, never cached, so it is always current:
 *   - status IN (CANCELLED, RETURNED, REFUNDED) kills access;
 *   - paymentStatus = REFUNDED kills access (the funnel derives it
 *     the moment money-moved refunds reach the gross paid amount —
 *     a gateway refund confirmation path persists the Refund row
 *     and re-runs markOrderPayment, so the very next lesson view
 *     is refused);
 *   - paymentStatus = PARTIALLY_REFUNDED also kills access in v1
 *     (conservative: refund attribution is order-level money, the
 *     platform does not prove WHICH line a partial refund belongs
 *     to, so a partially-refunded course order does not keep
 *     access — a merchant who refunds an unrelated line of a
 *     multi-item order can re-grant by resolving the refund; this
 *     is stated plainly in the admin UI copy).
 *
 * KNOWN LIMIT (stated, not hidden): derivation cannot un-see
 * content — a buyer who read a text lesson before refunding has
 * read it. What derivation DOES guarantee is that the moment an
 * order is refunded/returned, every SUBSEQUENT view is refused.
 * Progress tracking / certificates would need a real enrolment
 * table; that is the named v2 step (see the module report).
 *
 * Guest checkout note: checkout claims/creates the Customer row by
 * phone and the account registration flow claims that same row, so
 * a course bought as a guest appears under the account the buyer
 * later registers with the same number — nothing extra to wire.
 */
import { prisma } from "@advance-ecommerce/db";
import type { OrderStatus, PaymentStatus } from "@/orders/types";
import { isCourseVariantId, loadCoursesConfig, type CoursesConfig } from "./config";
import { loadCourseContent, toCourseOutline, type CourseOutline } from "./content";
import { coursesEnabled } from "./flags";

/** Same variant-label rule as the boxes/subscription services
 *  (attributes values joined, else the standard label). */
function variantLabel(attributes: unknown): string {
  if (typeof attributes === "object" && attributes !== null && !Array.isArray(attributes)) {
    const values = Object.values(attributes as Record<string, unknown>)
      .map((v) => (typeof v === "string" ? v : ""))
      .filter((v) => v !== "");
    if (values.length > 0) return values.join(" / ");
  }
  return "স্ট্যান্ডার্ড";
}

/* ------------------------------------------------------------------ */
/* Course product resolution (config list -> real catalog)           */
/* ------------------------------------------------------------------ */

export interface CourseProductRef {
  productId: string;
  productName: string;
  slug: string;
  /** The listed variants of this product that still exist. */
  variantIds: string[];
}

/** Resolve the configured course variants to their products.
 *  Listed variants that were deleted simply drop out (they grant
 *  nothing and list nowhere). */
export async function resolveCourseProducts(
  config: CoursesConfig,
): Promise<CourseProductRef[]> {
  if (config.courseVariantIds.length === 0) return [];
  const rows = await prisma.productVariant.findMany({
    where: { id: { in: config.courseVariantIds }, deletedAt: null, product: { deletedAt: null } },
    select: {
      id: true,
      productId: true,
      product: { select: { titleBn: true, slug: true } },
    },
  });
  const byProduct = new Map<string, CourseProductRef>();
  for (const row of rows) {
    const existing = byProduct.get(row.productId);
    if (existing) {
      existing.variantIds.push(row.id);
    } else {
      byProduct.set(row.productId, {
        productId: row.productId,
        productName: row.product.titleBn,
        slug: row.product.slug,
        variantIds: [row.id],
      });
    }
  }
  return [...byProduct.values()];
}

/** The listed variant ids belonging to ONE product (empty = the
 *  product is not a course product). */
export async function getCourseVariantIdsForProduct(
  productId: string,
  config?: CoursesConfig,
): Promise<string[]> {
  const cfg = config ?? (await loadCoursesConfig()).config;
  if (cfg.courseVariantIds.length === 0) return [];
  const rows = await prisma.productVariant.findMany({
    where: { id: { in: cfg.courseVariantIds }, productId, deletedAt: null },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/* ------------------------------------------------------------------ */
/* The access rule                                                   */
/* ------------------------------------------------------------------ */

const REVERSED_ORDER_STATUSES: OrderStatus[] = ["CANCELLED", "RETURNED", "REFUNDED"];
const REVERSED_PAYMENT_STATUSES: PaymentStatus[] = ["REFUNDED", "PARTIALLY_REFUNDED"];

/** The Prisma where-fragment implementing the access rule for a
 *  set of variant ids — ONE definition, used by the boolean check
 *  and the course list so they can never drift. */
function courseAccessOrderWhere(customerId: string, variantIds: string[]) {
  return {
    customerId,
    deletedAt: null,
    status: { notIn: REVERSED_ORDER_STATUSES },
    paymentStatus: { notIn: REVERSED_PAYMENT_STATUSES },
    OR: [
      { paymentStatus: "PAID" as PaymentStatus },
      { status: "DELIVERED" as OrderStatus },
    ],
    items: { some: { variantId: { in: variantIds } } },
  };
}

/** True iff the customer currently has access to the product's
 *  course (see the header for the exact rule). Server-side; the
 *  player calls this on EVERY view — nothing is cached. */
export async function customerHasCourseAccess(
  customerId: string,
  productId: string,
): Promise<boolean> {
  const variantIds = await getCourseVariantIdsForProduct(productId);
  if (variantIds.length === 0) return false;
  const order = await prisma.order.findFirst({
    where: courseAccessOrderWhere(customerId, variantIds),
    select: { id: true },
  });
  return order !== null;
}

export interface CustomerCourse {
  productId: string;
  productName: string;
  slug: string;
  /** The order that first granted access (earliest qualifying). */
  orderNo: string;
  grantedAt: string;
  outline: CourseOutline | null;
}

/** Every course the customer currently has access to ("আমার
 *  কোর্স"), most recently granted first. Refunded/returned orders
 *  drop out automatically — the list is the access rule, read
 *  fresh. */
export async function listCustomerCourses(customerId: string): Promise<CustomerCourse[]> {
  const loaded = await loadCoursesConfig();
  if (loaded.config.courseVariantIds.length === 0) return [];
  const orders = await prisma.order.findMany({
    where: courseAccessOrderWhere(customerId, loaded.config.courseVariantIds),
    orderBy: { createdAt: "asc" },
    select: {
      orderNo: true,
      createdAt: true,
      items: {
        where: { variantId: { in: loaded.config.courseVariantIds } },
        select: {
          variantId: true,
          variant: { select: { productId: true, product: { select: { titleBn: true, slug: true } } } },
        },
      },
    },
  });
  const byProduct = new Map<string, CustomerCourse>();
  for (const order of orders) {
    for (const item of order.items) {
      const productId = item.variant.productId;
      if (byProduct.has(productId)) continue;
      byProduct.set(productId, {
        productId,
        productName: item.variant.product.titleBn,
        slug: item.variant.product.slug,
        orderNo: order.orderNo,
        grantedAt: order.createdAt.toISOString(),
        outline: null,
      });
    }
  }
  const courses = [...byProduct.values()];
  for (const course of courses) {
    course.outline = toCourseOutline(await loadCourseContent(course.productId));
  }
  return courses.reverse();
}

/* ------------------------------------------------------------------ */
/* PDP outline                                                       */
/* ------------------------------------------------------------------ */

/** PDP data for a product — null unless the courses flag is ON
 *  AND one of the product's variants is a listed course variant
 *  AND a content doc exists (the getBoxPdpData contract: ~zero
 *  cost while off, and no section for a course with no authored
 *  content yet). The outline carries TITLES ONLY — see
 *  toCourseOutline. */
export async function getCoursePdpData(
  productId: string,
  variantIds: string[],
): Promise<CourseOutline | null> {
  if (!coursesEnabled()) return null;
  const loaded = await loadCoursesConfig();
  if (!variantIds.some((id) => isCourseVariantId(loaded.config, id))) return null;
  return toCourseOutline(await loadCourseContent(productId));
}

/* ------------------------------------------------------------------ */
/* Admin summaries                                                   */
/* ------------------------------------------------------------------ */

export interface CourseVariantSummary {
  variantId: string;
  sku: string;
  variantLabel: string;
}

export interface CourseProductSummary {
  productId: string;
  productName: string | null;
  slug: string | null;
  variants: CourseVariantSummary[];
  hasContent: boolean;
  moduleCount: number;
  lessonCount: number;
}

/** The configured course products with their listed variants +
 *  content status — the admin content editor's product picker. */
export async function listCourseProductSummaries(): Promise<CourseProductSummary[]> {
  const loaded = await loadCoursesConfig();
  const refs = await resolveCourseProducts(loaded.config);
  const summaries: CourseProductSummary[] = [];
  for (const ref of refs) {
    const [variants, doc] = await Promise.all([
      prisma.productVariant.findMany({
        where: { id: { in: ref.variantIds } },
        select: { id: true, sku: true, attributes: true },
      }),
      loadCourseContent(ref.productId),
    ]);
    const outline = toCourseOutline(doc);
    summaries.push({
      productId: ref.productId,
      productName: ref.productName,
      slug: ref.slug,
      variants: variants.map((v) => ({
        variantId: v.id,
        sku: v.sku,
        variantLabel: variantLabel(v.attributes),
      })),
      hasContent: doc !== null,
      moduleCount: outline?.modules.length ?? 0,
      lessonCount: outline?.totalLessons ?? 0,
    });
  }
  return summaries;
}

/** One product's storefront identity for the player page — null
 *  when the product does not exist / is deleted. */
export async function getCourseProductIdentity(productId: string): Promise<{
  productId: string;
  productName: string;
  slug: string;
  isCourseProduct: boolean;
} | null> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, titleBn: true, slug: true, deletedAt: true },
  });
  if (product === null || product.deletedAt !== null) return null;
  const variantIds = await getCourseVariantIdsForProduct(productId);
  return {
    productId: product.id,
    productName: product.titleBn,
    slug: product.slug,
    isCourseProduct: variantIds.length > 0,
  };
}

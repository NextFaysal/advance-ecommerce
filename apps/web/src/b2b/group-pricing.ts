/**
 * B2B group pricing — ADV-14 remainder (doc 22).
 *
 * Server-only (imports the Prisma client).
 *
 * STORAGE: ONE Setting JSON document, key `b2b.groups`:
 *   { groups: [{ id, name, discountBps }],
 *     assignments: { [b2bCustomerId]: groupId },
 *     overrides:   { [groupId]: { [variantId]: pricePoisha } } }
 * No schema change (this wave's constraint). The doc is machine-shaped,
 * so it bypasses the generic settings API — which rejects unregistered
 * keys by design — and is written directly over prisma.setting with
 * category "b2b", the house pattern for Setting docs (team docs,
 * warehouse pick lists, security IP rules). A missing/corrupt doc
 * parses to the EMPTY doc: no groups, catalogue prices — pricing never
 * throws into a buyer flow.
 *
 * RESOLUTION (one rule, applied everywhere below):
 *   effective = group override for (buyer's group, variant), if set;
 *   else catalogue price − group discountBps (integer floor math,
 *   the codebase's bps convention);
 *   else the catalogue price (no group assigned).
 * Wholesale tier lists (WholesalePriceList in types.ts) are a separate,
 * older pure input with no persistence and are NOT consulted here.
 *
 * WHERE IT APPLIES: the B2B portal price list (portal.ts consumers +
 * GET /api/v1/public/account/b2b/products) and the lines snapshotted
 * into buyer-submitted quotation requests (src/b2b/requests.ts).
 * WHERE IT DELIBERATELY DOES NOT: retail checkout/cart, POS, staff-
 * created quotations (staff type the contract price themselves), and
 * conversions — convertQuotation never re-prices a quotation.
 */
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import type {
  B2bGroupsDoc,
  B2bPortalPriceList,
  B2bPortalProductVariant,
  B2bPriceGroup,
  B2bResolvedVariantPrice,
} from "./types";

export const B2B_GROUPS_SETTING_KEY = "b2b.groups";

export const EMPTY_B2B_GROUPS_DOC: B2bGroupsDoc = {
  groups: [],
  assignments: {},
  overrides: {},
};

const priceGroupSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, "group id must be letters, digits, '-' or '_'"),
  name: z.string().trim().min(1).max(120),
  discountBps: z.number().int().min(0).max(10_000),
});

export const b2bGroupsDocSchema = z
  .object({
    groups: z.array(priceGroupSchema).max(100),
    assignments: z.record(z.string().min(1), z.string().min(1)),
    overrides: z.record(
      z.string().min(1),
      z.record(z.string().min(1), z.number().int().nonnegative()),
    ),
  })
  .superRefine((doc, ctx) => {
    const groupIds = new Set<string>();
    doc.groups.forEach((group, i) => {
      if (groupIds.has(group.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groups", i, "id"],
          message: `Duplicate group id: ${group.id}`,
        });
      }
      groupIds.add(group.id);
    });
    for (const [customerId, groupId] of Object.entries(doc.assignments)) {
      if (!groupIds.has(groupId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["assignments", customerId],
          message: `Assignment references unknown group: ${groupId}`,
        });
      }
    }
    for (const groupId of Object.keys(doc.overrides)) {
      if (!groupIds.has(groupId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["overrides", groupId],
          message: `Overrides reference unknown group: ${groupId}`,
        });
      }
    }
  });

/** Parse a stored doc; anything unreadable degrades to the empty doc. */
export function parseB2bGroupsDoc(raw: string | null | undefined): B2bGroupsDoc {
  if (raw === null || raw === undefined || raw.trim() === "") return EMPTY_B2B_GROUPS_DOC;
  try {
    const parsed = b2bGroupsDocSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_B2B_GROUPS_DOC;
  } catch {
    return EMPTY_B2B_GROUPS_DOC;
  }
}

export async function readB2bGroupsDoc(): Promise<B2bGroupsDoc> {
  const row = await prisma.setting.findUnique({ where: { key: B2B_GROUPS_SETTING_KEY } });
  return parseB2bGroupsDoc(row?.value);
}

export async function writeB2bGroupsDoc(doc: B2bGroupsDoc, actorId: string): Promise<void> {
  const value = JSON.stringify(doc);
  await prisma.setting.upsert({
    where: { key: B2B_GROUPS_SETTING_KEY },
    create: {
      key: B2B_GROUPS_SETTING_KEY,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "b2b",
      description: "B2B group pricing (JSON, ADV-14): groups, customer assignments, per-variant price overrides",
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
}

/**
 * Referential integrity against the live catalogue/accounts: every
 * assignment key must be a real (non-deleted) B2bCustomer and every
 * override key a real (non-deleted) ProductVariant. Returns ALL
 * problems (empty = writable); group-internal references are already
 * covered by the zod schema above.
 */
export async function validateB2bGroupsDocReferences(doc: B2bGroupsDoc): Promise<string[]> {
  const problems: string[] = [];
  const customerIds = Object.keys(doc.assignments);
  if (customerIds.length > 0) {
    const found = await prisma.b2bCustomer.findMany({
      where: { id: { in: customerIds }, deletedAt: null },
      select: { id: true },
    });
    const foundIds = new Set(found.map((c) => c.id));
    for (const id of customerIds) {
      if (!foundIds.has(id)) problems.push(`Assignment references unknown B2B customer: ${id}`);
    }
  }
  const variantIds = [...new Set(Object.values(doc.overrides).flatMap((m) => Object.keys(m)))];
  if (variantIds.length > 0) {
    const found = await prisma.productVariant.findMany({
      where: { id: { in: variantIds }, deletedAt: null },
      select: { id: true },
    });
    const foundIds = new Set(found.map((v) => v.id));
    for (const id of variantIds) {
      if (!foundIds.has(id)) problems.push(`Override references unknown variant: ${id}`);
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* Resolver (pure)                                                     */
/* ------------------------------------------------------------------ */

export function assignedB2bGroup(
  doc: B2bGroupsDoc,
  b2bCustomerId: string,
): B2bPriceGroup | null {
  const groupId = doc.assignments[b2bCustomerId];
  if (!groupId) return null;
  return doc.groups.find((g) => g.id === groupId) ?? null;
}

/** Catalogue price after a bps discount — floor math, never negative. */
export function discountedPricePoisha(cataloguePricePoisha: number, discountBps: number): number {
  if (discountBps <= 0) return cataloguePricePoisha;
  if (discountBps >= 10_000) return 0;
  return Math.floor((cataloguePricePoisha * (10_000 - discountBps)) / 10_000);
}

export function resolveB2bVariantPrice(
  doc: B2bGroupsDoc,
  b2bCustomerId: string,
  variant: { id: string; pricePoisha: number },
): B2bResolvedVariantPrice {
  const group = assignedB2bGroup(doc, b2bCustomerId);
  if (group === null) {
    return {
      variantId: variant.id,
      cataloguePricePoisha: variant.pricePoisha,
      effectivePricePoisha: variant.pricePoisha,
      pricingSource: "catalogue",
      group: null,
      discountBpsApplied: 0,
    };
  }
  const override = doc.overrides[group.id]?.[variant.id];
  if (override !== undefined) {
    return {
      variantId: variant.id,
      cataloguePricePoisha: variant.pricePoisha,
      effectivePricePoisha: override,
      pricingSource: "override",
      group,
      discountBpsApplied: 0,
    };
  }
  return {
    variantId: variant.id,
    cataloguePricePoisha: variant.pricePoisha,
    effectivePricePoisha: discountedPricePoisha(variant.pricePoisha, group.discountBps),
    pricingSource: group.discountBps > 0 ? "group_discount" : "catalogue",
    group,
    discountBpsApplied: group.discountBps,
  };
}

/* ------------------------------------------------------------------ */
/* Portal price list                                                   */
/* ------------------------------------------------------------------ */

function attributesLabel(attributes: unknown): string {
  if (attributes === null || typeof attributes !== "object" || Array.isArray(attributes)) return "";
  return Object.entries(attributes as Record<string, unknown>)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

/**
 * The portal's product/price display: ACTIVE, live (publishAt gate —
 * the same public-visibility rule as the storefront), non-deleted
 * products and their active variants, each priced for THIS buyer.
 * Cost is never selected, so it can never leak into the payload.
 */
export async function listB2bPortalPriceList(
  b2bCustomerId: string,
  pageSize = 100,
): Promise<B2bPortalPriceList> {
  const doc = await readB2bGroupsDoc();
  const group = assignedB2bGroup(doc, b2bCustomerId);
  const now = new Date();
  const products = await prisma.product.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      OR: [{ publishAt: null }, { publishAt: { lte: now } }],
    },
    orderBy: { updatedAt: "desc" },
    take: pageSize,
    select: {
      id: true,
      slug: true,
      titleBn: true,
      titleEn: true,
      priceOnRequest: true,
      variants: {
        where: { isActive: true, deletedAt: null },
        orderBy: { sku: "asc" },
        select: {
          id: true, sku: true, attributes: true, stock: true, pricePoisha: true,
        },
      },
    },
  });
  const out: B2bPortalProductVariant[] = [];
  for (const product of products) {
    for (const variant of product.variants) {
      const resolved = resolveB2bVariantPrice(doc, b2bCustomerId, {
        id: variant.id,
        pricePoisha: variant.pricePoisha,
      });
      out.push({
        productId: product.id,
        productSlug: product.slug,
        productNameBn: product.titleBn,
        productNameEn: product.titleEn,
        variantId: variant.id,
        sku: variant.sku,
        attributesLabel: attributesLabel(variant.attributes),
        stock: variant.stock,
        cataloguePricePoisha: variant.pricePoisha,
        effectivePricePoisha: resolved.effectivePricePoisha,
        pricingSource: resolved.pricingSource,
        priceOnRequest: product.priceOnRequest,
      });
    }
  }
  return { group, products: out };
}

/* ------------------------------------------------------------------ */
/* Admin support                                                       */
/* ------------------------------------------------------------------ */

export interface B2bOverrideVariantOption {
  variantId: string;
  sku: string;
  productNameBn: string;
  productNameEn: string;
  productStatus: string;
  isActive: boolean;
  cataloguePricePoisha: number;
  stock: number;
}

/** Variants an admin may target with an override (any live record —
 *  an override for a temporarily inactive variant is legitimate). */
export async function listB2bOverrideVariantOptions(limit = 500): Promise<B2bOverrideVariantOption[]> {
  const rows = await prisma.productVariant.findMany({
    where: { deletedAt: null, product: { deletedAt: null } },
    orderBy: { sku: "asc" },
    take: limit,
    select: {
      id: true, sku: true, isActive: true, pricePoisha: true, stock: true,
      product: { select: { titleBn: true, titleEn: true, status: true } },
    },
  });
  return rows.map((row) => ({
    variantId: row.id,
    sku: row.sku,
    productNameBn: row.product.titleBn,
    productNameEn: row.product.titleEn,
    productStatus: row.product.status,
    isActive: row.isActive,
    cataloguePricePoisha: row.pricePoisha,
    stock: row.stock,
  }));
}

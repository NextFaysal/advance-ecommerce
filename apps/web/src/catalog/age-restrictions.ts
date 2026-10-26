/**
 * Age-restricted categories — ADV-29 (doc 22), the age gate.
 *
 * Where the data lives: a Settings JSON document, key
 * `catalog.age_restricted_categories`, holding
 * `{ "restrictions": [{ "slug": "<category slug>", "minAge": 18 }] }`
 * (minAge optional per row, default 18). The editor is the card on
 * Settings > Privacy; writes go through the generic audited
 * Settings API like every other document of this kind.
 *
 * What the gate IS — and is NOT: when a cart contains a product
 * from a restricted category, checkout REQUIRES a customer age
 * attestation (a ticked "আমি নিশ্চিত করছি..." box). The
 * attestation is recorded verbatim in the order's create-time note
 * (the house seam — same as the ADV-19 pickup choice and the
 * ADV-22 prescription record). It is a SELF-DECLARATION: no
 * identity document is collected and no birth date is verified,
 * and both the storefront copy and the recorded note say exactly
 * that. The server re-derives the requirement from DB category
 * slugs at submit time (never from the client): an order with a
 * restricted item and no attestation is refused with
 * 400 AGE_ATTESTATION_REQUIRED; there is no bypass.
 *
 * Parsing is tolerant (the pickup-points contract): malformed
 * documents / rows degrade to the usable rows, a DB failure
 * degrades to no restrictions, and this module never throws — a
 * broken config must not take checkout down with it. The DEFAULT
 * is an empty restriction list: nothing is age-gated until the
 * merchant configures it.
 */
import { prisma } from "@advance-ecommerce/db";
import { z } from "zod";
import { getSetting } from "@/lib/settings";

export const AGE_RESTRICTIONS_KEY = "catalog.age_restricted_categories";

/** The serialized document when nothing is configured. Exported so
 *  Settings registration and the admin editor compare against the
 *  same canonical string. */
export const EMPTY_AGE_RESTRICTIONS_JSON = "{\"restrictions\":[]}";

export const DEFAULT_MIN_AGE = 18;

export interface AgeRestriction {
  /** Category slug (Category.slug), matched exactly. */
  slug: string;
  minAge: number;
}

const restrictionRowSchema = z.object({
  slug: z.string().trim().min(1).max(80),
  minAge: z.number().int().min(1).max(120).optional(),
});

const documentSchema = z.object({
  restrictions: z.array(z.unknown()),
});

/**
 * Parse a Settings JSON document into restrictions. Returns [] for
 * anything unusable (not JSON / wrong shape) and drops individual
 * bad rows; duplicate slugs keep the STRICTEST (max) minAge.
 */
export function parseAgeRestrictions(raw: string | null | undefined): AgeRestriction[] {
  if (raw === null || raw === undefined || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const doc = documentSchema.safeParse(parsed);
  if (!doc.success) return [];
  const bySlug = new Map<string, number>();
  for (const row of doc.data.restrictions) {
    const r = restrictionRowSchema.safeParse(row);
    if (!r.success) continue;
    const minAge = r.data.minAge ?? DEFAULT_MIN_AGE;
    const existing = bySlug.get(r.data.slug);
    if (existing === undefined || minAge > existing) bySlug.set(r.data.slug, minAge);
  }
  return Array.from(bySlug.entries()).map(([slug, minAge]) => ({ slug, minAge }));
}

/** Load the configured restrictions. NEVER throws. */
export async function loadAgeRestrictions(): Promise<AgeRestriction[]> {
  try {
    return parseAgeRestrictions(await getSetting(AGE_RESTRICTIONS_KEY));
  } catch {
    return [];
  }
}

/** The strictest restriction matching any of the given category
 *  slugs, or null when none of them is restricted. */
export function strictestRestriction(
  categorySlugs: Iterable<string>,
  restrictions: readonly AgeRestriction[],
): AgeRestriction | null {
  const wanted = new Set(categorySlugs);
  let best: AgeRestriction | null = null;
  for (const r of restrictions) {
    if (!wanted.has(r.slug)) continue;
    if (best === null || r.minAge > best.minAge) best = r;
  }
  return best;
}

export interface AgeGateEvaluation {
  required: boolean;
  /** The strictest applicable min age (null when not required). */
  minAge: number | null;
  /** required && an attestation was submitted. */
  ok: boolean;
}

/** The gate decision the orders route enforces (pure, smoke-tested). */
export function evaluateAgeGate(
  categorySlugs: Iterable<string>,
  restrictions: readonly AgeRestriction[],
  attested: boolean,
): AgeGateEvaluation {
  const match = strictestRestriction(categorySlugs, restrictions);
  if (match === null) return { required: false, minAge: null, ok: true };
  return { required: true, minAge: match.minAge, ok: attested };
}

/** PDP helper: the restriction for ONE product's category slug. */
export async function getAgeRestrictionForCategorySlug(slug: string): Promise<AgeRestriction | null> {
  const restrictions = await loadAgeRestrictions();
  return strictestRestriction([slug], restrictions);
}

/**
 * Checkout helper (drives the age-check endpoint AND is mirrored by
 * the orders route's server-side derivation from variant
 * snapshots): resolve each variant's product category slug from
 * the DB and evaluate the cart as a whole.
 */
export async function evaluateAgeGateForVariants(
  variantIds: readonly string[],
  attested: boolean,
): Promise<AgeGateEvaluation & { restrictedVariantIds: string[] }> {
  if (variantIds.length === 0) return { required: false, minAge: null, ok: true, restrictedVariantIds: [] };
  const restrictions = await loadAgeRestrictions();
  if (restrictions.length === 0) return { required: false, minAge: null, ok: true, restrictedVariantIds: [] };
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: [...variantIds] } },
    select: { id: true, product: { select: { category: { select: { slug: true } } } } },
  });
  const restrictedSlugs = new Set(restrictions.map((r) => r.slug));
  const restrictedVariantIds = variants
    .filter((v) => restrictedSlugs.has(v.product.category.slug))
    .map((v) => v.id);
  const evaluation = evaluateAgeGate(
    variants.map((v) => v.product.category.slug),
    restrictions,
    attested,
  );
  return { ...evaluation, restrictedVariantIds };
}

export const AGE_ATTESTATION_MARKER = "[age-attestation]";

/**
 * The create-time OrderNote lines recording an attestation (bilingual
 * human lines + the machine marker the admin side can scan for).
 * States plainly that this is a self-declaration, NOT verification —
 * the same honesty the prescription record carries.
 */
export function ageAttestationNoteText(minAge: number): string {
  return [
    `বয়স নিশ্চিতকরণ / Age attestation: ক্রেতা নিশ্চিত করেছেন যে তাঁর বয়স কমপক্ষে ${minAge} বছর / the customer confirmed they are at least ${minAge} years old.`,
    "এটি একটি স্ব-ঘোষণা / This is a self-declaration — পরিচয় বা বয়স যাচাই করা হয়নি / identity and age were NOT verified.",
    `${AGE_ATTESTATION_MARKER} minAge=${minAge}`,
  ].join("\n");
}

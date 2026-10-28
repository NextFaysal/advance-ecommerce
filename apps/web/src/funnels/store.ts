// Funnel store — DB-backed (Prisma Funnel table), mirroring the
// landing store's contract (src/landing/store.ts): same envelope
// discipline (stepsJson stores { v: 1, steps }; a bare-array
// stepsJson still reads back as steps), same slug-clash error
// strings, same status-flow shape. Storage: `name` is a real column
// (unlike LandingPage's bilingual title, a funnel name is
// owner-facing only), so no title juggling in the envelope.
//
// Publish validation (doc 34 §3.8) lives here because it needs the
// DB + the live catalog: graph rules (validate.ts) + every step
// page exists + every step page itself passes validateLandingPage
// (the EXISTING landing validator, imported read-only) + every
// bump/upsell offer resolves in the live catalog with its discount
// rule still legal against the live price. The catalog is assembled
// by-id (repo.getProductById per referenced product) — never the
// capped listProducts page — so a funnel referencing product #101+
// validates exactly like one referencing product #1.
import { prisma } from "@advance-ecommerce/db";
import { landingStore } from "@/landing/store";
import { validateLandingPage } from "@/landing/validate";
import type { LandingCatalogProduct, LandingPage } from "@/landing/types";
import { tryCatalogRepository } from "@/catalog/server-read";
import type { Product } from "@/catalog/types";
import type { Funnel, FunnelStatus, FunnelStep, StepOffer } from "./types";
import {
  canTransitionFunnel,
  validateFunnelGraph,
  type FunnelValidationError,
  type FunnelValidationResult,
} from "./validate";

const FUNNEL_STATUSES: readonly string[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];

interface FunnelRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  stepsJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredEnvelope {
  v: 1;
  steps: FunnelStep[];
}

function rowToFunnel(row: FunnelRow): Funnel {
  let steps: FunnelStep[] = [];
  const raw = row.stepsJson;
  if (Array.isArray(raw)) {
    steps = raw as FunnelStep[];
  } else if (raw !== null && typeof raw === "object") {
    steps = ((raw as Partial<StoredEnvelope>).steps ?? []) as FunnelStep[];
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: (FUNNEL_STATUSES.includes(row.status) ? row.status : "DRAFT") as FunnelStatus,
    steps,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function funnelToData(input: Omit<Funnel, "id" | "createdAt" | "updatedAt">) {
  const envelope: StoredEnvelope = { v: 1, steps: input.steps };
  return {
    name: input.name,
    slug: input.slug,
    status: input.status,
    stepsJson: envelope as unknown as object,
  };
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

/** Catalog Product -> the minimal shape the landing validator resolves against. */
function toLandingCatalogProduct(p: Product): LandingCatalogProduct {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    images: p.images.map((i) => ({ url: i.url })),
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      pricePoisha: v.pricePoisha,
      compareAtPoisha: v.compareAtPoisha,
      stock: v.stock,
      isActive: v.isActive,
      imageUrl: v.imageUrl,
      attributes: v.attributes,
    })),
  };
}

/**
 * The live price an offer would charge against, or null when the
 * offer cannot resolve: pinned variant's price when variantId is
 * set, else the first in-stock active variant (the landing
 * convention), else the first active variant.
 */
function liveOfferPricePoisha(offer: StepOffer, catalog: readonly LandingCatalogProduct[]): number | null {
  const product = catalog.find((p) => p.id === offer.productId);
  if (!product) return null;
  if (offer.variantId) {
    return product.variants.find((v) => v.id === offer.variantId)?.pricePoisha ?? null;
  }
  const variant =
    product.variants.find((v) => v.isActive && v.stock > 0) ??
    product.variants.find((v) => v.isActive) ??
    null;
  return variant?.pricePoisha ?? null;
}

/**
 * Full publish validation for a funnel (doc 34 §3.8). Used by
 * setStatus() on the publish transition and by the admin routes
 * when a create/update would land directly on PUBLISHED.
 */
export async function validateFunnelForPublish(
  funnel: Pick<Funnel, "slug" | "name" | "steps">,
  otherSlugs: readonly string[] = [],
): Promise<FunnelValidationResult> {
  const errors: FunnelValidationError[] = [];
  const err = (code: string, messageBn: string, messageEn: string, stepId?: string) =>
    errors.push({ code, messageBn, messageEn, stepId });
  const pushAll = (res: FunnelValidationResult, stepId?: string) => {
    for (const e of res.errors) errors.push(stepId && !e.stepId ? { ...e, stepId } : e);
  };

  pushAll(validateFunnelGraph(funnel, otherSlugs));

  // Resolve every referenced step page (distinct pageIds).
  const pageIds = [...new Set(funnel.steps.map((s) => s.pageId).filter((p) => p.trim()))];
  const pages = new Map<string, LandingPage>();
  for (const pageId of pageIds) {
    const page = await landingStore.get(pageId);
    if (page) {
      pages.set(pageId, page);
    } else {
      const step = funnel.steps.find((s) => s.pageId === pageId);
      err("STEP_PAGE_NOT_FOUND", "ধাপের ল্যান্ডিং পেজটি পাওয়া যায়নি।", "A step's landing page does not exist.", step?.id);
    }
  }

  // Order steps must point at a page carrying a quick_order form.
  for (const step of funnel.steps) {
    if (step.kind !== "order") continue;
    const page = pages.get(step.pageId);
    if (page && !page.sections.some((s) => s.type === "quick_order")) {
      err("ORDER_STEP_NEEDS_QUICK_ORDER", "অর্ডার ধাপের পেজে একটি অর্ডার ফর্ম (quick_order) সেকশন থাকতে হবে।", "The order step's page must carry a quick_order section.", step.id);
    }
  }

  // Assemble the catalog by-id: every product referenced by any
  // step page (product_offer / quick_order sections) plus every
  // funnel offer (bump + upsell/downsell). ACTIVE products only —
  // anything else simply does not resolve, exactly like the public
  // storefront.
  const productIds = new Set<string>();
  for (const page of pages.values()) {
    for (const section of page.sections) {
      if (section.type === "product_offer" || section.type === "quick_order") productIds.add(section.productId);
    }
  }
  for (const step of funnel.steps) {
    if (step.kind === "order" && step.bump) productIds.add(step.bump.productId);
    if (step.kind === "upsell" || step.kind === "downsell") productIds.add(step.offer.productId);
  }
  productIds.delete("");

  const catalog: LandingCatalogProduct[] = [];
  if (productIds.size > 0) {
    const repo = await tryCatalogRepository();
    if (!repo) {
      err("CATALOG_UNAVAILABLE", "ক্যাটালগ ডাটাবেস পাওয়া যাচ্ছে না — প্রকাশ যাচাই করা গেল না।", "Catalog database is not available — publish cannot be verified.");
      return { ok: false, errors };
    }
    for (const productId of productIds) {
      const product = await repo.getProductById(productId).catch(() => null);
      if (product && product.status === "ACTIVE") catalog.push(toLandingCatalogProduct(product));
    }
  }

  // Every step page must itself be publish-ready.
  for (const [pageId, page] of pages) {
    const step = funnel.steps.find((s) => s.pageId === pageId);
    pushAll(validateLandingPage(page, catalog, await landingStore.otherSlugs(page.id)), step?.id);
  }

  // Every funnel offer must resolve, with its discount still legal
  // against the live price (fixed < live price — re-checked again
  // at order time by the funnel runtime).
  for (const step of funnel.steps) {
    const offer: StepOffer | undefined =
      step.kind === "order" ? step.bump : step.kind === "upsell" || step.kind === "downsell" ? step.offer : undefined;
    if (!offer || !offer.productId.trim()) continue; // empty product already flagged by the graph rules
    const price = liveOfferPricePoisha(offer, catalog);
    if (price === null) {
      err("OFFER_NOT_RESOLVABLE", "অফারের পণ্য/ভেরিয়েন্টটি লাইভ ক্যাটালগে পাওয়া যায়নি।", "The offer's product/variant does not resolve in the live catalog.", step.id);
    } else if (offer.discount?.kind === "fixed" && offer.discount.poisha >= price) {
      err("DISCOUNT_EXCEEDS_PRICE", "নির্দিষ্ট ছাড় পণ্যের বর্তমান দামের চেয়ে কম হতে হবে।", "A fixed discount must be below the product's current live price.", step.id);
    }
  }

  return { ok: errors.length === 0, errors };
}

export type FunnelTransitionResult =
  | { ok: true; funnel: Funnel }
  | { ok: false; code: string; messageBn: string; messageEn: string; validation?: FunnelValidationResult };

export class FunnelStore {
  async list(): Promise<Funnel[]> {
    const rows = await prisma.funnel.findMany({ orderBy: { updatedAt: "desc" } });
    return rows.map(rowToFunnel);
  }

  async get(id: string): Promise<Funnel | undefined> {
    const row = await prisma.funnel.findUnique({ where: { id } });
    return row ? rowToFunnel(row) : undefined;
  }

  async getBySlug(slug: string): Promise<Funnel | undefined> {
    const row = await prisma.funnel.findUnique({ where: { slug } });
    return row ? rowToFunnel(row) : undefined;
  }

  /** Only PUBLISHED funnels route publicly — drafts/archived return undefined here. */
  async getPublishedBySlug(slug: string): Promise<Funnel | undefined> {
    const funnel = await this.getBySlug(slug);
    return funnel && funnel.status === "PUBLISHED" ? funnel : undefined;
  }

  async otherSlugs(excludeId?: string): Promise<string[]> {
    const rows = await prisma.funnel.findMany({
      where: excludeId ? { id: { not: excludeId } } : {},
      select: { slug: true },
    });
    return rows.map((r) => r.slug);
  }

  async create(input: Omit<Funnel, "id" | "createdAt" | "updatedAt">): Promise<Funnel> {
    if (await this.getBySlug(input.slug)) throw new Error("slug_already_exists");
    try {
      const row = await prisma.funnel.create({ data: funnelToData(input) });
      return rowToFunnel(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error("slug_already_exists");
      throw e;
    }
  }

  async update(id: string, input: Omit<Funnel, "id" | "createdAt" | "updatedAt">): Promise<Funnel> {
    const existing = await this.get(id);
    if (!existing) throw new Error("funnel_not_found");
    const clash = await this.getBySlug(input.slug);
    if (clash && clash.id !== id) throw new Error("slug_already_exists");
    try {
      const row = await prisma.funnel.update({ where: { id }, data: funnelToData(input) });
      return rowToFunnel(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error("slug_already_exists");
      throw e;
    }
  }

  /** Status transition. Publishing runs full §3.8 validation first. */
  async setStatus(id: string, to: Funnel["status"]): Promise<FunnelTransitionResult> {
    const existing = await this.get(id);
    if (!existing) throw new Error("funnel_not_found");
    if (!canTransitionFunnel(existing.status, to)) {
      return {
        ok: false,
        code: "INVALID_TRANSITION",
        messageBn: `অবস্থা ${existing.status} থেকে ${to}-তে যাওয়া যায় না।`,
        messageEn: `Cannot move from ${existing.status} to ${to}.`,
      };
    }
    if (to === "PUBLISHED") {
      const validation = await validateFunnelForPublish(existing, await this.otherSlugs(id));
      if (!validation.ok) {
        return {
          ok: false,
          code: "VALIDATION_FAILED",
          messageBn: "যাচাই ব্যর্থ — প্রকাশ করা যাচ্ছে না।",
          messageEn: "Validation failed — cannot publish.",
          validation,
        };
      }
    }
    const row = await prisma.funnel.update({ where: { id }, data: { status: to } });
    return { ok: true, funnel: rowToFunnel(row) };
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.funnel.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}

/** Shared DB-backed singleton for the funnel admin API routes (+ the L7 public router). */
export const funnelStore = new FunnelStore();

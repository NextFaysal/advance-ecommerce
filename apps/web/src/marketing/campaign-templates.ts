/**
 * Seasonal campaign templates + exit-intent popup (ADV-17/18 remainders).
 *
 * Two Setting documents (marketing doc store, src/marketing/docs.ts —
 * the spin/experiments pattern; the generic settings API rejects
 * unregistered keys by design, so no settings.ts registration exists):
 *   marketing.campaigns    -> { [presetSlug]: CampaignConfig }
 *   marketing.exit_intent  -> ExitIntentConfig
 *
 * Both surfaces are gated by the existing feature flag
 * `module.marketing_mechanics` (marketingMechanicsEnabled()).
 *
 * HONESTY RULES (codebase convention, not negotiable):
 * - Campaign pages render REAL products resolved live from the
 *   configured source (category / product tag / the live flash sale).
 *   A preset never invents items, prices, discounts or stock claims.
 * - A coupon code is only ever DISPLAYED while the Coupon row exists,
 *   is active and inside its window — validated when the admin saves
 *   AND re-validated at render/read time, so an expired code silently
 *   disappears instead of disappointing a customer at checkout.
 * - A countdown renders only when the admin configured a real end
 *   date (campaign.endsAt, or the live flash sale's own endsAt).
 */
import { z } from "zod";
import {
  readMarketingDoc,
  writeMarketingDoc,
  prismaMarketingDocStore,
  marketingMechanicsEnabled,
  type MarketingDocStore,
} from "./docs";
import { findCouponByCodeDb, getLiveFlashSale } from "./repository";
import {
  listActivePublicProducts,
  listPublicProducts,
} from "@/catalog/server-read";
import type { PublicProduct } from "@/catalog/types";

export { marketingMechanicsEnabled };

export const CAMPAIGNS_DOC_KEY = "marketing.campaigns";
export const EXIT_INTENT_DOC_KEY = "marketing.exit_intent";

/* ------------------------------------------------------------------ */
/* Presets (code-defined; admin fills the slots per install)           */
/* ------------------------------------------------------------------ */

export interface CampaignPreset {
  slug: string;
  nameBn: string;
  nameEn: string;
  headlineBn: string;
  headlineEn: string;
  subBn: string;
  subEn: string;
  /** "R G B" triplet, consumed as rgb(var(--camp-accent)) so the
   *  band flips correctly with the RGB-var theming convention. */
  accentRgb: string;
  /** Preselected product source until the admin picks another. */
  defaultTag: string;
}

export const CAMPAIGN_PRESETS: CampaignPreset[] = [
  {
    slug: "eid",
    nameBn: "ঈদ",
    nameEn: "Eid",
    headlineBn: "ঈদের কেনাকাটা, সবার জন্য",
    headlineEn: "Eid shopping for everyone",
    subBn: "পরিবারের সবার জন্য বাছাই করা ঈদ কালেকশন — সারাদেশে হোম ডেলিভারি, ক্যাশ অন ডেলিভারি সুবিধাসহ।",
    subEn: "A hand-picked Eid collection for the whole family — nationwide home delivery with cash on delivery.",
    accentRgb: "4 120 87",
    defaultTag: "eid",
  },
  {
    slug: "boishakh",
    nameBn: "পহেলা বৈশাখ",
    nameEn: "Pohela Boishakh",
    headlineBn: "পহেলা বৈশাখের রঙিন কালেকশন",
    headlineEn: "A colourful Pohela Boishakh collection",
    subBn: "নতুন বছরের শুরুটা হোক রঙিন — বৈশাখী কালেকশন থেকে বেছে নিন পছন্দের পোশাক ও উপহার।",
    subEn: "Start the new year in colour — pick your favourites from the Boishakh collection.",
    accentRgb: "185 28 28",
    defaultTag: "boishakh",
  },
  {
    slug: "puja",
    nameBn: "দুর্গাপূজা",
    nameEn: "Durga Puja",
    headlineBn: "দুর্গাপূজার বিশেষ কালেকশন",
    headlineEn: "A special Durga Puja collection",
    subBn: "উৎসবের দিনগুলোর জন্য বাছাই করা কালেকশন — নিজের জন্য কিংবা প্রিয়জনকে উপহার দিতে।",
    subEn: "A festive collection for the Puja days — for yourself or as a gift for someone dear.",
    accentRgb: "217 119 6",
    defaultTag: "puja",
  },
  {
    slug: "1111",
    nameBn: "১১.১১",
    nameEn: "11.11",
    headlineBn: "১১.১১ ক্যাম্পেইন কালেকশন",
    headlineEn: "The 11.11 campaign collection",
    subBn: "১১.১১ উপলক্ষে বাছাই করা কালেকশন — স্টক থাকা সাপেক্ষে, অফার শেষ হওয়ার আগেই অর্ডার করুন।",
    subEn: "A curated 11.11 collection — order while the campaign is on and stock lasts.",
    accentRgb: "124 58 237",
    defaultTag: "1111",
  },
];

export function getCampaignPreset(slug: string): CampaignPreset | null {
  return CAMPAIGN_PRESETS.find((p) => p.slug === slug) ?? null;
}

/* ------------------------------------------------------------------ */
/* Config documents                                                    */
/* ------------------------------------------------------------------ */

export const campaignSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("category"), slug: z.string().trim().min(1).max(120) }),
  z.object({ kind: z.literal("tag"), tag: z.string().trim().min(1).max(60) }),
  z.object({ kind: z.literal("flash_sale") }),
]);
export type CampaignSource = z.infer<typeof campaignSourceSchema>;

export const campaignConfigSchema = z.object({
  enabled: z.boolean(),
  headlineBn: z.string().trim().max(160).nullable().default(null),
  headlineEn: z.string().trim().max(160).nullable().default(null),
  subBn: z.string().trim().max(320).nullable().default(null),
  subEn: z.string().trim().max(320).nullable().default(null),
  source: campaignSourceSchema,
  /** Existing Coupon code, or null. Validated at save + at render. */
  couponCode: z.string().trim().max(64).nullable().default(null),
  /** Real campaign end (ISO). The ONLY source of any countdown. */
  endsAt: z.string().datetime().nullable().default(null),
});
export type CampaignConfig = z.infer<typeof campaignConfigSchema>;

export const campaignsDocSchema = z.record(z.string(), campaignConfigSchema);
export type CampaignsDoc = z.infer<typeof campaignsDocSchema>;

export const exitIntentConfigSchema = z.object({
  enabled: z.boolean(),
  headlineBn: z.string().trim().min(1).max(120),
  bodyBn: z.string().trim().min(1).max(400),
  couponCode: z.string().trim().max(64).nullable().default(null),
});
export type ExitIntentConfig = z.infer<typeof exitIntentConfigSchema>;

export const DEFAULT_EXIT_INTENT: ExitIntentConfig = {
  enabled: false,
  headlineBn: "যাওয়ার আগে একবার দেখে যান!",
  bodyBn: "আমাদের কালেকশন থেকে পছন্দের পণ্যটি বেছে নিন — সারাদেশে হোম ডেলিভারি, ক্যাশ অন ডেলিভারি সুবিধা আছে।",
  couponCode: null,
};

export async function loadCampaignsDoc(
  store: MarketingDocStore = prismaMarketingDocStore(),
): Promise<CampaignsDoc> {
  return readMarketingDoc(store, CAMPAIGNS_DOC_KEY, campaignsDocSchema, {});
}

export async function saveCampaignsDoc(
  store: MarketingDocStore,
  doc: CampaignsDoc,
  actorId: string,
): Promise<void> {
  await writeMarketingDoc(store, CAMPAIGNS_DOC_KEY, doc, actorId);
}

export async function loadExitIntentConfig(
  store: MarketingDocStore = prismaMarketingDocStore(),
): Promise<ExitIntentConfig> {
  return readMarketingDoc(store, EXIT_INTENT_DOC_KEY, exitIntentConfigSchema, DEFAULT_EXIT_INTENT);
}

export async function saveExitIntentConfig(
  store: MarketingDocStore,
  config: ExitIntentConfig,
  actorId: string,
): Promise<void> {
  await writeMarketingDoc(store, EXIT_INTENT_DOC_KEY, config, actorId);
}

/* ------------------------------------------------------------------ */
/* Coupon existence / validity                                         */
/* ------------------------------------------------------------------ */

export type CouponState =
  | { ok: true }
  | { ok: false; reason: "not_found" | "inactive" | "not_started" | "expired" };

/** A code may be configured/displayed only while this says ok. */
export async function couponState(code: string, now: Date = new Date()): Promise<CouponState> {
  const coupon = await findCouponByCodeDb(code).catch(() => null);
  if (coupon === null) return { ok: false, reason: "not_found" };
  if (!coupon.isActive) return { ok: false, reason: "inactive" };
  const iso = now.toISOString();
  if (coupon.startsAt && iso < coupon.startsAt) return { ok: false, reason: "not_started" };
  if (coupon.endsAt && iso > coupon.endsAt) return { ok: false, reason: "expired" };
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Product resolution (always REAL catalogue rows)                     */
/* ------------------------------------------------------------------ */

export interface ResolvedCampaign {
  products: PublicProduct[];
  /** Human note about where the products came from (admin/debug). */
  sourceNote: string;
  /** Effective real end instant for a countdown, when one exists:
   *  the configured endsAt, else the live flash sale's own endsAt. */
  effectiveEndsAt: string | null;
}

export async function resolveCampaignProducts(
  config: CampaignConfig,
  limit = 24,
): Promise<ResolvedCampaign> {
  const source = config.source;
  if (source.kind === "category") {
    const { products } = await listPublicProducts({
      categorySlug: source.slug,
      page: 1,
      pageSize: limit,
    }).catch(() => ({ products: [] as PublicProduct[] }));
    return {
      products,
      sourceNote: `category:${source.slug}`,
      effectiveEndsAt: config.endsAt,
    };
  }
  if (source.kind === "tag") {
    const all = await listActivePublicProducts(200).catch(() => [] as PublicProduct[]);
    return {
      products: all.filter((p) => p.tags.includes(source.tag)).slice(0, limit),
      sourceNote: `tag:${source.tag}`,
      effectiveEndsAt: config.endsAt,
    };
  }
  // flash_sale: whatever sale is genuinely live right now.
  const sale = await getLiveFlashSale().catch(() => null);
  if (sale === null) {
    return { products: [], sourceNote: "flash_sale:none-live", effectiveEndsAt: config.endsAt };
  }
  const ids = new Set(sale.items.map((i) => i.productId));
  const all = await listActivePublicProducts(200).catch(() => [] as PublicProduct[]);
  return {
    products: all.filter((p) => ids.has(p.id)).slice(0, limit),
    sourceNote: `flash_sale:${sale.id}`,
    effectiveEndsAt: config.endsAt ?? sale.endsAt,
  };
}

/* ------------------------------------------------------------------ */
/* Public exit-intent payload                                          */
/* ------------------------------------------------------------------ */

export interface PublicExitIntent {
  headlineBn: string;
  bodyBn: string;
  /** Present ONLY while the coupon genuinely validates right now. */
  couponCode: string | null;
}

export async function getPublicExitIntent(): Promise<PublicExitIntent | null> {
  if (!marketingMechanicsEnabled()) return null;
  const config = await loadExitIntentConfig().catch(() => DEFAULT_EXIT_INTENT);
  if (!config.enabled) return null;
  let couponCode: string | null = null;
  if (config.couponCode) {
    const state = await couponState(config.couponCode).catch(
      (): CouponState => ({ ok: false, reason: "not_found" }),
    );
    if (state.ok) couponCode = config.couponCode;
  }
  return { headlineBn: config.headlineBn, bodyBn: config.bodyBn, couponCode };
}

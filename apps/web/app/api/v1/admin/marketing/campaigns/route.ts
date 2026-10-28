import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { z } from "zod";
import { requireAdmin, guardError } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import { marketingMechanicsEnabled, prismaMarketingDocStore } from "@/marketing/docs";
import {
  CAMPAIGN_PRESETS,
  campaignsDocSchema,
  campaignConfigSchema,
  exitIntentConfigSchema,
  loadCampaignsDoc,
  saveCampaignsDoc,
  loadExitIntentConfig,
  saveExitIntentConfig,
  couponState,
  getCampaignPreset,
} from "@/marketing/campaign-templates";
import { listCategories } from "@/catalog/server-read";

export const dynamic = "force-dynamic";

function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Marketing mechanics module is locked for this install." } },
    { status: 403 },
  );
}

const putSchema = z.object({
  campaigns: z.record(z.string(), campaignConfigSchema),
  exitIntent: exitIntentConfigSchema,
  reason: z.string().trim().min(1, "A reason is required."),
});

/** GET — presets, the saved docs, the category picker library, and
 *  the live validity of every configured coupon code (so the admin
 *  sees a code that has since expired, instead of trusting the doc). */
export async function GET() {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!marketingMechanicsEnabled()) return locked();
  const store = prismaMarketingDocStore();
  const [campaigns, exitIntent, categories] = await Promise.all([
    loadCampaignsDoc(store),
    loadExitIntentConfig(store),
    listCategories().catch(() => []),
  ]);
  const codes = new Set<string>();
  for (const cfg of Object.values(campaigns)) if (cfg.couponCode) codes.add(cfg.couponCode);
  if (exitIntent.couponCode) codes.add(exitIntent.couponCode);
  const couponStates: Record<string, unknown> = {};
  for (const code of codes) couponStates[code] = await couponState(code);
  return NextResponse.json({
    data: {
      presets: CAMPAIGN_PRESETS,
      campaigns,
      exitIntent,
      categories: categories.map((c) => {
        const cat = c as unknown as { slug: string; name?: { bn?: string; en?: string } | string };
        return {
          slug: cat.slug,
          label: typeof cat.name === "string" ? cat.name : (cat.name?.bn ?? cat.name?.en ?? cat.slug),
        };
      }),
      couponStates,
    },
  });
}

/** PUT — replace both docs. Reason-required + audited. Every named
 *  coupon must EXIST (active/window is re-checked at display time);
 *  every campaign slug must be a known preset; every category source
 *  must name a real category. One bad entry rejects the whole write —
 *  nothing partial is ever stored. */
export async function PUT(req: Request) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!marketingMechanicsEnabled()) return locked();
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid campaigns payload", details: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const { campaigns, exitIntent, reason } = parsed.data;

  const unknownSlugs = Object.keys(campaigns).filter((slug) => getCampaignPreset(slug) === null);
  if (unknownSlugs.length > 0) {
    return NextResponse.json(
      { error: { code: "UNKNOWN_CAMPAIGN", message: `Unknown campaign slug(s): ${unknownSlugs.join(", ")}` } },
      { status: 400 },
    );
  }

  const categorySlugs = new Set(
    (await listCategories().catch(() => [])).map((c) => (c as unknown as { slug: string }).slug),
  );
  const badCategories: string[] = [];
  for (const [slug, cfg] of Object.entries(campaigns)) {
    if (cfg.source.kind === "category" && !categorySlugs.has(cfg.source.slug)) {
      badCategories.push(`${slug}:${cfg.source.slug}`);
    }
  }
  if (badCategories.length > 0) {
    return NextResponse.json(
      { error: { code: "UNKNOWN_CATEGORY", message: `Unknown category slug(s): ${badCategories.join(", ")}` } },
      { status: 400 },
    );
  }

  const badCoupons: string[] = [];
  const checkCoupon = async (where: string, code: string | null) => {
    if (!code) return;
    const state = await couponState(code);
    if (!state.ok && state.reason === "not_found") badCoupons.push(`${where}:${code}`);
  };
  for (const [slug, cfg] of Object.entries(campaigns)) await checkCoupon(slug, cfg.couponCode);
  await checkCoupon("exitIntent", exitIntent.couponCode);
  if (badCoupons.length > 0) {
    return NextResponse.json(
      {
        error: {
          code: "COUPON_NOT_FOUND",
          message: "Coupon code(s) do not exist — create the coupon first, then reference it.",
          details: badCoupons,
        },
      },
      { status: 400 },
    );
  }

  const store = prismaMarketingDocStore();
  const before = await loadCampaignsDoc(store);
  await saveCampaignsDoc(store, campaignsDocSchema.parse(campaigns), guard.userId);
  await saveExitIntentConfig(store, exitIntent, guard.userId);
  await writeAudit({
    actorId: guard.userId,
    action: "marketing.campaigns.update",
    entityType: "Setting",
    entityId: "marketing.campaigns",
    reason,
    beforeJson: { campaigns: before },
    afterJson: {
      enabledCampaigns: Object.entries(campaigns)
        .filter(([, c]) => c.enabled)
        .map(([slug]) => slug),
      exitIntentEnabled: exitIntent.enabled,
    },
  });
  return NextResponse.json({ data: { campaigns, exitIntent } });
}

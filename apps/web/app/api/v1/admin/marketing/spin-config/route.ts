import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { requireAdmin, guardError } from "@/reports/guard";
import { marketingMechanicsEnabled, prismaMarketingDocStore } from "@/marketing/docs";
import {
  loadSpinConfig,
  saveSpinConfig,
  getSpinDisplayConfig,
  getRecentSpinLog,
  spinConfigSchema,
} from "@/marketing/spin";

export const dynamic = "force-dynamic";

function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Marketing mechanics module is locked for this install." } },
    { status: 403 },
  );
}

/** GET — current config (as saved), the drawable draw customers
 *  actually face (odds over drawable segments), and the recent
 *  spin audit log (Redis, labelled ephemeral). */
export async function GET() {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!marketingMechanicsEnabled()) return locked();
  const store = prismaMarketingDocStore();
  const [config, display, log] = await Promise.all([
    loadSpinConfig(store),
    getSpinDisplayConfig(new Date(), store),
    getRecentSpinLog(50),
  ]);
  return NextResponse.json({
    data: { config, display, recentSpins: log.entries },
    meta: { spinLogBackend: log.backend, spinLogNote: "Redis audit list (ephemeral); awarded Coupon rows are the durable record" },
  });
}

/** PUT — replace the spin config. The schema refuses a config
 *  without a reachable no-prize segment. */
export async function PUT(req: Request) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!marketingMechanicsEnabled()) return locked();
  const parsed = spinConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid spin config", details: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  await saveSpinConfig(prismaMarketingDocStore(), parsed.data, guard.userId);
  return NextResponse.json({ data: { config: parsed.data } });
}

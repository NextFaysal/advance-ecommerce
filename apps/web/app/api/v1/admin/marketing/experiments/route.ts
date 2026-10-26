import { NextResponse } from "next/server";
import { requireAdmin, guardError } from "@/reports/guard";
import { marketingMechanicsEnabled, prismaMarketingDocStore } from "@/marketing/docs";
import {
  loadExperimentsDoc,
  saveExperimentsDoc,
  experimentsDocSchema,
  getExperimentStats,
} from "@/marketing/experiments";

export const dynamic = "force-dynamic";

function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Marketing mechanics module is locked for this install." } },
    { status: 403 },
  );
}

/** GET — experiment definitions plus, when ?stats=<expId> is given,
 *  that experiment's raw per-variant counts (descriptive only). */
export async function GET(req: Request) {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!marketingMechanicsEnabled()) return locked();
  const doc = await loadExperimentsDoc(prismaMarketingDocStore());
  const statsId = new URL(req.url).searchParams.get("stats");
  const stats = statsId !== null && statsId !== "" ? await getExperimentStats(statsId) : null;
  return NextResponse.json({ data: { doc, stats }, meta: { statsNote: "raw counts + descriptive conversion % only — no significance testing" } });
}

/** PUT — replace the whole experiments doc (the editor round-trips
 *  it). At most one hero experiment may be running. */
export async function PUT(req: Request) {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!marketingMechanicsEnabled()) return locked();
  const parsed = experimentsDocSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid experiments doc", details: parsed.error.flatten() } },
      { status: 400 },
    );
  }
  const runningHero = parsed.data.experiments.filter((e) => e.status === "running" && e.target === "hero");
  if (runningHero.length > 1) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Only one hero experiment may run at a time." } },
      { status: 400 },
    );
  }
  await saveExperimentsDoc(prismaMarketingDocStore(), parsed.data, guard.userId);
  return NextResponse.json({ data: { doc: parsed.data } });
}

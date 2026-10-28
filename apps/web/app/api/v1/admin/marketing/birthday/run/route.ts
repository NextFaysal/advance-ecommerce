import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { guardError, requireAdmin } from "@/reports/guard";
import { runBirthdayOffers } from "@/marketing/birthday";
import { recordDemoAudit } from "../../../audit-log/store";

// Birthday offers — admin run-now (schema wave 2, ADV-18 leftover).
// POST: run runBirthdayOffers() immediately (marketing.campaign).
// This is the manual trigger for the daily job until the VPS worker
// ticks it; the run is idempotent (deterministic coupon codes), so
// running it twice — or after the worker already ran — issues
// nothing twice and the response says how many already existed.
// A locked module (module.marketing_mechanics OFF) is reported by
// the service as { status: "skipped", reason: "flag_off" } and
// surfaced as FEATURE_LOCKED rather than a fake empty success.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const result = await runBirthdayOffers(new Date());
  if (result.status === "skipped") {
    return NextResponse.json(
      {
        error: {
          code: "FEATURE_LOCKED",
          message: "Marketing mechanics module is locked for this install (module.marketing_mechanics is OFF).",
        },
      },
      { status: 403 },
    );
  }

  await recordDemoAudit({
    actorId: guard.userId,
    action: "marketing.birthday.run",
    entityType: "Coupon",
    entityId: result.issued[0]?.code ?? null,
    afterJson: {
      windowDays: result.windowDays,
      discountBps: result.discountBps,
      candidates: result.candidates,
      issuedCount: result.issued.length,
      alreadyIssued: result.alreadyIssued,
      issuedCodes: result.issued.map((i) => i.code),
    },
    reason: "Birthday offers run manually from admin.",
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({
    data: result,
    meta: { persistence: "database", module: "module.marketing_mechanics" },
  });
}

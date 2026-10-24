import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { isFlagEnabledDemo, isKnownFlag, listFlagsWithState, setFlagEnabledDemo } from "./store";
import { recordDemoAudit } from "../audit-log/store";

// Feature flags API — Agent 39.
// GET: settings.view. PATCH (toggle): settings.edit.
// The catalogue mirrors seed FEATURE_FLAGS exactly (19 module.* keys, all
// seeded OFF). Enabled state comes from an in-memory demo store — the
// stand-in for the DB flag reader. A toggle REQUIRES an audit reason
// (feature_flags.manage is a sensitive action in src/lib/audit.ts), is
// recorded as an audit entry in the demo store, and honestly returns
// persisted: false with NOT_WIRED meta: nothing here enables a module
// for real until the DB flag table is wired.

export async function GET() {
  const guard = await requireAdmin("settings.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  return NextResponse.json({
    data: { flags: listFlagsWithState() },
    meta: {
      persistence: "in-memory-demo",
      source: "TEMPORARY_DEMO",
      note: "Enabled state is demo-only (all OFF by default, lost on restart). Real state lives in the feature_flags table, seeded OFF.",
    },
  });
}

const toggleSchema = z.object({
  key: z.string().trim().min(1),
  enabled: z.boolean(),
  reason: z.string().trim().min(1, "A reason is required to change a feature flag."),
});

export async function PATCH(req: Request) {
  const guard = await requireAdmin("settings.edit");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const body = await req.json().catch(() => null);
  const parsed = toggleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid flag toggle. key, enabled and a non-empty reason are required.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const { key, enabled, reason } = parsed.data;

  if (!isKnownFlag(key)) {
    return NextResponse.json(
      { error: { code: "UNKNOWN_FLAG", message: `Unknown feature flag: ${key}` } },
      { status: 422 },
    );
  }

  const before = isFlagEnabledDemo(key);
  setFlagEnabledDemo(key, enabled);
  const auditEntry = recordDemoAudit({
    actorId: guard.userId,
    action: "feature_flags.manage",
    entityType: "FeatureFlag",
    entityId: key,
    beforeJson: { enabled: before },
    afterJson: { enabled },
    reason,
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({
    data: { key, enabled, persisted: false, auditEntryId: auditEntry.id },
    meta: {
      persistence: "in-memory-demo",
      wiring: "NOT_WIRED",
      note: "Toggle applied to the demo store only and recorded there as an audit entry. It does NOT enable the module: real toggles write the feature_flags table (seeded OFF) with an audit reason.",
    },
  });
}

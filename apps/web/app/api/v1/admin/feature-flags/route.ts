import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { isFlagEnabledDb, isKnownFlag, listFlagsWithStateDb, setFlagEnabledDb } from "./store";
import { recordDemoAudit } from "../audit-log/store";

// Feature flags API — Agent 39.
// GET: settings.view. PATCH (toggle): settings.edit.
// The catalogue mirrors seed FEATURE_FLAGS exactly (19 module.* keys,
// all seeded OFF). Enabled state persists in the FeatureFlag table
// (src/lib/feature-flags-db.ts): GET hydrates from the DB, PATCH
// writes through the unified reader and awaits the DB write before
// answering persisted: true. A toggle still REQUIRES an audit reason
// (feature_flags.manage is a sensitive action in src/lib/audit.ts) and
// is recorded as an audit entry in the real AuditLog table.

export async function GET() {
  const guard = await requireAdmin("settings.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  try {
    const flags = await listFlagsWithStateDb();
    return NextResponse.json({
      data: { flags },
      meta: {
        persistence: "database",
        source: "DATABASE",
        note: "Enabled state lives in the feature_flags table (seeded OFF).",
      },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Feature flags need a working database." } },
      { status: 503 },
    );
  }
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

  let before: boolean;
  try {
    before = await isFlagEnabledDb(key);
    await setFlagEnabledDb(key, enabled);
  } catch {
    // The toggle did not persist — say so instead of claiming success.
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Feature flag toggle could not be persisted." } },
      { status: 503 },
    );
  }
  const auditEntry = await recordDemoAudit({
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
    data: { key, enabled, persisted: true, auditEntryId: auditEntry.id },
    meta: {
      persistence: "database",
      note: "Toggle persisted to the feature_flags table and recorded as an audit entry.",
    },
  });
}

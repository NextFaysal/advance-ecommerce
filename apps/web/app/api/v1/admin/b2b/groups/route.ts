/**
 * B2B group pricing admin — /api/v1/admin/b2b/groups (ADV-14 remainder).
 *
 * GET  -> the `b2b.groups` Setting doc + the assignment/override
 *         pickers' data (B2B customers, catalogue variants).
 * PUT  -> replace the whole doc. Guarded by the sibling B2B routes'
 *         guard (requireB2bAdmin: module.b2b flag, then b2b.view /
 *         b2b.manage) and additionally by module.b2b_portal — group
 *         pricing only exists inside the portal wave. Writes are
 *         reason-required and audited (settings.update on the
 *         Setting doc, the IP-rules pattern): the generic
 *         setSetting() path rejects unregistered keys by design, so
 *         the doc is written directly over prisma.setting.
 *
 * Validation is total: the zod doc schema (shape + duplicate group
 * ids + internal references) AND live referential integrity (every
 * assignment key is a real B2B customer, every override key a real
 * variant). Any problem rejects the WHOLE write with all problems
 * listed — a partially-applied price book is never stored.
 */
import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { z } from "zod";
import { b2bGuardError, requireB2bAdmin } from "@/b2b/guard";
import { b2bStore } from "@/b2b/db-store";
import {
  B2B_GROUPS_SETTING_KEY,
  b2bGroupsDocSchema,
  listB2bOverrideVariantOptions,
  readB2bGroupsDoc,
  validateB2bGroupsDocReferences,
  writeB2bGroupsDoc,
} from "@/b2b/group-pricing";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { writeAudit } from "@/lib/audit";
import { invalidateSettingCache } from "@/lib/settings";

export const dynamic = "force-dynamic";

function portalLocked() {
  return NextResponse.json(
    {
      error: {
        code: "FEATURE_LOCKED",
        message:
          "Module is locked: module.b2b_portal is off. Group pricing belongs to the B2B buyer portal — enable that feature flag to manage it.",
      },
    },
    { status: 403 },
  );
}

export async function GET() {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireB2bAdmin("b2b.view");
  if (!guard.ok) return NextResponse.json(b2bGuardError(guard), { status: guard.status });
  if (!isFeatureEnabled("module.b2b_portal")) return portalLocked();

  const [groups, customers, variants] = await Promise.all([
    readB2bGroupsDoc(),
    b2bStore.listCustomers(),
    listB2bOverrideVariantOptions(),
  ]);
  return NextResponse.json({
    data: {
      groups,
      customers: customers.map((c) => ({
        id: c.id,
        businessName: c.businessName,
        contactName: c.contactName,
        approvalStatus: c.approvalStatus,
      })),
      variants,
    },
    meta: { persistence: "database", settingKey: B2B_GROUPS_SETTING_KEY },
  });
}

const putSchema = z.object({
  groups: b2bGroupsDocSchema,
  reason: z.string().trim().min(1, "Reason is required for a pricing change."),
});

export async function PUT(req: Request) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireB2bAdmin("b2b.manage");
  if (!guard.ok) return NextResponse.json(b2bGuardError(guard), { status: guard.status });
  if (!isFeatureEnabled("module.b2b_portal")) return portalLocked();

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Group pricing input invalid — nothing was saved.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      },
      { status: 400 },
    );
  }

  const referenceProblems = await validateB2bGroupsDocReferences(parsed.data.groups);
  if (referenceProblems.length > 0) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_REFERENCES",
          message: "Group pricing references records that do not exist — nothing was saved.",
          details: referenceProblems,
        },
      },
      { status: 400 },
    );
  }

  const previous = await readB2bGroupsDoc().catch(() => null);
  try {
    await writeB2bGroupsDoc(parsed.data.groups, guard.userId);
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "SETTINGS_SAVE_FAILED",
          message: "Group pricing could not be saved — database unavailable.",
        },
      },
      { status: 503 },
    );
  }
  invalidateSettingCache(B2B_GROUPS_SETTING_KEY);
  await writeAudit({
    actorId: guard.userId,
    action: "settings.update",
    entityType: "Setting",
    entityId: B2B_GROUPS_SETTING_KEY,
    beforeJson: previous
      ? {
          groups: previous.groups as unknown as Record<string, unknown>[],
          assignments: previous.assignments,
          overrides: previous.overrides,
        }
      : null,
    afterJson: {
      groups: parsed.data.groups.groups as unknown as Record<string, unknown>[],
      assignments: parsed.data.groups.assignments,
      overrides: parsed.data.groups.overrides,
    },
    reason: parsed.data.reason,
  });
  return NextResponse.json({
    data: { groups: parsed.data.groups },
    meta: { saved: true, persistence: "database" },
  });
}

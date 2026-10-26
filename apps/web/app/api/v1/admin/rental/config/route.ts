/**
 * Admin rental config API — /api/v1/admin/rental/config
 * (ADV-23 vertical 3, doc 23 wave 56).
 *
 *   GET -> the stored rental.config document + its source
 *          ("saved" | "default"). Requires settings.view.
 *   PUT { rentalVariantIds, maxRentalDays, depositMode,
 *         depositFixedPoisha, depositPercentBps,
 *         lateFeePerDayPoisha, reason }
 *       -> whole-document replace. Requires settings.edit and a
 *          non-empty `reason`; validated by the config zod schema
 *          and audited (rental.config.update) with before/after
 *          documents.
 *
 * Storage is the Setting-document store in src/rental/config.ts —
 * NOT the generic settings POST: setSetting() rejects keys outside
 * SETTING_DEFAULTS, the same reason services.config and
 * restaurant.config docs have their own stores. This route
 * intentionally does NOT require the module.rental flag (the
 * services/restaurant config precedent): a merchant prepares the
 * config first, then enables the paid module.
 *
 * Note what the config cannot do: `lateFeePerDayPoisha` is stored
 * and displayed only — v1 has no automatic late-fee charge, and the
 * deposit refund on return is a manual admin action. Changing the
 * deposit settings never rewrites live rentals: each
 * RentalBooking froze its depositPoisha at order time.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import {
  RENTAL_CONFIG_KEY,
  loadRentalConfig,
  saveRentalConfig,
  rentalConfigObjectSchema,
  rentalConfigSchema,
} from "@/rental/config";
import { isRentalEnabled, RENTAL_FLAG } from "@/rental/flags";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permission: "settings.view" | "settings.edit") {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { error: err("UNAUTHENTICATED", "Admin login required.", 401) };
  try {
    const session = await validateSessionToken(token);
    if (!session) return { error: err("UNAUTHENTICATED", "Session expired or revoked.", 401) };
    requirePermission(session.user.permissions, permission);
    return { session };
  } catch (e) {
    if (e instanceof RbacError) return { error: err("FORBIDDEN", e.message, 403) };
    return { error: err("DB_NOT_READY", "Session check needs a working database.", 503) };
  }
}

export async function GET() {
  const auth = await requireAdmin("settings.view");
  if ("error" in auth) return auth.error;

  const loaded = await loadRentalConfig();
  return NextResponse.json({
    data: {
      docKey: RENTAL_CONFIG_KEY,
      flag: RENTAL_FLAG,
      moduleEnabled: isRentalEnabled(),
      config: loaded.config,
      source: loaded.source,
      effective: loaded.effective,
    },
    meta: { persistence: "setting-doc" },
  });
}

// The plain object schema carries the fields; the full schema
// parse of the config half runs below (kept identical in shape to
// the services config route).
const putSchema = rentalConfigObjectSchema.extend({
  reason: z.string().trim().min(1, "Reason is required."),
});

export async function PUT(req: Request) {
  const auth = await requireAdmin("settings.edit");
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return err(
      "VALIDATION_ERROR",
      "Rental config input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const { reason, ...config } = parsed.data;
  const refined = rentalConfigSchema.safeParse(config);
  if (!refined.success) {
    return err(
      "VALIDATION_ERROR",
      "Rental config input invalid.",
      400,
      refined.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }

  const before = await loadRentalConfig();
  try {
    await saveRentalConfig(config, auth.session.user.id);
  } catch {
    return err("DB_NOT_READY", "Rental config could not be saved (database error).", 503);
  }
  const after = await loadRentalConfig();
  await writeAudit({
    actorId: auth.session.user.id,
    action: "rental.config.update",
    entityType: "Setting",
    entityId: RENTAL_CONFIG_KEY,
    beforeJson: before.config,
    afterJson: after.config,
    reason,
  });

  return NextResponse.json({
    data: {
      docKey: RENTAL_CONFIG_KEY,
      config: after.config,
      source: after.source,
      effective: after.effective,
    },
    meta: { persistence: "setting-doc" },
  });
}

/**
 * Shared guard for the restaurant admin routes — ADV-23 (wave 56).
 *
 * Two gates, in order (the warehouse guard's shape): admin session +
 * the caller's permission (orders.view for reads, orders.edit for
 * ticket advances — the pharmacy-queue precedent), then the paid
 * add-on flag `module.restaurant` (403 FEATURE_LOCKED when OFF,
 * matching the other add-on APIs).
 */
import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import type { PermissionKey } from "@/lib/rbac";
import { isRestaurantEnabled } from "./flags";

export interface RestaurantAccess {
  userId: string;
  userName: string | null;
}

type GuardOutcome =
  | { ok: true; access: RestaurantAccess }
  | { ok: false; response: NextResponse };

export async function requireRestaurantAccess(permission: PermissionKey): Promise<GuardOutcome> {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdminPermission(permission);
  if (!guard.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: guard.code, message: guard.message } },
        { status: guard.httpStatus },
      ),
    };
  }
  if (!isRestaurantEnabled()) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "FEATURE_LOCKED",
            message: "Restaurant module is locked for this install (module.restaurant is OFF).",
          },
        },
        { status: 403 },
      ),
    };
  }
  const user = guard.user as { id: string; name?: string | null };
  return { ok: true, access: { userId: user.id, userName: user.name ?? null } };
}

/**
 * Shared guard for the rental admin routes — ADV-23 (wave 56).
 *
 * Two gates, in order (the services guard's shape): admin session +
 * the caller's permission (orders.view for reads, orders.edit for
 * rental advances), then the paid add-on flag `module.rental`
 * (403 FEATURE_LOCKED when OFF, matching the other add-on APIs).
 * Note the rental CONFIG route does NOT use this guard — like the
 * services/restaurant config routes it gates on
 * settings.view/settings.edit only, so a merchant can prepare the
 * config before enabling the module.
 */
import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import type { PermissionKey } from "@/lib/rbac";
import { isRentalEnabled } from "./flags";

export interface RentalAccess {
  userId: string;
  userName: string | null;
}

type GuardOutcome =
  | { ok: true; access: RentalAccess }
  | { ok: false; response: NextResponse };

export async function requireRentalAccess(permission: PermissionKey): Promise<GuardOutcome> {
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
  if (!isRentalEnabled()) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "FEATURE_LOCKED",
            message: "Rental module is locked for this install (module.rental is OFF).",
          },
        },
        { status: 403 },
      ),
    };
  }
  const user = guard.user as { id: string; name?: string | null };
  return { ok: true, access: { userId: user.id, userName: user.name ?? null } };
}

/**
 * Shared guard for the services admin routes — ADV-23 (wave 56).
 *
 * Two gates, in order (the restaurant guard's shape): admin session +
 * the caller's permission (orders.view for reads, orders.edit for
 * booking advances), then the paid add-on flag `module.services`
 * (403 FEATURE_LOCKED when OFF, matching the other add-on APIs).
 * Note the services CONFIG route does NOT use this guard — like the
 * restaurant config route it gates on settings.view/settings.edit
 * only, so a merchant can prepare the config before enabling the
 * module.
 */
import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import type { PermissionKey } from "@/lib/rbac";
import { isServicesEnabled } from "./flags";

export interface ServicesAccess {
  userId: string;
  userName: string | null;
}

type GuardOutcome =
  | { ok: true; access: ServicesAccess }
  | { ok: false; response: NextResponse };

export async function requireServicesAccess(permission: PermissionKey): Promise<GuardOutcome> {
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
  if (!isServicesEnabled()) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "FEATURE_LOCKED",
            message: "Services module is locked for this install (module.services is OFF).",
          },
        },
        { status: 403 },
      ),
    };
  }
  const user = guard.user as { id: string; name?: string | null };
  return { ok: true, access: { userId: user.id, userName: user.name ?? null } };
}

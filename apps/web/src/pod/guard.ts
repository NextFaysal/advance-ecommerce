/**
 * Shared guard for the print-on-demand admin routes — ADV-23
 * (wave 56).
 *
 * Two gates, in order (the rental guard's shape): admin session +
 * the caller's permission (orders.view for the queue read,
 * orders.edit for the printed attestation), then the paid add-on
 * flag `module.print_on_demand` (403 FEATURE_LOCKED when OFF,
 * matching the other add-on APIs). Note the POD CONFIG route does
 * NOT use this guard — like the rental/services config routes it
 * gates on settings.view/settings.edit only, so a merchant can
 * prepare the config before enabling the module.
 */
import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import type { PermissionKey } from "@/lib/rbac";
import { isPodEnabled } from "./flags";

export interface PodAccess {
  userId: string;
  userName: string | null;
}

type GuardOutcome =
  | { ok: true; access: PodAccess }
  | { ok: false; response: NextResponse };

export async function requirePodAccess(permission: PermissionKey): Promise<GuardOutcome> {
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
  if (!isPodEnabled()) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "FEATURE_LOCKED",
            message:
              "Print-on-demand module is locked for this install (module.print_on_demand is OFF).",
          },
        },
        { status: 403 },
      ),
    };
  }
  const user = guard.user as { id: string; name?: string | null };
  return { ok: true, access: { userId: user.id, userName: user.name ?? null } };
}

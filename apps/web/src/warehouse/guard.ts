/**
 * Shared guard for /api/v1/admin/warehouse routes — ADV-21.
 *
 * Two gates, in order: admin session + `orders.view` (the warehouse
 * queue is order-based; every warehouse read AND write uses it —
 * the call-center precedent in src/admin-nav/config.ts), then the
 * paid add-on flag `module.warehouse_ops` (403 FEATURE_LOCKED when
 * OFF, matching the other add-on APIs).
 */
import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import { WarehouseError } from "./pick-lists";
import { isWarehouseOpsEnabled } from "./flags";

export interface WarehouseAccess {
  userId: string;
  userName: string | null;
}

type GuardOutcome =
  | { ok: true; access: WarehouseAccess }
  | { ok: false; response: NextResponse };

export async function requireWarehouseAccess(): Promise<GuardOutcome> {
  const guard = await requireAdminPermission("orders.view");
  if (!guard.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: guard.code, message: guard.message } },
        { status: guard.httpStatus },
      ),
    };
  }
  if (!isWarehouseOpsEnabled()) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "FEATURE_LOCKED",
            message: "Warehouse ops is locked for this install (module.warehouse_ops is OFF).",
          },
        },
        { status: 403 },
      ),
    };
  }
  const user = guard.user as { id: string; name?: string | null };
  return { ok: true, access: { userId: user.id, userName: user.name ?? null } };
}

/** Map a thrown error to the standard { error } response shape. */
export function warehouseErrorResponse(error: unknown): NextResponse {
  if (error instanceof WarehouseError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.httpStatus },
    );
  }
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "অপ্রত্যাশিত ত্রুটি — আবার চেষ্টা করুন।" } },
    { status: 500 },
  );
}

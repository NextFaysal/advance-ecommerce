/**
 * GET /api/v1/admin/tracking — tracking configuration STATUS. Agent 24.
 * RBAC: settings.view (via the shared fail-closed admin guard).
 * Returns booleans + public ids only — the CAPI/GA4/TikTok tokens are
 * write-only secrets in Admin Settings and are represented here solely by
 * `*Configured` booleans. Status is resolved live (ADV-9): Admin Settings
 * DB first, env fallback — the same resolution the runtime uses.
 */
import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { STANDARD_EVENT_NAMES } from "@/tracking/types";
import { TRACKING_SETTING_KEYS, TRACKING_SECRET_KEYS } from "@/tracking/settings";
import { resolveMetaCapi, resolveTrackingConfigStatus } from "@/tracking/resolve";
import { demoDedupStore } from "@/tracking/events";

export async function GET() {
  const guard = await requireAdmin("settings.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const status = await resolveTrackingConfigStatus();
  const capi = await resolveMetaCapi();

  return NextResponse.json({
    data: {
      status,
      settingKeys: TRACKING_SETTING_KEYS,
      secretKeys: TRACKING_SECRET_KEYS,
      standardEvents: STANDARD_EVENT_NAMES,
      attribution: { model: "last_touch", firstTouchPreserved: true, moneyUnit: "integer poisha" },
      dedup: { store: "in-memory-demo", recordedEvents: demoDedupStore.size() },
      capiSender: capi.targets.length > 0 ? "live" : "sandbox",
    },
    meta: {
      configSource: "DB_SETTINGS_THEN_ENV",
      note: "Tokens never appear here. Set them in Admin > Settings > Tracking (encrypted, write-only).",
    },
  });
}

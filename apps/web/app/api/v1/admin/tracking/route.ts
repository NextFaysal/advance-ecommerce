/**
 * GET /api/v1/admin/tracking — tracking configuration STATUS. Agent 24.
 * RBAC: settings.view (via the shared fail-closed admin guard).
 * Returns booleans + public ids only — the CAPI/GA4/TikTok tokens are
 * write-only secrets in Admin Settings and are represented here solely by
 * `*Configured` booleans. Until the DB settings reader is wired into the
 * tracking slice, config resolves to UNCONFIGURED (fail-closed).
 */
import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { STANDARD_EVENT_NAMES } from "@/tracking/types";
import { TRACKING_SETTING_KEYS, TRACKING_SECRET_KEYS, UNCONFIGURED_TRACKING_STATUS } from "@/tracking/settings";
import { demoDedupStore } from "@/tracking/events";

export async function GET() {
  const guard = await requireAdmin("settings.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  return NextResponse.json({
    data: {
      status: UNCONFIGURED_TRACKING_STATUS,
      settingKeys: TRACKING_SETTING_KEYS,
      secretKeys: TRACKING_SECRET_KEYS,
      standardEvents: STANDARD_EVENT_NAMES,
      attribution: { model: "last_touch", firstTouchPreserved: true, moneyUnit: "integer poisha" },
      dedup: { store: "in-memory-demo", recordedEvents: demoDedupStore.size() },
      capiSender: "sandbox",
    },
    meta: {
      configSource: "UNCONFIGURED_DEMO_UNTIL_DB_SETTINGS_WIRED",
      note: "Tokens never appear here. Set them in Admin > Settings > Tracking (encrypted, write-only).",
    },
  });
}

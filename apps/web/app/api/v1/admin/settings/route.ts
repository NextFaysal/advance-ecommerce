/**
 * Admin settings API — /api/v1/admin/settings
 *
 * GET  -> { data: { publicSettings, integrations }, meta }
 *   - requires settings.view
 *   - publicSettings: getPublicSettings() — non-secret, non-encrypted only.
 *     If the DB is not reachable yet, falls back to SETTING_DEFAULTS public
 *     values and says so in meta (defaults are not presented as DB values).
 *   - integrations: per-provider { provider, enabled, configured } ONLY.
 *     configured is a boolean — a credential value is NEVER returned.
 *
 * POST { key, value, reason } -> set one setting via src/lib/settings.setSetting
 *   - requires settings.edit, plus settings.integrations for integration
 *     categories (payment/courier/sms/email/storage)
 *   - key must pass isKnownSettingKey; secret keys (isSecretSettingKey) are
 *     encrypted by setSetting (AES-256-GCM) and audited as "changed" only.
 *   - reason is REQUIRED: settings.update is a sensitive audited action.
 *   - response returns { key, changed: true, valueEncrypted } — never value.
 *   - if Prisma/DB is not ready, returns 503 DB_NOT_READY and does NOT
 *     claim the setting was saved.
 *
 * This route does NOT change the settings.ts contract — it only wires it.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import {
  COURIER_PROVIDERS,
  EMAIL_PROVIDERS,
  PAYMENT_PROVIDERS,
  SETTING_DEFAULTS,
  SMS_PROVIDERS,
  STORAGE_PROVIDERS,
  getIntegrationStatus,
  getPublicSettings,
  isKnownSettingKey,
  isSecretSettingKey,
  setSetting,
  type IntegrationStatus,
} from "@/lib/settings";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permissions: PermissionKey[]) {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { error: err("UNAUTHENTICATED", "Admin login required.", 401) };
  try {
    const session = await validateSessionToken(token);
    if (!session) return { error: err("UNAUTHENTICATED", "Session expired or revoked.", 401) };
    for (const permission of permissions) requirePermission(session.user.permissions, permission);
    return { session };
  } catch (e) {
    if (e instanceof RbacError) return { error: err("FORBIDDEN", e.message, 403) };
    return { error: err("DB_NOT_READY", "Session check needs a working database (Prisma generate + DB connection).", 503) };
  }
}

const INTEGRATION_CATEGORIES = ["payment", "courier", "sms", "email", "storage"] as const;

export async function GET() {
  const auth = await requireAdmin(["settings.view"]);
  if ("error" in auth) return auth.error;

  let publicSettings: Record<string, string> = {};
  let dbReady = true;
  try {
    publicSettings = await getPublicSettings();
  } catch {
    dbReady = false;
    for (const [key, def] of Object.entries(SETTING_DEFAULTS)) {
      if (def.isPublic) publicSettings[key] = def.value;
    }
  }

  const integrations: Record<string, IntegrationStatus[]> = {};
  for (const category of INTEGRATION_CATEGORIES) {
    const providers =
      category === "payment"
        ? PAYMENT_PROVIDERS
        : category === "courier"
          ? COURIER_PROVIDERS
          : category === "sms"
            ? SMS_PROVIDERS
            : category === "email"
              ? EMAIL_PROVIDERS
              : STORAGE_PROVIDERS;
    try {
      integrations[category] = await getIntegrationStatus(category, providers);
    } catch {
      dbReady = false;
      integrations[category] = providers.map((provider) => ({ provider, enabled: false, configured: false }));
    }
  }

  return NextResponse.json({
    data: { publicSettings, integrations },
    meta: { db: dbReady ? "CONNECTED" : "NOT_WIRED", note: dbReady ? undefined : "DB not reachable — public values below are built-in defaults, integration configured=false is a fallback, not a DB read." },
  });
}

const postSchema = z.object({
  key: z.string().min(3).max(120),
  value: z.string().max(4096),
  reason: z.string().min(1, "Reason is required for a settings change."),
  isPublic: z.boolean().optional(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", "Settings input invalid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const category = parsed.data.key.split(".")[0] ?? "";
  const permissions: PermissionKey[] = (INTEGRATION_CATEGORIES as readonly string[]).includes(category)
    ? ["settings.edit", "settings.integrations"]
    : ["settings.edit"];
  const auth = await requireAdmin(permissions);
  if ("error" in auth) return auth.error;

  if (!isKnownSettingKey(parsed.data.key)) {
    return err("UNKNOWN_SETTING_KEY", `Unknown setting key: ${parsed.data.key}`, 400);
  }
  // Doc 30: the store default language only ever holds a real locale —
  // anything else would silently fall back at render time and confuse
  // the owner about which language the store is actually running in.
  if (parsed.data.key === "general.locale" && parsed.data.value !== "bn" && parsed.data.value !== "en") {
    return err("VALIDATION_ERROR", "general.locale must be \"bn\" or \"en\".", 400);
  }
  try {
    await setSetting({
      key: parsed.data.key,
      value: parsed.data.value,
      actorId: auth.session.user.id,
      reason: parsed.data.reason,
      isPublic: parsed.data.isPublic,
    });
  } catch (e) {
    // Covers missing SETTINGS_ENCRYPTION_KEY for secrets and DB-not-ready.
    // Never echo the value, and never claim the setting was saved.
    return err("SETTINGS_SAVE_FAILED", e instanceof Error ? e.message : "Settings save failed.", 503);
  }
  return NextResponse.json({
    data: { key: parsed.data.key, changed: true, valueEncrypted: isSecretSettingKey(parsed.data.key) },
    meta: { saved: true },
  });
}

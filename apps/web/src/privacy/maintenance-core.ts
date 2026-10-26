/**
 * Maintenance mode — PURE core (ADV-29, doc 22). No imports beyond
 * types: this module is bundled into the EDGE middleware, so it must
 * never drag in Prisma/Settings. The server-side reader
 * (getMaintenanceConfig) lives in src/privacy/maintenance.ts.
 *
 * Config shape: ONE registered Setting, `site.maintenance`, a JSON
 * document { enabled, message_bn, message_en }, edited from
 * Admin > Settings > Privacy through the standard Settings API.
 * Everything fails SAFE: missing/corrupt → maintenance OFF (a broken
 * config can never take the storefront down).
 *
 * Gate policy (decideMaintenanceGate — unit-tested by the ADV-29
 * smoke without HTTP):
 *   - disabled                       → pass
 *   - /admin, /dashboard, /api       → pass (admin keeps full access,
 *                                      admin login included)
 *   - preview cookie present         → pass
 *   - ?preview=1 + admin_session     → pass + set the preview cookie
 *     cookie present                   (middleware can only check
 *                                      cookie PRESENCE — the same
 *                                      documented limit as the admin
 *                                      gate in middleware.ts; the
 *                                      session itself is validated
 *                                      server-side by admin pages)
 *   - anything else                  → block (503 page)
 */

export const MAINTENANCE_SETTING_KEY = "site.maintenance";
export const MAINTENANCE_PREVIEW_COOKIE = "maintenance_preview";

export interface MaintenanceConfig {
  enabled: boolean;
  messageBn: string;
  messageEn: string;
}

export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
  enabled: false,
  messageBn:
    "সাইটটি এখন রক্ষণাবেক্ষণের জন্য সাময়িকভাবে বন্ধ আছে। অনুগ্রহ করে কিছুক্ষণ পরে আবার চেষ্টা করুন।",
  messageEn:
    "The store is temporarily closed for maintenance. Please check back shortly.",
};

/** Parse the stored JSON doc. ANY problem → disabled defaults. */
export function parseMaintenanceConfig(raw: string | null | undefined): MaintenanceConfig {
  if (raw === null || raw === undefined || raw.trim() === "") {
    return { ...DEFAULT_MAINTENANCE_CONFIG };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<{
      enabled: unknown;
      message_bn: unknown;
      message_en: unknown;
    }>;
    return {
      enabled: parsed.enabled === true,
      messageBn:
        typeof parsed.message_bn === "string" && parsed.message_bn.trim() !== ""
          ? parsed.message_bn
          : DEFAULT_MAINTENANCE_CONFIG.messageBn,
      messageEn:
        typeof parsed.message_en === "string" && parsed.message_en.trim() !== ""
          ? parsed.message_en
          : DEFAULT_MAINTENANCE_CONFIG.messageEn,
    };
  } catch {
    return { ...DEFAULT_MAINTENANCE_CONFIG };
  }
}

/* ------------------------------------------------------------------ */
/* Gate decision (pure)                                                */
/* ------------------------------------------------------------------ */

export type MaintenanceDecision =
  | { action: "pass" }
  | { action: "pass_set_preview" }
  | { action: "block" };

export function decideMaintenanceGate(input: {
  config: MaintenanceConfig;
  pathname: string;
  hasAdminSessionCookie: boolean;
  hasPreviewCookie: boolean;
  previewParam: boolean;
}): MaintenanceDecision {
  if (!input.config.enabled) return { action: "pass" };
  const p = input.pathname;
  if (p === "/admin" || p.startsWith("/admin/") || p === "/dashboard" || p.startsWith("/dashboard/")) {
    return { action: "pass" };
  }
  if (p === "/api" || p.startsWith("/api/")) return { action: "pass" };
  if (input.hasPreviewCookie) return { action: "pass" };
  if (input.previewParam && input.hasAdminSessionCookie) {
    return { action: "pass_set_preview" };
  }
  return { action: "block" };
}

/** The 503 page the middleware serves. Self-contained (no external
 *  assets), Bangla first (site default locale), English below. The
 *  messages are operator-configured text — escaped before use. */
export function renderMaintenanceHtml(config: MaintenanceConfig): string {
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>রক্ষণাবেক্ষণ চলছে — Maintenance</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #0f1226; color: #f4f4f8; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  main { max-width: 34rem; padding: 2.5rem 1.5rem; text-align: center; }
  h1 { font-size: 1.6rem; margin: 0 0 1rem; }
  p { line-height: 1.7; color: #c9cbe0; }
  .en { color: #9a9cb8; font-size: 0.95rem; }
</style>
</head>
<body>
<main>
  <h1>রক্ষণাবেক্ষণ চলছে</h1>
  <p>${esc(config.messageBn)}</p>
  <p class="en">${esc(config.messageEn)}</p>
</main>
</body>
</html>`;
}

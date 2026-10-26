import { NextResponse, type NextRequest } from "next/server";
import {
  MAINTENANCE_PREVIEW_COOKIE,
  decideMaintenanceGate,
  parseMaintenanceConfig,
  renderMaintenanceHtml,
  type MaintenanceConfig,
} from "./src/privacy/maintenance-core";

// Admin protection (edge, cookie-presence only):
// - /dashboard -> /admin redirect
// - /admin/* (except /admin/login) requires an admin_session cookie.
//   This is NOT the security boundary by itself: every admin API route and
//   Server Action must still validate the session server-side with
//   validateSessionToken + requirePermission (src/lib/auth.ts / rbac.ts).
//   Middleware only prevents unauthenticated page shells from rendering.
// - /admin is noindex via robots handling in the admin layout metadata.
// /admin/accept-invite is public for the same reason as login: the
// invitee has no session yet — the one-time invite token is the
// credential, validated server-side by the accept API.
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/admin/accept-invite"];

/* ------------------------------------------------------------------ */
/* Maintenance mode (ADV-29 — src/privacy/maintenance*.ts)             */
/*                                                                     */
/* Middleware runs on the edge and CANNOT read the DB Settings       */
/* store, and this codebase has no settings-in-middleware pattern    */
/* (feature flags resolve server-side). So the gate polls the        */
/* app's own public GET /api/v1/public/site-status (which reads the  */
/* `site.maintenance` Setting server-side) with an in-isolate TTL    */
/* cache, and FAILS OPEN: any fetch/parse problem means "not in      */
/* maintenance" — a broken probe must never take the store down.     */
/* The probe has a hard 400ms timeout so a hung site-status route    */
/* cannot stall page loads, and a failed probe is negatively cached */
/* for 30s so an outage doesn't turn into a probe per request.      */
/* Toggling in Admin > Settings > Privacy takes effect within the   */
/* TTL (120s) plus the settings cache. The block/pass policy itself */
/* is the pure decideMaintenanceGate() from maintenance-core.        */
/* ------------------------------------------------------------------ */

const MAINTENANCE_CACHE_TTL_MS = 120_000;
const MAINTENANCE_FAILURE_CACHE_TTL_MS = 30_000;
const MAINTENANCE_PROBE_TIMEOUT_MS = 400;
let maintenanceCache: { at: number; config: MaintenanceConfig } | null = null;
let maintenanceProbeFailedAt: number | null = null;

async function fetchMaintenanceConfig(origin: string): Promise<MaintenanceConfig | null> {
  const now = Date.now();
  if (maintenanceCache !== null && now - maintenanceCache.at < MAINTENANCE_CACHE_TTL_MS) {
    return maintenanceCache.config;
  }
  if (
    maintenanceProbeFailedAt !== null &&
    now - maintenanceProbeFailedAt < MAINTENANCE_FAILURE_CACHE_TTL_MS
  ) {
    return null;
  }
  try {
    const res = await fetch(`${origin}/api/v1/public/site-status`, {
      headers: { "x-maintenance-probe": "1" },
      signal: AbortSignal.timeout(MAINTENANCE_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      maintenanceProbeFailedAt = now;
      return null;
    }
    const body = (await res.json()) as {
      data?: { maintenance?: { enabled?: unknown; messageBn?: unknown; messageEn?: unknown } };
    };
    const m = body.data?.maintenance;
    if (!m) {
      maintenanceProbeFailedAt = now;
      return null;
    }
    // Rebuild the stored-doc shape and reuse the one parser, so the
    // middleware can never drift from the server-side semantics.
    const config = parseMaintenanceConfig(
      JSON.stringify({
        enabled: m.enabled === true,
        message_bn: typeof m.messageBn === "string" ? m.messageBn : "",
        message_en: typeof m.messageEn === "string" ? m.messageEn : "",
      }),
    );
    maintenanceCache = { at: now, config };
    maintenanceProbeFailedAt = null;
    return config;
  } catch {
    maintenanceProbeFailedAt = now;
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
    const target = pathname.replace(/^\/dashboard/, "/admin");
    return NextResponse.redirect(new URL(target, req.url));
  }
  if (pathname.startsWith("/admin") && !PUBLIC_ADMIN_PATHS.some((p) => pathname === p)) {
    const hasSession = req.cookies.has("admin_session");
    if (!hasSession) {
      const loginUrl = new URL("/admin/login", req.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Maintenance gate — storefront PAGE paths only. The matcher
  // already excludes /api/*, _next and dotted asset paths; /admin and
  // /dashboard returned or passed above and are never gated (admin
  // keeps full access, including the login). A signed-in admin can
  // preview the live storefront via ?preview=1, which sets a
  // short-lived preview cookie (cookie-presence only — the same
  // documented edge limit as the admin gate above).
  let setPreviewCookie = false;
  if (!pathname.startsWith("/admin")) {
    const config = await fetchMaintenanceConfig(req.nextUrl.origin);
    if (config !== null && config.enabled) {
      const decision = decideMaintenanceGate({
        config,
        pathname,
        hasAdminSessionCookie: req.cookies.has("admin_session"),
        hasPreviewCookie: req.cookies.get(MAINTENANCE_PREVIEW_COOKIE)?.value === "1",
        previewParam: req.nextUrl.searchParams.get("preview") === "1",
      });
      if (decision.action === "block") {
        return new NextResponse(renderMaintenanceHtml(config), {
          status: 503,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Retry-After": "3600",
            "X-Robots-Tag": "noindex",
            "Cache-Control": "no-store",
          },
        });
      }
      if (decision.action === "pass_set_preview") setPreviewCookie = true;
    }
  }

  // Expose the pathname so layouts can adapt (the admin layout renders
  // a bare auth screen for /admin/login instead of the full shell).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  if (setPreviewCookie) {
    res.cookies.set(MAINTENANCE_PREVIEW_COOKIE, "1", {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: 2 * 60 * 60,
    });
  }
  return res;
}

export const config = {
  matcher: [
    "/dashboard",
    "/dashboard/:path*",
    "/admin",
    "/admin/:path*",
    // Storefront pages for the maintenance gate: everything except
    // API routes, Next internals/static assets and dotted file paths
    // (feed.xml, sitemap.xml, robots.txt, images… stay reachable).
    "/((?!api/|_next/|favicon.ico|.*\\..*).*)",
  ],
};

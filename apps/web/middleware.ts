import { NextResponse, type NextRequest } from "next/server";

// Admin protection (edge, cookie-presence only):
// - /dashboard -> /admin redirect
// - /admin/* (except /admin/login) requires an admin_session cookie.
//   This is NOT the security boundary by itself: every admin API route and
//   Server Action must still validate the session server-side with
//   validateSessionToken + requirePermission (src/lib/auth.ts / rbac.ts).
//   Middleware only prevents unauthenticated page shells from rendering.
// - /admin is noindex via robots handling in the admin layout metadata.
const PUBLIC_ADMIN_PATHS = ["/admin/login"];

export function middleware(req: NextRequest) {
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
  // Expose the pathname so layouts can adapt (the admin layout renders
  // a bare auth screen for /admin/login instead of the full shell).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/dashboard", "/dashboard/:path*", "/admin", "/admin/:path*"],
};

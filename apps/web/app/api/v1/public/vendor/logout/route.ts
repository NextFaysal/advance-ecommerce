import { NextResponse } from "next/server";
import { VENDOR_SESSION_COOKIE } from "@/vendors/portal-auth";

// Vendor portal logout (ADV-13) — clears the session cookie. The v1
// token is stateless (no server-side session row), so logout is a
// cookie clear; the token itself expires within its 7-day TTL.
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ data: { loggedOut: true } });
  res.cookies.set(VENDOR_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
  return res;
}

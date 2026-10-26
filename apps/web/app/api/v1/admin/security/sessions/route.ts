import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { hashSessionToken, validateSessionToken } from "@/lib/auth";

// Active staff sessions — the list behind the /admin/security
// "সক্রিয় স্টাফ সেশন" card (ADV-28 core).
//
// Guard mirrors the sibling security routes (auth/session, auth/2fa):
// a valid staff session is required, no extra permission key — every
// signed-in staff member can see who else is signed in, which is the
// point of a shared security page.
//
// `isCurrent` is computed by hashing the CALLER's cookie token with
// the same hashSessionToken() that validateSessionToken() uses for
// its lookup, and comparing against each row's stored tokenHash.
// The hash itself is NEVER serialised — only the boolean leaves.

export async function GET() {
  const token = cookies().get("admin_session")?.value;
  if (!token) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin login required." } },
      { status: 401 },
    );
  }
  try {
    const caller = await validateSessionToken(token);
    if (!caller) {
      return NextResponse.json(
        { error: { code: "UNAUTHENTICATED", message: "Session expired. Login again." } },
        { status: 401 },
      );
    }
    const callerTokenHash = hashSessionToken(token);
    const rows = await prisma.session.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: "desc" },
      select: {
        id: true,
        tokenHash: true,
        ip: true,
        userAgent: true,
        deviceName: true,
        lastUsedAt: true,
        createdAt: true,
        user: {
          select: {
            name: true,
            email: true,
            role: { select: { name: true } },
          },
        },
      },
    });
    const data = rows.map((row) => ({
      id: row.id,
      userName: row.user.name,
      userEmail: row.user.email,
      roleName: row.user.role?.name ?? null,
      ip: row.ip,
      userAgent: row.userAgent,
      deviceName: row.deviceName,
      lastUsedAt: row.lastUsedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      isCurrent: row.tokenHash === callerTokenHash,
    }));
    return NextResponse.json({
      data,
      meta: { persistence: "database", source: "Session/User tables via Prisma" },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "PRISMA_PENDING", message: "Session list unavailable." } },
      { status: 503 },
    );
  }
}

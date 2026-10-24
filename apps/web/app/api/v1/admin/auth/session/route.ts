import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";

// Current staff session — "who am I" for admin client components.
// Returns ONLY display-safe identity fields (id, name, email, role
// name) of the caller's OWN session; no permission beyond holding a
// valid staff session is required and no other user's data is ever
// exposed. Client components use the id to key per-user browser
// preferences (saved table views / column choices in localStorage),
// so two staff sharing one browser never see each other's prefs.
export async function GET() {
  const token = cookies().get("admin_session")?.value;
  if (!token) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin login required." } },
      { status: 401 },
    );
  }
  try {
    const session = await validateSessionToken(token);
    if (!session) {
      return NextResponse.json(
        { error: { code: "UNAUTHENTICATED", message: "Session expired. Login again." } },
        { status: 401 },
      );
    }
    const u = session.user;
    return NextResponse.json({
      data: { user: { id: u.id, name: u.name, email: u.email, role: u.roleName } },
      meta: { persistence: "database", source: "Session/User tables via Prisma" },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "PRISMA_PENDING", message: "Session validation unavailable." } },
      { status: 503 },
    );
  }
}

import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import {
  ContactStoreUnavailableError,
  listContactMessages,
  toContactMessageListView,
} from "@/contact/store-db";

// Contact-form submissions — admin read. RBAC: customers.view (the
// same gate as the F-commerce inbox). Phone numbers are MASKED unless
// the caller's session also holds customers.view_full_phone.
// Persistence: Prisma DB via src/contact/store-db.ts (ContactMessage
// table). Read-only: replying / status transitions and a full admin
// UI page are a follow-up; this endpoint exists so staff can see
// submissions that previously vanished into an in-memory demo store.
export async function GET(req: Request) {
  const guard = await requireAdmin("customers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const url = new URL(req.url);
  const rawTake = Number(url.searchParams.get("take") ?? "50");
  const take = Number.isFinite(rawTake) ? Math.min(200, Math.max(1, Math.trunc(rawTake))) : 50;

  try {
    const rows = await listContactMessages(take);
    const canViewFullPhone = guard.permissions.includes("customers.view_full_phone");
    return NextResponse.json({
      data: { messages: rows.map((r) => toContactMessageListView(r, canViewFullPhone)) },
      meta: { persistence: "database" },
    });
  } catch (e) {
    if (e instanceof ContactStoreUnavailableError) {
      return NextResponse.json(
        {
          error: { code: "CONTACT_NOT_READY", message: "Contact message store is not available yet." },
          meta: { persistence: "unavailable", reason: "model-pending" },
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Contact message database is not available." } },
      { status: 503 },
    );
  }
}

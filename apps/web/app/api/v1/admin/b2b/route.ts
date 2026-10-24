import { NextResponse } from "next/server";
import { b2bGuardError, requireB2bAdmin } from "@/b2b/guard";
import { demoB2bFlags } from "@/b2b/flags";
import { b2bStore } from "@/b2b/db-store";
import { maskPhone } from "@/checkout/validation";

// B2B overview — Agent 16, Step 48 (A12). Paid add-on: module.b2b flag is
// checked first by the guard (403 FEATURE_LOCKED when off). Phones are
// masked in list output; full phone needs customers.view_full_phone and is
// never returned by this overview route. DB-backed (Prisma) since 2026-10-24.

export async function GET() {
  const guard = await requireB2bAdmin("b2b.view");
  if (!guard.ok) return NextResponse.json(b2bGuardError(guard), { status: guard.status });
  const customers = (await b2bStore.listCustomers()).map((c) => ({ ...c, phone: maskPhone(c.phone) }));
  return NextResponse.json({
    data: {
      flags: demoB2bFlags.list(),
      customers,
      quotations: await b2bStore.listQuotations(),
    },
    meta: { persistence: "database" },
  });
}

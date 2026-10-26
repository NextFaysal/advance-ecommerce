import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { confirmOrderImport } from "@/importers/orders-service";
import { isRefusal } from "@/importers/products-service";

// POST /api/v1/admin/imports/orders/confirm — ADV-25. Re-maps and
// re-validates the uploaded file server-side (client row data is
// never trusted), then creates each ready order via
// createManualOrder, one transaction per order. Deterministic
// idempotency keys make a repeat confirm report already-imported
// orders instead of duplicating them.
const bodySchema = z.object({
  source: z.enum(["woocommerce", "shopify"]),
  csv: z.string().min(1).max(20_000_000),
  fileName: z.string().max(255).optional(),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("orders.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Send { source: 'woocommerce' | 'shopify', csv: string, fileName? }.",
        },
      },
      { status: 400 },
    );
  }
  const result = await confirmOrderImport({
    source: parsed.data.source,
    csvText: parsed.data.csv,
    actor: {
      id: guard.userId,
      permissions: guard.permissions,
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    },
  });
  if (isRefusal(result)) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: 422 },
    );
  }
  return NextResponse.json({ data: result });
}

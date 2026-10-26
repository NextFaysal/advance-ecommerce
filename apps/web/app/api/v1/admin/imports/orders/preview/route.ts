import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { dryRunOrderImport } from "@/importers/orders-service";
import { isRefusal } from "@/importers/products-service";

// POST /api/v1/admin/imports/orders/preview — ADV-25 dry run for
// WooCommerce / Shopify order CSV exports. Groups the export's
// row-per-item layout back into orders and validates each against
// the platform's rules (BD phone mandatory, address fields, SKUs
// must exist). Nothing is persisted; every order is reported as
// ready or skipped WITH its reasons.
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
  const result = await dryRunOrderImport({
    source: parsed.data.source,
    csvText: parsed.data.csv,
    fileName: parsed.data.fileName ?? null,
  });
  if (isRefusal(result)) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: 422 },
    );
  }
  return NextResponse.json({ data: result });
}

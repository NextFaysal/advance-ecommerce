import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, handleServiceError, requireAdminSession } from "@/catalog/api";
import { hasPermission } from "@/lib/rbac";
import { dryRunProductImport } from "@/importers/products-service";
import { isRefusal } from "@/importers/products-service";

// POST /api/v1/admin/imports/products/preview — ADV-25 dry run for
// WooCommerce / Shopify / Daraz product CSV exports. Maps the file
// onto the EXISTING catalog import pipeline and reports in source
// row numbers: valid/invalid rows, skipped source rows with reasons,
// unmapped columns, category warnings, and the currency treatment.
// Nothing is persisted. The response carries platformCsv — the
// mapped file in the platform's native import format — which the
// admin UI posts to /api/v1/admin/products/import/confirm for the
// actual import (identical semantics to a native import).
const bodySchema = z.object({
  source: z.enum(["woocommerce", "shopify", "daraz"]),
  csv: z.string().min(1).max(20_000_000),
  fileName: z.string().max(255).optional(),
  currency: z.string().max(8).optional(),
  exchangeRateToBdt: z.string().max(32).optional(),
});

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.import")) {
    return apiError("FORBIDDEN", "Missing permission: products.import", 403);
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Send { source: 'woocommerce' | 'shopify' | 'daraz', csv: string, fileName?, currency?, exchangeRateToBdt? }.",
        },
      },
      { status: 400 },
    );
  }
  try {
    const result = await dryRunProductImport({
      source: parsed.data.source,
      csvText: parsed.data.csv,
      fileName: parsed.data.fileName ?? null,
      currency: {
        sourceCurrency: parsed.data.currency ?? "BDT",
        exchangeRateToBdt: parsed.data.exchangeRateToBdt ?? null,
      },
    });
    if (isRefusal(result)) {
      return NextResponse.json(
        { error: { code: result.code, message: result.message } },
        { status: 422 },
      );
    }
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleServiceError(error);
  }
}

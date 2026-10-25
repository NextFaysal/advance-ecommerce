import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  getCatalogRepository,
  handleServiceError,
  requireAdminSession,
  writeCatalogAudit,
} from "@/catalog/api";
import { hasPermission } from "@/lib/rbac";
import { parseCsv, previewImportRows, type ImportRow } from "@/catalog/import";
import { parseXlsxTable } from "@/catalog/import-xlsx";
import { productInputSchema, validateCreateInput, type ProductInput } from "@/catalog/service";

// POST /api/v1/admin/products/import/confirm — P4 confirm step; XLSX
// accepted since wave 16.
// Body: { csv: string, fileName?: string } or
//       { xlsxBase64: string, fileName?: string } — the SAME payload
// the preview endpoint accepted. The file is RE-PARSED here
// server-side (CSV via parseCsv, .xlsx via the SheetJS reader — both
// land in the same row table and shared previewImportRows pipeline):
// client-supplied row data is never trusted, and the existing-SKU set
// is recomputed from the live catalog (never taken from the client).
//
// Semantics:
//  - Every preview-VALID row is persisted via the catalog create
//    service (repo.createProduct — same single transaction, category
//    resolution, brand find-or-create, stock ledger as manual create),
//    grouped by slug: rows sharing a slug become variants of ONE
//    product, exactly like the background import job in jobs/runners.
//  - Created products are ALWAYS status DRAFT, whatever the file says
//    — importing never publishes silently.
//  - Preview-INVALID rows are skipped and reported; a product whose
//    create fails (unknown category slug, slug already taken, …) is
//    reported per-row as "failed". No row is ever silently dropped:
//    the response carries one outcome for EVERY data row in the file.
//  - Double-submit safety: this endpoint is deliberately NOT
//    idempotent-keyed, but a repeat submit is harmless — the second
//    run's re-parse now finds every SKU already in the catalog, so
//    all rows come back "skipped" (SKU already exists) and nothing
//    is created twice.
//  - Audit: individual creates do NOT write per-product audit rows
//    from here; ONE summary audit entry (products.import) records the
//    counts and file name for the whole run.
const bodySchema = z
  .object({
    csv: z.string().min(1).optional(),
    xlsxBase64: z.string().min(1).max(20_000_000).optional(),
    fileName: z.string().max(255).optional(),
  })
  .refine((d) => (d.csv !== undefined) !== (d.xlsxBase64 !== undefined), {
    message: "Send exactly one of { csv } or { xlsxBase64 }.",
  });

interface RowOutcome {
  row: number; // 1-based file row (header = 1, first data row = 2)
  slug: string;
  sku: string;
  status: "created" | "skipped" | "failed";
  productId?: string;
  message?: string;
}

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.import")) {
    return apiError("FORBIDDEN", "Missing permission: products.import", 403);
  }
  if (!hasPermission(session.permissions, "products.create")) {
    return apiError("FORBIDDEN", "Missing permission: products.create", 403);
  }
  const body = await req.json().catch(() => ({}));
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Send { csv: string, fileName?: string } or { xlsxBase64: string, fileName?: string }.",
        },
      },
      { status: 400 },
    );
  }
  const { fileName } = parsedBody.data;
  const format = parsedBody.data.xlsxBase64 !== undefined ? ("xlsx" as const) : ("csv" as const);

  let repo: Awaited<ReturnType<typeof getCatalogRepository>>;
  try {
    repo = await getCatalogRepository();
  } catch (error) {
    return handleServiceError(error);
  }

  // Reduce the uploaded file to the shared { headers, rows } table.
  let table: { headers: string[]; rows: Record<string, string>[] };
  if (format === "xlsx") {
    const parsedTable = parseXlsxTable(
      new Uint8Array(Buffer.from(parsedBody.data.xlsxBase64 as string, "base64")),
    );
    if (!parsedTable.ok) {
      return NextResponse.json(
        { error: { code: "INVALID_SPREADSHEET", message: parsedTable.message } },
        { status: 400 },
      );
    }
    table = parsedTable.table;
  } else {
    table = parseCsv(parsedBody.data.csv as string);
  }

  // Existing SKUs, computed server-side from the live catalog.
  const fileSkus = [
    ...new Set(
      table.rows.map((row) => (row.sku ?? "").trim()).filter((sku) => sku !== ""),
    ),
  ];
  let existingSkus: Set<string>;
  try {
    existingSkus = new Set(await repo.skusExist(fileSkus));
  } catch (error) {
    return handleServiceError(error);
  }

  const preview = previewImportRows(table.headers, table.rows, existingSkus);

  // previewImportRows returns valid rows in file order and numbers the
  // invalid ones, so each valid row's file row-number is recoverable:
  // every data row is exactly one of valid / invalid.
  const invalidRowNumbers = new Set(preview.invalidRows.map((r) => r.row));
  const validRowNumbers: number[] = [];
  for (let rowNo = 2; rowNo < preview.totalRows + 2; rowNo++) {
    if (!invalidRowNumbers.has(rowNo)) validRowNumbers.push(rowNo);
  }

  const outcomes: RowOutcome[] = [];
  for (const invalid of preview.invalidRows) {
    outcomes.push({
      row: invalid.row,
      slug: invalid.raw.slug ?? "",
      sku: invalid.raw.sku ?? "",
      status: "skipped",
      message: invalid.errors.map((e) => `${e.field}: ${e.message}`).join("; "),
    });
  }

  // Group valid rows by slug (rows sharing a slug = variants of one
  // product), preserving file order for deterministic results.
  const groups = new Map<string, { row: ImportRow; rowNo: number }[]>();
  preview.validRows.forEach((row, idx) => {
    const rowNo = validRowNumbers[idx] ?? idx + 2;
    const group = groups.get(row.slug) ?? [];
    group.push({ row, rowNo });
    groups.set(row.slug, group);
  });

  const createdProducts: { id: string; slug: string }[] = [];
  let createdRowCount = 0;
  let failedRowCount = 0;

  for (const [slug, entries] of groups) {
    const first = entries[0]?.row as ImportRow;
    const tags = [
      ...new Set(
        entries.flatMap(({ row }) =>
          (row.tags ?? "").split("|").map((tag) => tag.trim()).filter((tag) => tag !== ""),
        ),
      ),
    ];
    const failAll = (message: string) => {
      for (const { row, rowNo } of entries) {
        outcomes.push({ row: rowNo, slug, sku: row.sku, status: "failed", message });
        failedRowCount += 1;
      }
    };

    const candidate: ProductInput = {
      slug: first.slug,
      relatedIds: [],
      // Wave 15: imports are always SIMPLE products with no per-type data.
      type: "SIMPLE",
      digitalFiles: [],
      bundleComponents: [],
      titleBn: first.title_bn,
      titleEn: first.title_en,
      descriptionBn: first.description_bn,
      descriptionEn: first.description_en,
      categorySlug: first.category_slug,
      brandName: first.brand_name ?? null,
      // Import NEVER publishes: DRAFT regardless of the file's status.
      status: "DRAFT",
      tags,
      images: [],
      variants: entries.map(({ row }) => ({
        attributes: {},
        sku: row.sku,
        pricePoisha: row.price_poisha,
        compareAtPoisha: row.compare_at_poisha ?? null,
        costPoisha: row.cost_poisha ?? null,
        stock: row.stock,
        // An empty CSV cell means "no image": the input schema wants
        // a real URL or null, never "".
        imageUrl: row.image_url ? row.image_url : null,
        isActive: true,
      })),
    };

    const parsedInput = productInputSchema.safeParse(candidate);
    if (!parsedInput.success) {
      failAll(
        `Product data is invalid: ${parsedInput.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      );
      continue;
    }
    const payloadErrors = validateCreateInput(parsedInput.data);
    if (payloadErrors.length > 0) {
      failAll(payloadErrors.join("; "));
      continue;
    }
    try {
      if (await repo.slugExists(slug)) {
        failAll(`Slug already exists: ${slug}`);
        continue;
      }
      const takenSkus = await repo.skusExist(parsedInput.data.variants.map((v) => v.sku));
      if (takenSkus.length > 0) {
        failAll(`SKU already exists: ${takenSkus.join(", ")}`);
        continue;
      }
      const { product } = await repo.createProduct(parsedInput.data, session.userId);
      createdProducts.push({ id: product.id, slug: product.slug });
      for (const { row, rowNo } of entries) {
        outcomes.push({ row: rowNo, slug, sku: row.sku, status: "created", productId: product.id });
        createdRowCount += 1;
      }
    } catch (error) {
      // e.g. "Category not found: <slug>" from the create service —
      // a per-product failure: report it on the product's rows and
      // keep importing the rest of the file.
      failAll(error instanceof Error ? error.message : "Create failed.");
    }
  }

  outcomes.sort((a, b) => a.row - b.row);

  await writeCatalogAudit({
    actorId: session.userId,
    action: "products.import",
    entityId: null,
    afterJson: {
      fileName: fileName ?? null,
      format,
      totalRows: preview.totalRows,
      createdProducts: createdProducts.length,
      createdRows: createdRowCount,
      skippedRows: preview.invalidRows.length,
      failedRows: failedRowCount,
    },
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json({
    data: {
      fileName: fileName ?? null,
      format,
      totalRows: preview.totalRows,
      validCount: preview.validRows.length,
      invalidCount: preview.invalidRows.length,
      createdProductCount: createdProducts.length,
      createdRowCount,
      skippedRowCount: preview.invalidRows.length,
      failedRowCount,
      createdProducts,
      outcomes,
      errorReportCsv: preview.errorReportCsv,
      moneyUnits: preview.moneyUnits,
      note: "All imported products were created as DRAFT.",
    },
  });
}

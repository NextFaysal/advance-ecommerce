import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  requireAdminSession,
  writeCatalogAudit,
} from "@/catalog/api";
import { hasPermission } from "@/lib/rbac";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { createDigitalFileUploads } from "@/catalog/media-server";
import { isProductTypesEnabled } from "@/catalog/product-types";
import { MAX_DIGITAL_UPLOADS_PER_REQUEST } from "@/catalog/media";

// POST /api/v1/admin/products/digital-upload — presigned direct-upload
// tickets for DIGITAL product files (wave 15, doc 16 P7). Permission:
// products.create. Feature flag: module.product_types (OFF -> 403
// FEATURE_LOCKED).
//
// Same discipline as the image upload endpoint: file BYTES never pass
// through this route. The client sends metadata only; the server
// validates type (zip/pdf/epub/bin) + size (<= 200 MB) and returns one
// presigned PUT URL per file, under the `digital/` key prefix. After
// the PUTs succeed, the editor attaches the files to a product via the
// normal create/PATCH payload (`digitalFiles: [{ storageKey,
// fileName, sizeBytes }]`). Digital files are NOT public assets: the
// ticket has no publicUrl and buyers reach bytes only through a
// DownloadGrant (GET /api/v1/public/download/[token]).
//
// Errors: 401 UNAUTHORIZED / 403 FORBIDDEN / 403 FEATURE_LOCKED /
// 400 VALIDATION_ERROR / 400 INVALID_FILE / 503 STORAGE_NOT_CONFIGURED.
const uploadRequestSchema = z.object({
  productSlug: z.string().max(128).nullable().optional(),
  files: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        contentType: z.string().min(1).max(128),
        sizeBytes: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(MAX_DIGITAL_UPLOADS_PER_REQUEST),
});

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.create")) {
    return apiError("FORBIDDEN", "Missing permission: products.create", 403);
  }
  await ensureDbFeatureFlags();
  if (!isProductTypesEnabled()) {
    return apiError(
      "FEATURE_LOCKED",
      "Product types are locked for this install (module.product_types is OFF).",
      403,
    );
  }
  const body = await req.json().catch(() => ({}));
  const parsed = uploadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Upload request is invalid.",
          details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  const result = await createDigitalFileUploads({
    productSlug: parsed.data.productSlug ?? null,
    files: parsed.data.files,
  });
  if (!result.ok) {
    return apiError(
      result.code,
      result.message,
      result.code === "STORAGE_NOT_CONFIGURED" ? 503 : 400,
    );
  }
  await writeCatalogAudit({
    actorId: session.userId,
    action: "products.digital_upload",
    afterJson: {
      productSlug: parsed.data.productSlug ?? null,
      fileCount: result.uploads.length,
      keys: result.uploads.map((u) => u.storageKey),
    },
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({ data: { uploads: result.uploads } }, { status: 200 });
}

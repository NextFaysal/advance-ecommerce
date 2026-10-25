import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  requireAdminSession,
  writeCatalogAudit,
} from "@/catalog/api";
import { hasPermission } from "@/lib/rbac";
import { createProductImageUploads } from "@/catalog/media-server";
import { MAX_UPLOADS_PER_REQUEST } from "@/catalog/media";

// POST /api/v1/admin/products/upload — presigned direct-upload tickets
// for product images (P1, doc 16). Permission: products.create, same
// as product create.
//
// The file BYTES never pass through this route (and must not — the
// host's request-body limit is smaller than the 5 MB image cap). The
// client sends file METADATA only, the server validates type + size,
// and returns one presigned PUT URL per file; the client uploads each
// file straight to the configured R2/S3 storage and then stores the
// returned publicUrl on the product via the normal create/PATCH
// payloads. Storage credentials are used to sign server-side only and
// never appear in the response.
//
// Request  (JSON):
//   {
//     "productSlug": "jamdani-sharee",            // optional, key layout only
//     "files": [
//       { "filename": "front.jpg", "contentType": "image/jpeg", "sizeBytes": 182340 }
//     ]                                            // 1..10 files, image types, <= 5 MB each
//   }
// Success 200:
//   { "data": { "uploads": [ {
//       "filename", "contentType", "sizeBytes", "key",
//       "uploadUrl",   // presigned PUT URL (15 min), PUT the raw file
//                      // with the SAME Content-Type + Content-Length —
//                      // both are signed, storage rejects a mismatch
//       "publicUrl",   // final public URL once the PUT succeeds
//       "expiresInSeconds": 900
//   } ] } }
// Errors:
//   401 UNAUTHORIZED / 403 FORBIDDEN — session / products.create
//   400 VALIDATION_ERROR — body shape is wrong
//   400 INVALID_FILE — unsupported type or size (whole batch rejected)
//   503 STORAGE_NOT_CONFIGURED — no usable R2/S3 config in Admin
//        Settings/env; nothing was signed and no upload is possible.
//        The editor surfaces this honestly and keeps URL-paste open.
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
    .max(MAX_UPLOADS_PER_REQUEST),
});

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.create")) {
    return apiError("FORBIDDEN", "Missing permission: products.create", 403);
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
  const result = await createProductImageUploads({
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
    action: "products.media_upload",
    afterJson: {
      productSlug: parsed.data.productSlug ?? null,
      fileCount: result.uploads.length,
      keys: result.uploads.map((u) => u.key),
    },
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({ data: { uploads: result.uploads } }, { status: 200 });
}

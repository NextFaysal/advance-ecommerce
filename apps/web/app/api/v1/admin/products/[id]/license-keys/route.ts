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
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import {
  addLicenseKeys,
  isProductTypesEnabled,
  listLicenseKeys,
} from "@/catalog/product-types";

// License-key pool for one DIGITAL product (wave 15, doc 16 P7).
// Permission: products.edit. Feature flag: module.product_types
// (OFF -> 403 FEATURE_LOCKED).
//
// GET  -> the pool, MASKED (last 4 characters only) + assignment
//         state. Full keys never leave the server on a read.
// POST -> bulk add: { "keys": "KEY-1\nKEY-2" } (a pasted blob, one
//         key per line) or { "keys": ["KEY-1", "KEY-2"] }. Lines are
//         trimmed, blanks dropped, duplicates (inside the paste AND
//         against the existing pool) skipped and counted. The audit
//         row records COUNTS ONLY — never key material.

function locked() {
  return apiError(
    "FEATURE_LOCKED",
    "Product types are locked for this install (module.product_types is OFF).",
    403,
  );
}

const addKeysSchema = z.object({
  keys: z.union([z.string().max(200_000), z.array(z.string().max(512)).max(5000)]),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.edit")) {
    return apiError("FORBIDDEN", "Missing permission: products.edit", 403);
  }
  await ensureDbFeatureFlags();
  if (!isProductTypesEnabled()) return locked();
  try {
    const repo = await getCatalogRepository();
    const product = await repo.getProductById(params.id);
    if (!product) return apiError("NOT_FOUND", "Product not found.", 404);
    const keys = await listLicenseKeys(params.id);
    return NextResponse.json({
      data: {
        productId: params.id,
        keys,
        poolTotal: keys.length,
        poolAvailable: keys.filter((k) => !k.assigned).length,
      },
    });
  } catch (error) {
    return handleServiceError(error);
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.edit")) {
    return apiError("FORBIDDEN", "Missing permission: products.edit", 403);
  }
  await ensureDbFeatureFlags();
  if (!isProductTypesEnabled()) return locked();
  const body = await req.json().catch(() => ({}));
  const parsed = addKeysSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "License keys payload is invalid.",
          details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  try {
    const repo = await getCatalogRepository();
    const product = await repo.getProductById(params.id);
    if (!product) return apiError("NOT_FOUND", "Product not found.", 404);
    const lines =
      typeof parsed.data.keys === "string"
        ? parsed.data.keys.split(/\r?\n/)
        : parsed.data.keys;
    const result = await addLicenseKeys(params.id, lines);
    await writeCatalogAudit({
      actorId: session.userId,
      action: "products.license_keys_add",
      entityId: params.id,
      // Counts only — key material is never written to the audit log.
      afterJson: { ...result },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    return handleServiceError(error);
  }
}

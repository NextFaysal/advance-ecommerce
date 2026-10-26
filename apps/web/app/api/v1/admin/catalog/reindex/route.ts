import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { listActiveProducts } from "@/catalog/server-read";
import { BANGLISH_SYNONYMS } from "@/catalog/search";
import {
  applyIndexSettings,
  clearProductDocuments,
  addProductDocuments,
  toMeilisearchDocument,
  PRODUCTS_INDEX_UID,
} from "@/catalog/indexer";
import type { Product } from "@/catalog/types";

export async function POST(_req: Request) {
  const token = cookies().get("admin_session")?.value;
  if (!token) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin login required." } },
      { status: 401 },
    );
  }

  const session = await validateSessionToken(token);
  if (!session) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Session expired or invalid." } },
      { status: 401 },
    );
  }

  const canManage =
    hasPermission(session.user.permissions, "products.create") ||
    hasPermission(session.user.permissions, "products.edit");

  if (!canManage) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Missing permission: products.create or products.edit" } },
      { status: 403 },
    );
  }

  try {
    // 1. Ensure index exists and apply schema settings + Banglish synonyms
    const settingsResult = await applyIndexSettings();
    if (!settingsResult.ok) {
      return NextResponse.json(
        {
          error: {
            code: "MEILISEARCH_ERROR",
            message: settingsResult.reason || "Meilisearch configuration or connection error.",
          },
        },
        { status: 502 },
      );
    }

    // 2. Fetch active products to index
    const activeProducts: Product[] = await listActiveProducts(500);
    const documents = activeProducts.map(toMeilisearchDocument);

    // 3. Clear existing index documents and batch upsert
    await clearProductDocuments();
    const batchResult = await addProductDocuments(documents);

    if (!batchResult.ok) {
      return NextResponse.json(
        {
          error: {
            code: "INDEXING_FAILED",
            message: batchResult.reason || "Failed to batch index product documents.",
          },
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      data: {
        ok: true,
        indexUid: PRODUCTS_INDEX_UID,
        indexedCount: documents.length,
        synonymsCount: Object.keys(BANGLISH_SYNONYMS).length,
        at: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[Meilisearch Reindex Error]:", err);
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Reindexing failed due to an unexpected error." } },
      { status: 500 },
    );
  }
}

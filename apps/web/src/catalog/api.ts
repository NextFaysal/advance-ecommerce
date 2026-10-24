// Route helpers for catalog APIs — Agent 8; Prisma DB swap 2026-10-24.
// Session: admin_session cookie (set by Agent 2 login handlers),
// validated via lib/auth validateSessionToken. Catalog persistence is
// the real Prisma DB only: if the client is unavailable, routes return
// 503 DB_NOT_READY instead of crashing — there is NO mock fallback at
// runtime anymore (an empty DB returns empty results, not mock data).

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { CatalogRepository } from "./service";
import { DbNotReadyError, PrismaCatalogRepository, hasPrismaCatalog } from "./service";

export function apiError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function getCatalogRepository(): Promise<CatalogRepository> {
  try {
    const db = await import("@advance-ecommerce/db");
    const client: unknown = (db as { prisma?: unknown }).prisma;
    if (hasPrismaCatalog(client)) return new PrismaCatalogRepository(client);
  } catch {
    // DB package failed to load — fall through to the honest 503 below.
  }
  throw new DbNotReadyError(
    "Catalog database is not available: the Prisma client has no catalog models or the DB package failed to load.",
  );
}

export interface AdminSession {
  userId: string;
  permissions: string[];
}

export async function requireAdminSession(): Promise<AdminSession | NextResponse> {
  const token = cookies().get("admin_session")?.value;
  if (!token) return apiError("UNAUTHORIZED", "Login required.", 401);
  try {
    const { validateSessionToken } = await import("@/lib/auth");
    const session = await validateSessionToken(token);
    if (!session) return apiError("UNAUTHORIZED", "Session expired. Please log in again.", 401);
    return { userId: session.user.id, permissions: session.user.permissions };
  } catch {
    return apiError("DB_NOT_READY", "Auth is not available until Prisma is generated and the DB is migrated.", 503);
  }
}

export async function writeCatalogAudit(input: {
  actorId: string | null;
  action: string;
  entityId?: string | null;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  reason?: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  try {
    const { writeAudit } = await import("@/lib/audit");
    await writeAudit({ ...input, entityType: "Product" });
  } catch {
    // Audit lib already logs its own failures; never fail the API call on audit import errors.
  }
}

export function handleServiceError(error: unknown): NextResponse {
  if (error instanceof DbNotReadyError) return apiError("DB_NOT_READY", error.message, 503);
  if (error instanceof Error && error.message.includes("not found")) return apiError("NOT_FOUND", error.message, 404);
  if (error instanceof Error && error.message.includes("Reason is required")) return apiError("REASON_REQUIRED", error.message, 400);
  console.error("Catalog API error");
  void error;
  return apiError("INTERNAL", "Something went wrong.", 500);
}

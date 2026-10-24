import { NextResponse } from "next/server";
import { buildOpenApiDocument } from "@/platform/openapi";

// Public OpenAPI 3.1 document — Agent 37.
// Built from the route registry in src/platform/openapi.ts. Contains
// summaries and the auth model only — no secrets or internal notes.
export async function GET() {
  return NextResponse.json(buildOpenApiDocument(), {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}

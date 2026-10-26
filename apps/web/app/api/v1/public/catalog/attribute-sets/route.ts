import { NextResponse } from "next/server";
import { handleServiceError } from "@/catalog/api";
import { listAttributeSetsAdmin } from "@/catalog/attributes-admin";
import { catalogCacheHeaders } from "@/lib/http-cache";

// GET /api/v1/public/catalog/attribute-sets — the attribute-set
// library the shop's filter facets are built from, in its public
// shape only ({ key, labelBn, labelEn, values }): this is a filter
// library, no admin data rides along (ids/timestamps dropped). The
// shop's client browser consumes this endpoint instead of a server
// render, so /shop can be served from the edge cache; facet-library
// edits show within the 300s edge window.
export async function GET() {
  try {
    const sets = await listAttributeSetsAdmin();
    return NextResponse.json(
      {
        data: sets.map((s) => ({
          key: s.key,
          labelBn: s.labelBn,
          labelEn: s.labelEn,
          values: s.values,
        })),
      },
      { headers: catalogCacheHeaders(300) },
    );
  } catch (error) {
    return handleServiceError(error);
  }
}

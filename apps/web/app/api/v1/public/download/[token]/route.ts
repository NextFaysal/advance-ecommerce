import { NextResponse } from "next/server";
import { redeemDownloadToken } from "@/catalog/product-types";

// GET /api/v1/public/download/[token] — redeem a digital download
// grant (wave 15, doc 16 P7). The token is a bearer secret issued at
// fulfilment (order PAID); only its SHA-256 hash is stored, so this
// route is the only place a raw token is ever seen.
//
// Success: 302 redirect to a short-lived (15 min) presigned GET URL
// for the file in R2/S3 — the storage key itself is never exposed.
// The download count is consumed only when the redirect is issued.
// Errors (JSON, honest codes):
//   404 NOT_FOUND              — unknown token
//   410 EXPIRED                — past the grant's 7-day expiry
//   403 EXHAUSTED              — maxDownloads (5) already used
//   403 FEATURE_LOCKED         — module.product_types is OFF
//   503 STORAGE_NOT_CONFIGURED — storage settings missing (the use is
//                                NOT consumed in this case)
const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  EXPIRED: 410,
  EXHAUSTED: 403,
  FEATURE_LOCKED: 403,
  STORAGE_NOT_CONFIGURED: 503,
};

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const token = (params.token ?? "").trim();
  if (token === "" || token.length > 256) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "ডাউনলোড লিংকটি পাওয়া যায়নি।" } },
      { status: 404 },
    );
  }
  const result = await redeemDownloadToken(token);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: STATUS_BY_CODE[result.code] ?? 400 },
    );
  }
  return NextResponse.redirect(result.url, 302);
}

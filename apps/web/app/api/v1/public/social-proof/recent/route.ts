/**
 * GET /api/v1/public/social-proof/recent — the recent-orders
 * ticker feed (doc 23 wave 60 / P11, honest social proof).
 *
 * Returns the privacy-safe projection built by
 * src/marketing/social-proof.ts: first name + district + first
 * item's product name + order instant, from REAL eligible orders
 * of the last 30 days. No totals, no order numbers, no phones —
 * nothing identifiable ever leaves through here.
 *
 * Gating + failure semantics (mirrors the sibling public routes):
 *  - module.social_proof flag OFF -> { data: { entries: [] } }.
 *    The ticker renders nothing for an empty list, so the flag
 *    fully darkens the surface.
 *  - Any error -> the same empty payload with 200. This endpoint
 *    feeds a marketing strip; it must never surface an error to
 *    the storefront (listRecentOrderProof already fail-safes to
 *    [], the try/catch here is the second belt).
 *
 * The payload is identical for every visitor, so it is
 * edge-cached (s-maxage=300, like /api/v1/public/site-status):
 * the relative "N ঘণ্টা আগে" wording is computed CLIENT-side
 * from each entry's orderedAt timestamp, so a cached response
 * never makes the words stale or untrue.
 */
import { NextResponse } from "next/server";
import {
  listRecentOrderProof,
  socialProofEnabled,
} from "@/marketing/social-proof";

export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
} as const;

export async function GET() {
  try {
    if (!socialProofEnabled()) {
      return NextResponse.json(
        { data: { entries: [] }, meta: { source: "orders:recent", gated: "flag-off" } },
        { headers: CACHE_HEADERS },
      );
    }
    const entries = await listRecentOrderProof();
    return NextResponse.json(
      { data: { entries }, meta: { source: "orders:recent" } },
      { headers: CACHE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { data: { entries: [] }, meta: { source: "orders:recent" } },
      { headers: CACHE_HEADERS },
    );
  }
}

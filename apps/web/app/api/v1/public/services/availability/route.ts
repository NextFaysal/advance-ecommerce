/**
 * GET /api/v1/public/services/availability?variantId=&date=
 * (ADV-23 vertical 2, doc 23 wave 56).
 *
 * The day's slot grid for one bookable variant, each slot carrying
 * its BOOKED count vs the configured capacity. A day that cannot be
 * booked at all (past date / closed weekday / beyond the advance
 * window / malformed date) returns an empty slot list WITH a
 * `reason` — never a bare empty list the client must guess at. A
 * variant that is not on the merchant's serviceVariantIds list
 * returns reason NOT_A_SERVICE. Flag OFF -> 403 FEATURE_LOCKED,
 * the add-on shape used across the public module APIs.
 *
 * The create path re-validates everything (grid, window, capacity
 * inside the create transaction) — this read is a picker aid, not
 * a reservation.
 */
import { NextResponse } from "next/server";
import { getServiceAvailability } from "@/services/bookings";
import { isServicesEnabled } from "@/services/flags";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isServicesEnabled()) {
    return NextResponse.json(
      {
        error: {
          code: "FEATURE_LOCKED",
          message:
            "সেবা বুকিং মডিউল এই ইনস্টলে বন্ধ আছে। / The services booking module is locked for this install (module.services is OFF).",
        },
      },
      { status: 403 },
    );
  }
  const url = new URL(req.url);
  const variantId = url.searchParams.get("variantId")?.trim() ?? "";
  const date = url.searchParams.get("date")?.trim() ?? "";
  if (!variantId || !date) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "variantId and date (yyyy-mm-dd) query parameters are required.",
        },
      },
      { status: 400 },
    );
  }
  try {
    const availability = await getServiceAvailability(variantId, date);
    return NextResponse.json({ data: availability, meta: { persistence: "database" } });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Availability needs a working database connection." } },
      { status: 503 },
    );
  }
}

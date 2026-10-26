/**
 * GET /api/v1/public/rental/availability?variantId=&start=&end=
 * (ADV-23 vertical 3, doc 23 wave 56).
 *
 * How many units of one rentable variant can still go out for the
 * whole requested window: the variant's stock (its physical fleet
 * size) minus the live rentals (stored ACTIVE or OVERDUE) whose
 * windows overlap. A window that cannot be rented at all (past
 * start / end before start / longer than maxRentalDays / malformed
 * dates) returns availableUnits 0 WITH a `reason` — never a bare
 * zero the client must guess at. A variant that is not on the
 * merchant's rentalVariantIds list returns reason NOT_A_RENTAL.
 * Flag OFF -> 403 FEATURE_LOCKED, the add-on shape used across the
 * public module APIs.
 *
 * The create path re-validates everything (list, window, length)
 * and recounts the overlap inside the create transaction — this
 * read is a picker aid, not a reservation.
 */
import { NextResponse } from "next/server";
import { getRentalAvailability } from "@/rental/bookings";
import { isRentalEnabled } from "@/rental/flags";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isRentalEnabled()) {
    return NextResponse.json(
      {
        error: {
          code: "FEATURE_LOCKED",
          message:
            "ভাড়া মডিউল এই ইনস্টলে বন্ধ আছে। / The rental module is locked for this install (module.rental is OFF).",
        },
      },
      { status: 403 },
    );
  }
  const url = new URL(req.url);
  const variantId = url.searchParams.get("variantId")?.trim() ?? "";
  const start = url.searchParams.get("start")?.trim() ?? "";
  const end = url.searchParams.get("end")?.trim() ?? "";
  if (!variantId || !start || !end) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "variantId, start and end (yyyy-mm-dd) query parameters are required.",
        },
      },
      { status: 400 },
    );
  }
  try {
    const availability = await getRentalAvailability(variantId, start, end);
    return NextResponse.json({ data: availability, meta: { persistence: "database" } });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Availability needs a working database connection." } },
      { status: 503 },
    );
  }
}

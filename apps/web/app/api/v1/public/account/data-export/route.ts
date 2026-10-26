/**
 * GET /api/v1/public/account/data-export — the signed-in customer's
 * full data export as a JSON file download (ADV-29).
 *
 * Auth: the customer_session cookie (requireCustomer) — a customer
 * can only ever export their OWN record; there is no id parameter.
 * The export is assembled from real queries (src/privacy/export.ts),
 * every section labelled with its source table, and the event is
 * recorded durably BEFORE the file is served (privacy.exports
 * ledger + best-effort AuditLog row) — the downloaded document's own
 * meta states both recording outcomes.
 *
 * Rate-limited (5/hour per customer): the export is the heaviest
 * read on the account surface and a stolen session cookie should
 * not be able to scrape it in a loop.
 */
import { NextResponse } from "next/server";
import { errorResponse, requireCustomer, unauthorized } from "@/customer-auth/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildCustomerDataExport, recordExportEvent } from "@/privacy/export";

export const dynamic = "force-dynamic";

export async function GET() {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();

  const limit = await checkRateLimit(`data-export:${customer.id}`, 5, 60 * 60 * 1000);
  if (!limit.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "অনেকবার ডাউনলোড করা হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন।",
      429,
    );
  }

  const doc = await buildCustomerDataExport(customer.id);
  if (doc === null) return unauthorized();

  await recordExportEvent(doc);

  const body = JSON.stringify(doc, null, 2);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="my-data-export.json"',
      "Cache-Control": "no-store",
    },
  });
}

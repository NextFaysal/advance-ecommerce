import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { listNewsletterSubscribers } from "@/newsletter/store-db";
import { NewsletterStoreUnavailableError } from "@/newsletter/store";

// Newsletter subscribers — admin read (wave 7). RBAC:
// marketing.coupon, the marketing-area permission the sibling
// marketing routes (coupons) and the /admin/newsletter nav entry use.
// Persistence: Prisma DB via src/newsletter/store-db.ts
// (NewsletterSubscriber table). Until this endpoint existed the
// subscribers persisted by the public form were invisible to staff.
// Read-only: no unsubscribe/delete action here — the public
// unsubscribe flow owns status changes.
export async function GET(req: Request) {
  const guard = await requireAdmin("marketing.coupon");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const url = new URL(req.url);
  const rawTake = Number(url.searchParams.get("take") ?? "50");
  const take = Number.isFinite(rawTake) ? Math.min(200, Math.max(1, Math.trunc(rawTake))) : 50;

  try {
    const { subscribers, total, subscribedTotal } = await listNewsletterSubscribers(take);
    return NextResponse.json({
      data: {
        subscribers: subscribers.map((s) => ({
          email: s.email,
          source: s.source,
          status: s.status,
          createdAt: s.createdAt,
        })),
        total,
        subscribedTotal,
      },
      meta: { persistence: "database" },
    });
  } catch (e) {
    if (e instanceof NewsletterStoreUnavailableError) {
      return NextResponse.json(
        {
          error: { code: "NEWSLETTER_NOT_READY", message: "Newsletter store is not available yet." },
          meta: { persistence: "unavailable", reason: "model-pending" },
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Newsletter database is not available." } },
      { status: 503 },
    );
  }
}

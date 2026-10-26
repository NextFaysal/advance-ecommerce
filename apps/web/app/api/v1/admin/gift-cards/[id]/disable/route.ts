import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { disableGiftCard } from "@/marketing/gift-cards";
import { recordDemoAudit } from "../../../audit-log/store";

// POST /api/v1/admin/gift-cards/[id]/disable (ADV-18) — staff disable
// of a gift card (marketing.campaign). Flips the stored status to
// DISABLED; the ledger is untouched and the state is terminal by
// design (a disabled bearer card is replaced, never re-enabled), so
// a repeat call is an idempotent no-op that returns the same view.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isFeatureEnabled("module.marketing_mechanics")) {
    return NextResponse.json(
      {
        error: {
          code: "FEATURE_LOCKED",
          message: "Marketing mechanics module is locked for this install (module.marketing_mechanics is OFF).",
        },
      },
      { status: 403 },
    );
  }
  const { id } = await params;
  const card = await disableGiftCard(id);
  if (!card) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Gift card not found." } },
      { status: 404 },
    );
  }
  await recordDemoAudit({
    actorId: guard.userId,
    action: "gift_card.disable",
    entityType: "GiftCard",
    entityId: id,
    afterJson: { codeLast4: card.codeLast4, balancePoisha: card.balancePoisha },
  });
  return NextResponse.json({
    data: { card },
    meta: { persistence: "database", module: "module.marketing_mechanics" },
  });
}

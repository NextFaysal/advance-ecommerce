import { NextResponse } from "next/server";
import { requireAdmin, guardError } from "@/reports/guard";
import { marketingMechanicsEnabled, prismaMarketingDocStore } from "@/marketing/docs";
import { sendCampaign } from "@/marketing/broadcast";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/admin/marketing/broadcasts/[id]/send
 * Attempts the campaign through the Meta WhatsApp adapter. When the
 * channel is not configured the campaign is recorded NOT_SENT with
 * the missing Settings keys as the reason — never as sent.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!marketingMechanicsEnabled()) {
    return NextResponse.json(
      { error: { code: "FEATURE_LOCKED", message: "Marketing mechanics module is locked for this install." } },
      { status: 403 },
    );
  }
  const result = await sendCampaign(prismaMarketingDocStore(), params.id, guard.userId);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: result.code === "NOT_FOUND" ? 404 : 409 },
    );
  }
  return NextResponse.json({ data: { campaign: result.campaign } });
}

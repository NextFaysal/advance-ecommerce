import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, guardError } from "@/reports/guard";
import { marketingMechanicsEnabled, prismaMarketingDocStore } from "@/marketing/docs";
import {
  loadBroadcastsDoc,
  createCampaign,
  computeBroadcastAudience,
  getBroadcastChannelStatus,
  BROADCAST_BATCH_CAP,
} from "@/marketing/broadcast";

export const dynamic = "force-dynamic";

function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Marketing mechanics module is locked for this install." } },
    { status: 403 },
  );
}

const createSchema = z.object({
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(2000),
});

/** GET — campaigns + the live audience size + the WhatsApp channel
 *  configuration state (key names only, never values). */
export async function GET() {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!marketingMechanicsEnabled()) return locked();
  const [doc, audience, channel] = await Promise.all([
    loadBroadcastsDoc(prismaMarketingDocStore()),
    computeBroadcastAudience(),
    getBroadcastChannelStatus(),
  ]);
  return NextResponse.json({
    data: { campaigns: doc.campaigns, audienceCount: audience.length, channel },
    meta: {
      batchCap: BROADCAST_BATCH_CAP,
      audienceDefinition:
        "Newsletter subscribers (status subscribed) whose email matches a customer with a phone, not blocked/deleted. No dedicated WhatsApp opt-in field exists.",
    },
  });
}

/** POST — create a DRAFT campaign (nothing is sent here). */
export async function POST(req: Request) {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!marketingMechanicsEnabled()) return locked();
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Title and message are required." } }, { status: 400 });
  }
  const campaign = await createCampaign(prismaMarketingDocStore(), parsed.data, guard.userId);
  return NextResponse.json({ data: { campaign } }, { status: 201 });
}

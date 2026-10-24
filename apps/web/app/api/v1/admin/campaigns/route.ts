import { NextResponse } from "next/server";
import { createCampaignSchema, estimateCampaignCost } from "@/marketing/service";
import type { Campaign } from "@/marketing/campaign";
import { guardError, requireAdmin } from "@/reports/guard";

// Campaigns — Agent 10, Step 26. Creation computes cost only; NO message is
// sent here. Dispatch is a BullMQ job (Step 26 owner) using the admin-
// configured SMS/email provider (settings, encrypted — never returned here).
// RBAC: marketing.campaign.
const campaigns: Campaign[] = [];

export async function GET() {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  return NextResponse.json({ data: { campaigns }, meta: { persistence: "in-memory-stub", sends: "not-wired" } });
}
export async function POST(req: Request) {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = createCampaignSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid campaign.", details: parsed.error.issues } }, { status: 400 });
  const estimate = estimateCampaignCost(parsed.data);
  const campaign: Campaign = {
    id: `cmp_${Date.now()}`,
    channel: parsed.data.channel,
    segmentRef: parsed.data.segmentRef,
    templateKey: parsed.data.templateKey,
    scheduledAt: parsed.data.scheduledAt,
    recipientCount: parsed.data.recipientCount,
    sentCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    costEstimatePoisha: estimate.costEstimatePoisha,
    status: parsed.data.scheduledAt ? "scheduled" : "draft",
  };
  campaigns.push(campaign);
  return NextResponse.json({ data: { campaign, estimate }, meta: { persistence: "in-memory-stub", sends: "not-wired" } }, { status: 201 });
}

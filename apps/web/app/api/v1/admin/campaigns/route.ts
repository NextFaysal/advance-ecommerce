import { NextResponse } from "next/server";
import { createCampaignSchema, estimateCampaignCost } from "@/marketing/service";
import { createCampaignDb, listCampaignsDb } from "@/marketing/repository";
import { guardError, requireAdmin } from "@/reports/guard";

// Campaigns — Agent 10, Step 26. Creation computes cost only; NO message
// is sent here. Dispatch is a BullMQ job (Step 26 owner) using the
// admin-configured SMS/email provider (settings, encrypted — never
// returned here). RBAC: marketing.campaign.
// DB-backed (Campaign table, src/marketing/repository.ts). Drift: the
// table has no recipientCount column — creates echo the submitted
// count in the response, list reads report 0 (see repository header).

export async function GET() {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const campaigns = await listCampaignsDb();
    return NextResponse.json({ data: { campaigns }, meta: { persistence: "database", sends: "not-wired" } });
  } catch {
    return NextResponse.json({ error: { code: "DB_NOT_READY", message: "Campaigns need a working database." } }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = createCampaignSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid campaign.", details: parsed.error.issues } }, { status: 400 });
  const estimate = estimateCampaignCost(parsed.data);
  try {
    const campaign = await createCampaignDb(parsed.data, estimate.costEstimatePoisha);
    return NextResponse.json({ data: { campaign, estimate }, meta: { persistence: "database", sends: "not-wired" } }, { status: 201 });
  } catch {
    return NextResponse.json({ error: { code: "DB_NOT_READY", message: "Campaigns need a working database." } }, { status: 503 });
  }
}

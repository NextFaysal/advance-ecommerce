import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { requireFeature } from "@/ai/feature-flag";
import { AI_FEATURE_FLAG } from "@/ai/types";
import { aiProvider } from "@/ai/provider";

// POST /api/v1/admin/ai/classify { text }
// AI Provider sentiment/spam analysis with keyword fallback.
// Never auto-delete on a spam verdict. RBAC: marketing.campaign.
const bodySchema = z.object({ text: z.string().min(1).max(5000) });

export async function POST(req: Request) {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const flag = await requireFeature(AI_FEATURE_FLAG);
  if (!flag.enabled) return NextResponse.json({ error: { code: flag.code, message: flag.message } }, { status: flag.status });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "text (1-5000 chars) is required." } }, { status: 400 });
  }

  const result = await aiProvider.classifyText(parsed.data.text);

  return NextResponse.json({
    data: result,
    meta: {
      engine: result.meta.engine,
      note: result.meta.label,
    },
  });
}

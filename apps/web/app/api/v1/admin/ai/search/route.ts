import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { requireFeature } from "@/ai/feature-flag";
import { ANALYTICS_FEATURE_FLAG } from "@/ai/types";
import { answerAskQuery, parseCommandQuery } from "@/ai/search";
import { DEMO_SALES_ROWS } from "@/reports/demo";

// POST /api/v1/admin/ai/search { query, from?, to? }
// Rule parser for the admin command bar + Ask Your Data over
// src/reports aggregateSales(). Rows are TEMPORARY_DEMO until order DB
// queries land — the response says so in meta. RBAC: reports.view.
const bodySchema = z.object({
  query: z.string().min(1).max(300),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2000-01-01"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default("2099-12-31"),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("reports.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const flag = await requireFeature(ANALYTICS_FEATURE_FLAG);
  if (!flag.enabled) return NextResponse.json({ error: { code: flag.code, message: flag.message } }, { status: flag.status });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "query is required; from/to must be YYYY-MM-DD." } }, { status: 400 });
  }
  const { query, from, to } = parsed.data;
  return NextResponse.json({
    data: {
      parsed: parseCommandQuery(query),
      answer: answerAskQuery(query, DEMO_SALES_ROWS, from, to),
    },
    meta: { source: "TEMPORARY_DEMO", note: "Aggregation by src/reports aggregateSales() over demo rows until order DB queries land." },
  });
}

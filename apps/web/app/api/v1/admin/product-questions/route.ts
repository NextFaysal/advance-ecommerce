import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { QUESTION_STATUSES, type QuestionStatus } from "@/qa/schema";
import { countQuestionsByStatus, listQuestionsForAdmin } from "@/qa/store";

// GET /api/v1/admin/product-questions — Q&A moderation queue.
// RBAC: content.page (same convention as review moderation — Q&A is
// product-content work). ?status=PENDING|ANSWERED|HIDDEN filters;
// no param returns the latest 100 of every status.
export async function GET(req: Request) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const rawStatus = new URL(req.url).searchParams.get("status");
  const status =
    rawStatus && (QUESTION_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as QuestionStatus)
      : undefined;

  const [questions, counts] = await Promise.all([
    listQuestionsForAdmin(status),
    countQuestionsByStatus(),
  ]);
  return NextResponse.json({
    data: { questions, counts },
    meta: { persistence: "database" },
  });
}

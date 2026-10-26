import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { moderateQuestionSchema } from "@/qa/schema";
import { answerQuestion, hideQuestion, restoreQuestion } from "@/qa/store";

// PATCH /api/v1/admin/product-questions/[id] — moderate one question.
// RBAC: content.page (same as review moderation).
//   { action: "answer", answer } → ANSWERED (publicly visible)
//   { action: "hide" }            → HIDDEN (staff-only)
//   { action: "restore" }         → ANSWERED if answered, else PENDING
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const parsed = moderateQuestionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid moderation action.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  const question =
    parsed.data.action === "answer"
      ? await answerQuestion(params.id, guard.userId, parsed.data.answer)
      : parsed.data.action === "hide"
        ? await hideQuestion(params.id)
        : await restoreQuestion(params.id);

  if (!question) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Question not found." } },
      { status: 404 },
    );
  }
  return NextResponse.json({
    data: { question },
    meta: { persistence: "database" },
  });
}

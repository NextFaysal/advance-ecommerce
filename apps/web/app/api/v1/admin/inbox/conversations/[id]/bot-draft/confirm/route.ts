import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { BOT_ENGINE, confirmBotDraft } from "@/inbox/bot";

// Staff one-tap confirm of a conversation's bot draft —
// F-commerce order bot v1 (doc 22 ADV-6 part 3). RBAC: orders.create.
//
// The service RE-COMPUTES the draft from the current thread (a client
// copy is never trusted) and creates the REAL order through the
// shared createManualOrder with source "inbox-bot". Rejections keep
// the draft editable in the existing conversion panel: 422
// BOT_PHONE_MISSING / BOT_DRAFT_INCOMPLETE / BOT_DRAFT_INVALID /
// BOT_LOW_CONFIDENCE, plus the create service's own errors passed
// through untouched. Gating: 403 FEATURE_LOCKED (module OFF) /
// BOT_DISABLED (bot setting OFF).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("orders.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  let outcome: Awaited<ReturnType<typeof confirmBotDraft>>;
  try {
    outcome = await confirmBotDraft(params.id, {
      id: guard.userId,
      permissions: guard.permissions,
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Inbox database is not available." } },
      { status: 503 },
    );
  }

  switch (outcome.status) {
    case "disabled":
      return NextResponse.json(
        { error: { code: outcome.code, message: outcome.message } },
        { status: 403 },
      );
    case "not_found":
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Conversation not found." } },
        { status: 404 },
      );
    case "rejected":
      return NextResponse.json(
        {
          error: {
            code: outcome.code,
            message: outcome.message,
            details: outcome.details,
          },
        },
        { status: outcome.httpStatus },
      );
    case "created":
      return NextResponse.json(
        {
          data: {
            order: {
              id: outcome.orderId,
              orderNo: outcome.orderNo,
              totalPoisha: outcome.totalPoisha,
              pricing: outcome.pricing,
            },
          },
          meta: { source: "inbox-bot", engine: BOT_ENGINE, conversationId: params.id },
        },
        { status: 201 },
      );
  }
}

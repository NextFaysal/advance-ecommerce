import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoInboxFlags, isInboxEnabled } from "@/inbox/flags";
import { dismissBotDraft } from "@/inbox/bot";

// Dismiss a conversation's bot draft — F-commerce order bot v1
// (doc 22 ADV-6 part 3). RBAC: orders.create.
//
// Drafts are computed on read and never persisted, so a dismissal is
// a process-local marker keyed by the thread's current fingerprint
// (src/inbox/bot.ts): the draft stays hidden until a NEW inbound
// message arrives, then it reappears — a dismissal never swallows a
// customer's new information. meta.persistence says so honestly.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("orders.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isInboxEnabled(demoInboxFlags)) {
    return NextResponse.json(
      {
        error: {
          code: "FEATURE_LOCKED",
          message: "F-commerce inbox is locked for this install (module.f_commerce is OFF).",
        },
      },
      { status: 403 },
    );
  }
  let dismissed: boolean;
  try {
    dismissed = await dismissBotDraft(params.id);
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Inbox database is not available." } },
      { status: 503 },
    );
  }
  if (!dismissed) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Conversation not found." } },
      { status: 404 },
    );
  }
  return NextResponse.json(
    {
      data: { dismissed: true },
      meta: { persistence: "in-memory-dismiss", conversationId: params.id },
    },
    { status: 200 },
  );
}

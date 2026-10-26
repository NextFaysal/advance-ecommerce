import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { BOT_ENGINE, maybeCreateBotDraft } from "@/inbox/bot";

// Bot draft for one conversation — F-commerce order bot v1
// (doc 22 ADV-6 part 3, src/inbox/bot.ts). RBAC: orders.create,
// mirroring the sibling inbox draft route.
//
//   GET  — the CURRENT bot draft, computed on read from the stored
//          thread (drafts are never persisted). Answers
//          { draft: null, dismissed: true } when staff dismissed the
//          draft for the thread's current state.
//   POST — "বট ড্রাফট তৈরি করুন": (re)generate — same computation,
//          but clears any dismissal first (201 when a draft is made).
//
// Gating lives in the service and is mapped here honestly:
// module.f_commerce OFF -> 403 FEATURE_LOCKED; bot setting OFF ->
// 403 BOT_DISABLED. Nothing is returned as if a draft existed.
function errorJson(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function handle(id: string, force: boolean) {
  let outcome: Awaited<ReturnType<typeof maybeCreateBotDraft>>;
  try {
    outcome = await maybeCreateBotDraft(id, undefined, { force });
  } catch {
    return errorJson(503, "DB_NOT_READY", "Inbox database is not available.");
  }
  switch (outcome.status) {
    case "disabled":
      return errorJson(403, outcome.code, outcome.message);
    case "not_found":
      return errorJson(404, "NOT_FOUND", "Conversation not found.");
    case "dismissed":
      return NextResponse.json(
        {
          data: { draft: null, dismissed: true },
          meta: { engine: BOT_ENGINE, persistence: "computed-on-read", isOrder: false },
        },
        { status: 200 },
      );
    case "created":
      return NextResponse.json(
        {
          data: { draft: outcome.draft, dismissed: false },
          meta: { engine: BOT_ENGINE, persistence: "computed-on-read", isOrder: false },
        },
        { status: force ? 201 : 200 },
      );
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("orders.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  return handle(params.id, false);
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("orders.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  return handle(params.id, true);
}

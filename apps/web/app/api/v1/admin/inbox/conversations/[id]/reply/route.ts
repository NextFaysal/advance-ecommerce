import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoInboxFlags, isInboxEnabled } from "@/inbox/flags";
import { getConversationDb } from "@/inbox/store";
import { MetaSendError, sendStaffReply } from "@/inbox/send";

// Staff reply on an inbox conversation — doc 22 ADV-6 part 2.
// Guard mirrors the sibling mark-read route: RBAC customers.view +
// the module.f_commerce feature flag (OFF -> 403 FEATURE_LOCKED).
//
// Behaviour by channel configuration (Settings meta.* keys, read
// server-side only — no token ever appears in any response):
// - Channel CONFIGURED -> real send via src/inbox/send.ts. Provider
//   success persists an OUTBOUND InboxMessage carrying the platform
//   message id and returns it; provider failure -> 502 with the
//   provider's own error message and NOTHING persisted as sent;
//   provider success + local persist failure -> 500 PERSIST_FAILED
//   (the message DID leave — staff are told to check the channel
//   before resending, so nobody double-sends blind).
// - Channel NOT configured -> 200 { status: "queued" }: the pre-ADV-6
//   honest demo behaviour, unchanged. Nothing is persisted and no API
//   is called; the client keeps the reply as a page-state intent
//   labelled "কিউ করা — পাঠানো হয়নি".
function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "F-commerce inbox is locked for this install (module.f_commerce is OFF)." } },
    { status: 403 },
  );
}

const replySchema = z.object({
  text: z.string().min(1).max(4000),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("customers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isInboxEnabled(demoInboxFlags)) return locked();

  const parsed = replySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "A non-empty reply text (max 4000 chars) is required." } },
      { status: 400 },
    );
  }

  let conversation;
  try {
    const found = await getConversationDb(params.id);
    if (!found) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Conversation not found." } },
        { status: 404 },
      );
    }
    conversation = found.conversation;
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Inbox database is not available." } },
      { status: 503 },
    );
  }

  try {
    const outcome = await sendStaffReply(conversation, parsed.data.text);
    if (outcome.status === "queued") {
      return NextResponse.json({
        data: { status: "queued", reason: outcome.reason, missingFields: outcome.missingFields },
        meta: { persistence: "database", module: "module.f_commerce", channelsLive: false },
      });
    }
    return NextResponse.json({
      data: { status: "sent", message: outcome.message },
      meta: { persistence: "database", module: "module.f_commerce", channelsLive: true },
    });
  } catch (err) {
    if (err instanceof MetaSendError) {
      return NextResponse.json(
        {
          error: {
            code: "PROVIDER_SEND_FAILED",
            message: err.message,
            details: { providerCode: err.code, channel: err.channel },
          },
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "PERSIST_FAILED",
          message:
            "Meta accepted the message but saving it to the inbox failed. Check the channel before resending to avoid a duplicate.",
        },
      },
      { status: 500 },
    );
  }
}

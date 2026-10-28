import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoInboxFlags, isInboxEnabled } from "@/inbox/flags";
import { toConversationView } from "@/inbox/service";
import { getConversationDb, loadInbox } from "@/inbox/store";
import { getInboxChannelsLiveMeta } from "@/inbox/meta-channels";
import { getSetting } from "@/lib/settings";
import { extractPhoneFromMessages } from "@/inbox/conversion";
import { maskPhone } from "@/checkout/validation";

// F-commerce inbox — Agent 14, Step 46 (A6/G). RBAC: customers.view.
// Phone privacy (D2 fix): the extracted phone is returned MASKED by
// default; the full number is released only when the caller's session
// holds customers.view_full_phone — the same gate the call-center uses.
// The list shape carries phoneDetected: boolean alongside the masked
// value so clients never need the full number to render state.
// Feature flag: module.f_commerce (defaults OFF -> 403 FEATURE_LOCKED).
// Persistence: Prisma DB via src/inbox/store.ts. Receive side is LIVE
// for configured channels (ADV-6 part 1 — Meta webhook in
// src/inbox/meta-channels.ts); meta.channelsLive + meta.channels are
// COMPUTED from Settings (meta.*), never hardcoded. The send side
// (Graph API replies) is not built yet.
function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "F-commerce inbox is locked for this install (module.f_commerce is OFF)." } },
    { status: 403 },
  );
}

function dbNotReady() {
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Inbox database is not available." } },
    { status: 503 },
  );
}

export async function GET(req: Request) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("customers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isInboxEnabled(demoInboxFlags)) return locked();
  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId");
  const channelsMeta = await getInboxChannelsLiveMeta({ getSetting });
  try {
    if (conversationId) {
      const found = await getConversationDb(conversationId);
      if (!found) {
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "Conversation not found." } }, { status: 404 });
      }
      const canViewFullPhone = guard.permissions.includes("customers.view_full_phone");
      const detected = extractPhoneFromMessages(found.messages);
      return NextResponse.json({
        data: {
          conversation: toConversationView(found.conversation),
          messages: found.messages,
          detectedPhone: detected
            ? canViewFullPhone
              ? detected
              : maskPhone(detected)
            : null,
          phoneDetected: detected !== null,
        },
        meta: { persistence: "database", module: "module.f_commerce", ...channelsMeta },
      });
    }
    const { conversations } = await loadInbox();
    return NextResponse.json({
      data: { conversations: conversations.map(toConversationView) },
      meta: { persistence: "database", module: "module.f_commerce", ...channelsMeta },
    });
  } catch {
    return dbNotReady();
  }
}

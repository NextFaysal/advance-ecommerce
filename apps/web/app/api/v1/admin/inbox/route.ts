import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoInboxFlags, isInboxEnabled } from "@/inbox/flags";
import {
  demoConversations,
  demoMessages,
  messagesForConversation,
  toConversationView,
} from "@/inbox/service";
import { buildOrderDraft, extractPhoneFromMessages } from "@/inbox/conversion";
import { maskPhone } from "@/checkout/validation";

// F-commerce inbox — Agent 14, Step 46 (A6/G). RBAC: customers.view.
// Phone privacy (D2 fix): the extracted phone is returned MASKED by
// default; the full number is released only when the caller's session
// holds customers.view_full_phone — the same gate the call-center uses.
// Feature flag: module.f_commerce (demo store, defaults OFF -> 403 FEATURE_LOCKED).
// Channels are types only in this slice — NO Messenger/Instagram/WhatsApp API
// is called and no channel token exists in this code. Demo conversations
// stand in for webhook-ingested threads.
function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "F-commerce inbox is locked for this install (module.f_commerce is OFF)." } },
    { status: 403 },
  );
}

export async function GET(req: Request) {
  const guard = await requireAdmin("customers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isInboxEnabled(demoInboxFlags)) return locked();
  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversationId");
  if (conversationId) {
    const conv = demoConversations.find((c) => c.id === conversationId);
    if (!conv) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Conversation not found." } }, { status: 404 });
    }
    const canViewFullPhone = guard.permissions.includes("customers.view_full_phone");
    const detected = extractPhoneFromMessages(messagesForConversation(demoMessages, conv.id));
    return NextResponse.json({
      data: {
        conversation: toConversationView(conv),
        messages: messagesForConversation(demoMessages, conv.id),
        detectedPhone: detected
          ? canViewFullPhone
            ? detected
            : maskPhone(detected)
          : null,
        phoneDetected: detected !== null,
      },
      meta: { persistence: "in-memory-demo", module: "module.f_commerce", channelsLive: false },
    });
  }
  return NextResponse.json({
    data: { conversations: demoConversations.map(toConversationView) },
    meta: { persistence: "in-memory-demo", module: "module.f_commerce", channelsLive: false },
  });
}

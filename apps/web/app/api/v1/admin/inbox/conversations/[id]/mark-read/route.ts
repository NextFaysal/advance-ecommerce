import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoInboxFlags, isInboxEnabled } from "@/inbox/flags";
import { toConversationView } from "@/inbox/service";
import { markConversationReadDb } from "@/inbox/store";
import { getInboxChannelsLiveMeta } from "@/inbox/meta-channels";
import { getSetting } from "@/lib/settings";

// Mark an inbox conversation read — W0-E (doc 21 G3-10). Guard mirrors
// the sibling inbox list/detail route exactly: RBAC customers.view +
// the module.f_commerce feature flag (OFF -> 403 FEATURE_LOCKED).
// Stamps InboxConversation.lastReadAt = now via the DB store; the
// response carries the conversation re-read through the SAME read
// model the list uses, so the returned unreadCount (0 unless a new
// inbound message landed in between) is exactly what a reload shows.
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

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("customers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isInboxEnabled(demoInboxFlags)) return locked();
  try {
    const conversation = await markConversationReadDb(params.id);
    if (!conversation) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Conversation not found." } }, { status: 404 });
    }
    const channelsMeta = await getInboxChannelsLiveMeta({ getSetting });
    return NextResponse.json({
      data: { conversation: toConversationView(conversation) },
      meta: { persistence: "database", module: "module.f_commerce", ...channelsMeta },
    });
  } catch {
    return dbNotReady();
  }
}

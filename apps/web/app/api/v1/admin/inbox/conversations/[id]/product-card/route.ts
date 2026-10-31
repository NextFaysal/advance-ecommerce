import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoInboxFlags, isInboxEnabled } from "@/inbox/flags";
import { getConversationDb, appendProductCardMessageDb } from "@/inbox/store";
import { sendStaffReply } from "@/inbox/send";

function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "F-commerce inbox is locked (module.f_commerce is OFF)." } },
    { status: 403 },
  );
}

function dbNotReady() {
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Inbox database is not available." } },
    { status: 503 },
  );
}

const cardSchema = z.object({
  variantId: z.string().min(1),
  productTitle: z.string().min(1),
  productUrl: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("customers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isInboxEnabled(demoInboxFlags)) return locked();

  const body = await req.json().catch(() => null);
  const parsed = cardSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "Variant ID and product title are required." } },
      { status: 400 },
    );
  }

  let conversation;
  try {
    const found = await getConversationDb(params.id);
    if (!found) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Conversation not found." } }, { status: 404 });
    }
    conversation = found.conversation;
  } catch {
    return dbNotReady();
  }

  try {
    // 1. Persist product card in local conversation thread
    const msg = await appendProductCardMessageDb(
      params.id,
      parsed.data.variantId,
      parsed.data.productTitle,
    );

    // 2. If channel is live, dispatch a text recommendation through Meta API
    const shareText = parsed.data.productUrl
      ? `🛍️ আমাদের সুপারিশকৃত পণ্য: ${parsed.data.productTitle}\nবিস্তারিত ও অর্ডার লিংক: ${parsed.data.productUrl}`
      : `🛍️ আমাদের সুপারিশকৃত পণ্য: ${parsed.data.productTitle}`;

    await sendStaffReply(conversation, shareText).catch(() => {});

    return NextResponse.json({
      success: true,
      data: { message: msg },
    });
  } catch (err) {
    return NextResponse.json(
      { error: { code: "SEND_FAILED", message: err instanceof Error ? err.message : "Failed to send product card." } },
      { status: 500 },
    );
  }
}

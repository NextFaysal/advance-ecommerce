import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoInboxFlags, isInboxEnabled } from "@/inbox/flags";
import { toConversationView } from "@/inbox/service";
import { updateConversationStatusDb } from "@/inbox/store";
import type { ConversationStatus } from "@/inbox/types";

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

const statusSchema = z.object({
  status: z.enum(["OPEN", "PENDING", "RESOLVED"]).optional(),
  assignedToId: z.string().nullable().optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("customers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isInboxEnabled(demoInboxFlags)) return locked();

  const body = await req.json().catch(() => null);
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "Invalid status or assignedToId payload." } },
      { status: 400 },
    );
  }

  try {
    const updated = await updateConversationStatusDb(params.id, {
      status: parsed.data.status as ConversationStatus | undefined,
      assignedToId: parsed.data.assignedToId,
    });

    if (!updated) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Conversation not found." } }, { status: 404 });
    }

    return NextResponse.json({
      data: { conversation: toConversationView(updated) },
      meta: { updated: true },
    });
  } catch {
    return dbNotReady();
  }
}

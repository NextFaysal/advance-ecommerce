import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { buildOrderDraft, extractPhoneFromMessages } from "@/inbox/conversion";
import { demoInboxFlags, isInboxEnabled } from "@/inbox/flags";
import { getConversationDb } from "@/inbox/store";

// Message -> order DRAFT — Agent 14. RBAC: orders.create.
// A draft is NOT an order. It pre-fills the manual-order form (Step 17); the
// actual order is created only by POST /api/v1/public/orders after staff
// confirmation, with a real idempotency key. If the phone was not given
// explicitly, it is resolved from the conversation (captured phone, else
// extracted from the thread's inbound messages — the DB store derives the
// captured phone from the stored message bodies) — and if no valid BD
// phone exists anywhere, the draft fails (phone-first rule).
// Persistence: conversations/messages come from the Prisma DB store
// (src/inbox/store.ts); the draft itself is pure logic, never persisted.
const draftSchema = z.object({
  conversationId: z.string().min(1),
  customerName: z.string().min(2),
  phone: z.string().min(11).max(15).optional(),
  addressText: z.string().min(5).max(1000),
  addressOverride: z
    .object({
      division: z.string().min(1).optional(),
      district: z.string().min(1).optional(),
      upazila: z.string().min(1).optional(),
      union: z.string().optional(),
      addressLine: z.string().min(5).optional(),
    })
    .optional(),
  items: z.array(z.object({ variantId: z.string().min(1), quantity: z.number().int().positive() })).min(1),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("orders.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isInboxEnabled(demoInboxFlags)) {
    return NextResponse.json(
      { error: { code: "FEATURE_LOCKED", message: "F-commerce inbox is locked for this install (module.f_commerce is OFF)." } },
      { status: 403 },
    );
  }
  const parsed = draftSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid draft input.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  let found: Awaited<ReturnType<typeof getConversationDb>>;
  try {
    found = await getConversationDb(parsed.data.conversationId);
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Inbox database is not available." } },
      { status: 503 },
    );
  }
  if (!found) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Conversation not found." } }, { status: 404 });
  }
  const { conversation: conv, messages } = found;
  const phoneRaw =
    parsed.data.phone ??
    conv.customerPhone ??
    extractPhoneFromMessages(messages) ??
    "";
  const result = buildOrderDraft({
    conversation: conv,
    customerName: parsed.data.customerName,
    phoneRaw,
    addressText: parsed.data.addressText,
    addressOverride: parsed.data.addressOverride,
    items: parsed.data.items,
    note: parsed.data.note,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: "DRAFT_INVALID", message: "Order draft could not be built.", details: result.errors } },
      { status: 422 },
    );
  }
  return NextResponse.json(
    { data: { draft: result.draft }, meta: { persistence: "none-pure-logic", isOrder: false } },
    { status: 201 },
  );
}

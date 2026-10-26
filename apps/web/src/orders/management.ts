/**
 * Order management fields (doc 17 batch O6) — the staff-facing
 * handling metadata on an order: assignee, priority, tags, an
 * operational HOLD, and internal notes. This is the WRITE PATH the
 * doc-17 audit found missing (the assignee column, the OrderTag and
 * OrderNote relations existed; nothing ever wrote them).
 *
 * HOLD SEMANTICS (deliberate): the hold is a UI-level signal only.
 * It is NOT consulted by applyOrderTransition — a held order can
 * still be confirmed/shipped by anyone who deliberately does so,
 * and the admin UI is responsible for surfacing the hold loudly
 * (the management panel does; funnel-level enforcement is a
 * deliberate non-goal of this batch, stated in the route header).
 * Setting a hold REQUIRES a reason; clearing a hold clears both
 * heldAt and heldReason. Hold set/clear also leaves an OrderNote so
 * the timeline explains itself.
 *
 * AUDIT: every management update writes one `orders.management`
 * audit row with full before/after JSON of the management view
 * (assignee/priority/tags/hold) — including note-only appends, so
 * "who touched this order's handling metadata" is answerable from
 * the audit log alone.
 *
 * COLUMN NAMES: the Order column is `assigneeId` (relation
 * "OrderAssignee"); the API/panel field is `assignedToId` per the
 * batch spec — the mapping lives only in this module.
 */
import { prisma } from "@advance-ecommerce/db";
import { writeAudit } from "../lib/audit";
import { STAGE_TAG_PREFIX } from "./stages";

export type OrderManagementErrorCode =
  | "ORDER_NOT_FOUND"
  | "INVALID_INPUT"
  | "ASSIGNEE_NOT_FOUND"
  | "REASON_REQUIRED";

export type OrderManagementResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: OrderManagementErrorCode; error: string };

const fail = (
  code: OrderManagementErrorCode,
  error: string,
): { ok: false; code: OrderManagementErrorCode; error: string } => ({ ok: false, code, error });

export const ORDER_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type OrderPriorityValue = (typeof ORDER_PRIORITIES)[number];

export interface OrderNoteView {
  id: string;
  text: string;
  authorName: string | null;
  createdAt: string;
}

export interface OrderManagementView {
  orderId: string;
  orderNo: string;
  status: string;
  /** API name for the Order.assigneeId column. */
  assignedToId: string | null;
  assigneeName: string | null;
  priority: OrderPriorityValue;
  tags: string[];
  held: boolean;
  heldAt: string | null;
  heldReason: string | null;
  notes: OrderNoteView[];
}

export interface OrderManagementActor {
  id: string;
  ip?: string;
  userAgent?: string;
}

export interface OrderManagementPatch {
  assignedToId?: string | null;
  priority?: string;
  tags?: string[];
  held?: boolean;
  heldReason?: string;
  note?: string;
}

const NOTE_VIEW_LIMIT = 20;

async function loadManagementView(orderId: string): Promise<OrderManagementView | null> {
  const row = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    include: {
      assignee: { select: { name: true } },
      tags: { orderBy: { tag: "asc" }, select: { tag: true } },
    },
  });
  if (!row) return null;
  const notes = await prisma.orderNote.findMany({
    where: { orderId: row.id },
    orderBy: { createdAt: "desc" },
    take: NOTE_VIEW_LIMIT,
    select: { id: true, text: true, authorId: true, createdAt: true },
  });
  const authorIds = [...new Set(notes.map((n) => n.authorId).filter((x): x is string => !!x))];
  const authors = authorIds.length
    ? await prisma.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } })
    : [];
  const authorName = new Map(authors.map((u) => [u.id, u.name]));
  return {
    orderId: row.id,
    orderNo: row.orderNo,
    status: row.status,
    assignedToId: row.assigneeId,
    assigneeName: row.assignee?.name ?? null,
    priority: row.priority,
    // ADV-26 (BUILD-LITE): `stage:` tags are system state owned by
    // src/orders/stages.ts (the order's workflow stage) — hidden from
    // the staff tag view here and preserved by the replace below, so
    // the tag editor can neither show nor clobber them.
    tags: row.tags.map((t) => t.tag).filter((tag) => !tag.startsWith(STAGE_TAG_PREFIX)),
    held: row.heldAt !== null,
    heldAt: row.heldAt ? row.heldAt.toISOString() : null,
    heldReason: row.heldReason,
    notes: notes.map((n) => ({
      id: n.id,
      text: n.text,
      authorName: n.authorId ? (authorName.get(n.authorId) ?? null) : null,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

export async function getOrderManagement(
  idOrNo: string,
): Promise<OrderManagementResult<OrderManagementView>> {
  const probe = await prisma.order.findFirst({
    where: { deletedAt: null, OR: [{ id: idOrNo }, { orderNo: idOrNo }] },
    select: { id: true },
  });
  if (!probe) return fail("ORDER_NOT_FOUND", "অর্ডার পাওয়া যায়নি / Order not found.");
  const view = await loadManagementView(probe.id);
  if (!view) return fail("ORDER_NOT_FOUND", "অর্ডার পাওয়া যায়নি / Order not found.");
  return { ok: true, value: view };
}

/** Trim, drop empties, dedupe (case-sensitive, staff-typed), cap.
 *  Tags in the reserved `stage:` namespace are dropped: workflow
 *  stage state may only be written through src/orders/stages.ts,
 *  never by typing a look-alike tag into this editor. */
function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim();
    if (!t || t.startsWith(STAGE_TAG_PREFIX) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 10) break;
  }
  return out;
}

export async function updateOrderManagement(
  orderId: string,
  patch: OrderManagementPatch,
  actor: OrderManagementActor,
): Promise<OrderManagementResult<OrderManagementView>> {
  const before = await loadManagementView(orderId);
  if (!before) return fail("ORDER_NOT_FOUND", "অর্ডার পাওয়া যায়নি / Order not found.");

  /* ---- validate everything BEFORE any write ---- */
  let priority: OrderPriorityValue | undefined;
  if (patch.priority !== undefined) {
    if (!(ORDER_PRIORITIES as readonly string[]).includes(patch.priority)) {
      return fail(
        "INVALID_INPUT",
        `অগ্রাধিকার হতে হবে: ${ORDER_PRIORITIES.join(", ")} / Priority must be one of: ${ORDER_PRIORITIES.join(", ")}.`,
      );
    }
    priority = patch.priority as OrderPriorityValue;
  }
  let tags: string[] | undefined;
  if (patch.tags !== undefined) {
    if (!Array.isArray(patch.tags) || patch.tags.some((t) => typeof t !== "string")) {
      return fail("INVALID_INPUT", "ট্যাগগুলো লেখা হতে হবে / Tags must be an array of strings.");
    }
    tags = normalizeTags(patch.tags);
  }
  if (patch.assignedToId !== undefined && patch.assignedToId !== null) {
    const user = await prisma.user.findFirst({
      where: { id: patch.assignedToId, deletedAt: null },
      select: { id: true },
    });
    if (!user) {
      return fail(
        "ASSIGNEE_NOT_FOUND",
        "দায়িত্বপ্রাপ্ত কর্মী পাওয়া যায়নি / The assignee is not a staff user.",
      );
    }
  }
  let holdChange: { heldAt: Date | null; heldReason: string | null } | undefined;
  if (patch.held !== undefined) {
    if (patch.held) {
      const reason = (patch.heldReason ?? "").trim();
      if (!reason) {
        return fail(
          "REASON_REQUIRED",
          "হোল্ড করতে হলে কারণ লিখতে হবে / A reason is required to hold an order.",
        );
      }
      holdChange = { heldAt: new Date(), heldReason: reason };
    } else {
      holdChange = { heldAt: null, heldReason: null };
    }
  }
  const noteText = patch.note !== undefined ? patch.note.trim() : undefined;
  if (noteText !== undefined && noteText.length === 0) {
    return fail("INVALID_INPUT", "নোট খালি হতে পারবে না / A note cannot be empty.");
  }

  /* ---- apply (one transaction: fields + tags + notes) ---- */
  await prisma.$transaction(async (tx) => {
    const data: {
      assigneeId?: string | null;
      priority?: OrderPriorityValue;
      heldAt?: Date | null;
      heldReason?: string | null;
    } = {};
    if (patch.assignedToId !== undefined) data.assigneeId = patch.assignedToId;
    if (priority !== undefined) data.priority = priority;
    if (holdChange) {
      data.heldAt = holdChange.heldAt;
      data.heldReason = holdChange.heldReason;
    }
    if (Object.keys(data).length > 0) {
      await tx.order.update({ where: { id: orderId }, data });
    }
    if (tags !== undefined) {
      // Replace STAFF tags only — the order's `stage:` tag (ADV-26
      // workflow stage, owned by src/orders/stages.ts) survives a
      // tag save untouched.
      await tx.orderTag.deleteMany({
        where: { orderId, NOT: { tag: { startsWith: STAGE_TAG_PREFIX } } },
      });
      if (tags.length > 0) {
        await tx.orderTag.createMany({ data: tags.map((tag) => ({ orderId, tag })) });
      }
    }
    const author = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true } });
    const authorId = author?.id ?? null;
    if (holdChange) {
      await tx.orderNote.create({
        data: {
          orderId,
          authorId,
          text: holdChange.heldAt
            ? `⏸ অর্ডার হোল্ড করা হয়েছে — কারণ: ${holdChange.heldReason} / Order placed on HOLD — reason: ${holdChange.heldReason}`
            : "▶ অর্ডারের হোল্ড তোলা হয়েছে / Order hold cleared.",
        },
      });
    }
    if (noteText !== undefined) {
      await tx.orderNote.create({ data: { orderId, authorId, text: noteText } });
    }
  });

  const after = await loadManagementView(orderId);
  if (!after) return fail("ORDER_NOT_FOUND", "অর্ডার পাওয়া যায়নি / Order not found.");
  await writeAudit({
    actorId: actor.id,
    action: "orders.management",
    entityType: "Order",
    entityId: orderId,
    beforeJson: {
      assignedToId: before.assignedToId,
      priority: before.priority,
      tags: before.tags,
      held: before.held,
      heldReason: before.heldReason,
    },
    afterJson: {
      assignedToId: after.assignedToId,
      priority: after.priority,
      tags: after.tags,
      held: after.held,
      heldReason: after.heldReason,
      noteAppended: noteText !== undefined,
    },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return { ok: true, value: after };
}

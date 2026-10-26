/**
 * Support ticket store — Prisma-backed (SupportTicket /
 * SupportTicketMessage, migration 20261026016000). Server-only.
 *
 * OWNERSHIP CONTRACT: every customer-facing read/write takes the
 * caller's customerId and filters on it in the SAME query — a ticket
 * that belongs to someone else is indistinguishable from a missing
 * one (null → the route answers 404; existence never leaks). The
 * optional order ref is likewise verified against the customer's own
 * orders at create time; a foreign order id is rejected outright.
 *
 * Tickets are deliberately separate from the contact inbox
 * (ContactMessage) and from src/inbox (Meta channels): a ticket is an
 * authenticated, threaded, per-customer conversation.
 *
 * STATUS FLOW: create → OPEN. Staff reply → PENDING. Customer reply →
 * OPEN (a reply to a CLOSED ticket reopens it). Staff may set any
 * status explicitly (close / reopen).
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "@/checkout/validation";
import type { CreateTicketInput, TicketStatus } from "./schema";
import { TICKET_STATUSES } from "./schema";
import { computeTicketSla, loadSlaConfig, type TicketSla } from "./sla";

/* ------------------------------ errors ------------------------------ */

/** The referenced order does not belong to the ticket's customer. */
export class TicketOrderNotOwnedError extends Error {
  readonly code = "ORDER_NOT_OWNED";
  constructor() {
    super("The referenced order does not belong to this customer.");
    this.name = "TicketOrderNotOwnedError";
  }
}

/* ------------------------------- views ------------------------------ */

export interface TicketMessageView {
  id: string;
  authorType: "CUSTOMER" | "STAFF";
  body: string;
  createdAt: string;
}

export interface CustomerTicketSummary {
  id: string;
  subject: string;
  status: TicketStatus;
  orderId: string | null;
  orderNo: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerTicketDetail extends CustomerTicketSummary {
  messages: TicketMessageView[];
}

export interface AdminTicketSummary extends CustomerTicketSummary {
  customerName: string;
  customerPhoneMasked: string;
  /** Read-time SLA state (src/support/sla.ts) — admin surfaces only. */
  sla: TicketSla;
}

export interface AdminTicketDetail extends AdminTicketSummary {
  messages: TicketMessageView[];
}

/* ---------------------------- internals ----------------------------- */

function asStatus(value: string): TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value)
    ? (value as TicketStatus)
    : "OPEN";
}

type TicketRow = Awaited<ReturnType<typeof prisma.supportTicket.findMany>>[number];
type TicketWithPreview = TicketRow & {
  order: { orderNo: string } | null;
  messages: Array<{ body: string }>;
  _count: { messages: number };
};

const previewInclude = {
  order: { select: { orderNo: true } },
  messages: { orderBy: { createdAt: "desc" as const }, take: 1, select: { body: true } },
  _count: { select: { messages: true } },
};

function toSummary(
  row: TicketRow & { order: { orderNo: string } | null; _count: { messages: number } },
  lastMessageBody: string | null,
): CustomerTicketSummary {
  return {
    id: row.id,
    subject: row.subject,
    status: asStatus(row.status),
    orderId: row.orderId,
    orderNo: row.order?.orderNo ?? null,
    messageCount: row._count.messages,
    lastMessagePreview: lastMessageBody,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function summaryFromPreview(row: TicketWithPreview): CustomerTicketSummary {
  return toSummary(row, row.messages[0]?.body ?? null);
}

function toMessages(
  rows: Array<{ id: string; authorType: string; body: string; createdAt: Date }>,
): TicketMessageView[] {
  return rows.map((m) => ({
    id: m.id,
    authorType: m.authorType === "STAFF" ? "STAFF" : "CUSTOMER",
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  }));
}

/* ------------------------- customer writes -------------------------- */

/**
 * Create a ticket with its first message. When `orderId` is given it
 * MUST belong to the customer — a foreign or missing order raises
 * TicketOrderNotOwnedError and nothing is stored.
 */
export async function createTicket(
  customerId: string,
  input: CreateTicketInput,
): Promise<CustomerTicketDetail> {
  if (input.orderId) {
    const order = await prisma.order.findFirst({
      where: { id: input.orderId, customerId, deletedAt: null },
      select: { id: true },
    });
    if (!order) throw new TicketOrderNotOwnedError();
  }

  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.supportTicket.create({
      data: {
        customerId,
        orderId: input.orderId ?? null,
        subject: input.subject,
        status: "OPEN",
      },
    });
    await tx.supportTicketMessage.create({
      data: {
        ticketId: created.id,
        authorType: "CUSTOMER",
        authorId: customerId,
        body: input.body,
      },
    });
    return created;
  });

  const detail = await getTicketForCustomer(customerId, ticket.id);
  // The row was just created by this customer — detail cannot be null.
  return detail as CustomerTicketDetail;
}

/**
 * Customer reply. Appends the message and moves the ticket to OPEN —
 * including reopening a CLOSED ticket. Returns null when the ticket
 * is not the customer's (or does not exist): the two cases are
 * deliberately indistinguishable.
 */
export async function replyToTicketAsCustomer(
  customerId: string,
  ticketId: string,
  body: string,
): Promise<CustomerTicketDetail | null> {
  const owned = await prisma.supportTicket.findFirst({
    where: { id: ticketId, customerId },
    select: { id: true },
  });
  if (!owned) return null;

  await prisma.$transaction(async (tx) => {
    await tx.supportTicketMessage.create({
      data: { ticketId, authorType: "CUSTOMER", authorId: customerId, body },
    });
    await tx.supportTicket.update({ where: { id: ticketId }, data: { status: "OPEN" } });
  });
  return getTicketForCustomer(customerId, ticketId);
}

/* -------------------------- customer reads -------------------------- */

/** The customer's own tickets, most recently updated first. */
export async function listTicketsForCustomer(customerId: string): Promise<CustomerTicketSummary[]> {
  const rows = await prisma.supportTicket.findMany({
    where: { customerId },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: previewInclude,
  });
  return rows.map(summaryFromPreview);
}

/** One of the customer's own tickets with its full thread, or null. */
export async function getTicketForCustomer(
  customerId: string,
  ticketId: string,
): Promise<CustomerTicketDetail | null> {
  const row = await prisma.supportTicket.findFirst({
    where: { id: ticketId, customerId },
    include: {
      order: { select: { orderNo: true } },
      messages: { orderBy: { createdAt: "asc" } },
      _count: { select: { messages: true } },
    },
  });
  if (!row) return null;
  const messages = toMessages(row.messages);
  return {
    ...toSummary(row, messages[messages.length - 1]?.body ?? null),
    messages,
  };
}

/* ---------------------------- admin side ---------------------------- */

/**
 * Queue for staff. Optional status filter; newest activity first.
 * Each row carries its read-time SLA state: the first staff reply is
 * the earliest STAFF message per ticket (one groupBy over the page's
 * ids), and `breachedOnly` filters on the computed state — note it
 * filters within the newest-100 window this queue already loads, the
 * same window the status tabs show.
 */
export async function listTicketsForAdmin(
  status?: TicketStatus,
  opts?: { breachedOnly?: boolean },
): Promise<AdminTicketSummary[]> {
  const rows = await prisma.supportTicket.findMany({
    where: status ? { status } : {},
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { ...previewInclude, customer: { select: { name: true, phone: true } } },
  });
  if (rows.length === 0) return [];

  const [config, firstReplies] = await Promise.all([
    loadSlaConfig(),
    prisma.supportTicketMessage.groupBy({
      by: ["ticketId"],
      where: { ticketId: { in: rows.map((r) => r.id) }, authorType: "STAFF" },
      _min: { createdAt: true },
    }),
  ]);
  const firstReplyByTicket = new Map(
    firstReplies.map((g) => [g.ticketId, g._min.createdAt ?? null]),
  );
  const now = new Date();

  const summaries = rows.map((row) => ({
    ...summaryFromPreview(row),
    customerName: row.customer.name,
    customerPhoneMasked: maskPhone(row.customer.phone),
    sla: computeTicketSla({
      createdAt: row.createdAt,
      status: asStatus(row.status),
      firstStaffReplyAt: firstReplyByTicket.get(row.id) ?? null,
      updatedAt: row.updatedAt,
      config,
      now,
    }),
  }));
  return opts?.breachedOnly
    ? summaries.filter((s) => s.sla.state === "BREACHED")
    : summaries;
}

/** Full thread for staff, or null when the ticket does not exist. */
export async function getTicketForAdmin(ticketId: string): Promise<AdminTicketDetail | null> {
  const row = await prisma.supportTicket.findFirst({
    where: { id: ticketId },
    include: {
      order: { select: { orderNo: true } },
      messages: { orderBy: { createdAt: "asc" } },
      _count: { select: { messages: true } },
      customer: { select: { name: true, phone: true } },
    },
  });
  if (!row) return null;
  const messages = toMessages(row.messages);
  // The thread is loaded in full here, so the first staff reply is
  // read straight from it (messages are createdAt-ascending).
  const config = await loadSlaConfig();
  return {
    ...toSummary(row, messages[messages.length - 1]?.body ?? null),
    customerName: row.customer.name,
    customerPhoneMasked: maskPhone(row.customer.phone),
    sla: computeTicketSla({
      createdAt: row.createdAt,
      status: asStatus(row.status),
      firstStaffReplyAt: row.messages.find((m) => m.authorType === "STAFF")?.createdAt ?? null,
      updatedAt: row.updatedAt,
      config,
    }),
    messages,
  };
}

/** Per-status counts for the queue tabs. */
export async function countTicketsByStatus(): Promise<Record<TicketStatus, number>> {
  const grouped = await prisma.supportTicket.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const counts: Record<TicketStatus, number> = { OPEN: 0, PENDING: 0, CLOSED: 0 };
  for (const g of grouped) {
    if ((TICKET_STATUSES as readonly string[]).includes(g.status)) {
      counts[g.status as TicketStatus] = g._count._all;
    }
  }
  return counts;
}

/**
 * Staff reply. Appends the message (authorId = the staff user's id)
 * and moves the ticket to PENDING — staff answered, ball is with the
 * customer. Replying to a CLOSED ticket reopens it as PENDING.
 * Returns null when the ticket does not exist.
 */
export async function replyToTicketAsStaff(
  staffUserId: string,
  ticketId: string,
  body: string,
): Promise<AdminTicketDetail | null> {
  const existing = await prisma.supportTicket.findFirst({
    where: { id: ticketId },
    select: { id: true },
  });
  if (!existing) return null;

  await prisma.$transaction(async (tx) => {
    await tx.supportTicketMessage.create({
      data: { ticketId, authorType: "STAFF", authorId: staffUserId, body },
    });
    await tx.supportTicket.update({ where: { id: ticketId }, data: { status: "PENDING" } });
  });
  return getTicketForAdmin(ticketId);
}

/** Staff status change (close / reopen). Null when not found. */
export async function setTicketStatus(
  ticketId: string,
  status: TicketStatus,
): Promise<AdminTicketDetail | null> {
  const existing = await prisma.supportTicket.findFirst({
    where: { id: ticketId },
    select: { id: true },
  });
  if (!existing) return null;
  await prisma.supportTicket.update({ where: { id: ticketId }, data: { status } });
  return getTicketForAdmin(ticketId);
}

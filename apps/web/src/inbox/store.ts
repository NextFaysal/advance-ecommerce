/**
 * Inbox DB store — Prisma-backed persistence (Agent-14 module swap).
 *
 * Replaces the in-memory demo store in service.ts for the inbox routes
 * and the admin page. Persistence is the DB, with webhook-style dedupe
 * on (channel, externalMessageId).
 *
 * Channels went RECEIVE-LIVE in ADV-6 part 1 (src/inbox/meta-channels.ts
 * + app/api/v1/public/meta/webhook): real Messenger / Instagram /
 * WhatsApp webhook events land here through ingestInboundMessage() —
 * but ONLY for channels fully configured in Settings (meta.*);
 * unconfigured channels cannot post (the webhook answers 404) and
 * `channelsLive` in the inbox API meta is computed from that config,
 * not hardcoded. The SEND side (Graph API replies) is still not built:
 * outbound messages created here are local records, not deliveries.
 *
 * Deliberate TS <-> schema mappings (drift, see final report):
 * - Schema `customerName` <-> TS `customerDisplayName`; `body` <-> `text`.
 * - The schema stores ONLY `customerPhoneMasked`. The full phone on the
 *   TS Conversation is re-derived at read time by the existing
 *   extractPhoneFromMessages() over the stored message bodies — the
 *   customer's own chat text, exactly as in the demo store — and every
 *   outward shape still masks it (toConversationView). Nothing new is
 *   exposed.
 * - Conversation has no customerId column: customerId is undefined;
 *   lastMessageAt is derived from the newest message (fallback:
 *   conversation createdAt); unreadCount is derived as the count of
 *   INBOUND messages created after the conversation's `lastReadAt`
 *   read marker (ALL inbound messages while the marker is null — see
 *   markConversationReadDb). PRODUCT_CARD / ORDER_CARD refs persist in
 *   `InboxMessage.refId` (migration 20261026013000_inbox_message_ref_id,
 *   ADV-6); Conversation.productRefId derives from the first
 *   PRODUCT_CARD message's refId.
 * - Schema externalMessageId is REQUIRED: locally created messages
 *   without a platform id get a generated `local-<uuid>` id, which also
 *   keeps the dedupe unique constraint meaningful for them.
 */
import { randomUUID } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "../checkout/validation";
import { extractPhoneFromMessages } from "./conversion";
import type {
  Conversation,
  ConversationStatus,
  InboxChannel,
  InboxMessage,
  InboundMessageInput,
  MessageDirection,
  MessageKind,
} from "./types";

type ConversationRow = NonNullable<Awaited<ReturnType<typeof prisma.inboxConversation.findUnique>>>;
type MessageRow = NonNullable<Awaited<ReturnType<typeof prisma.inboxMessage.findUnique>>>;

function rowToMessage(row: MessageRow): InboxMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    direction: row.direction as MessageDirection,
    kind: row.kind as MessageKind,
    text: row.body ?? undefined,
    refId: row.refId ?? undefined,
    externalMessageId: row.externalMessageId,
    sentAt: row.createdAt.toISOString(),
  };
}

function rowToConversation(row: ConversationRow, messages: InboxMessage[]): Conversation {
  const detectedPhone = extractPhoneFromMessages(messages);
  const lastMessageAt =
    messages.length > 0
      ? messages[messages.length - 1]!.sentAt
      : row.createdAt.toISOString();
  // Read model: unread = INBOUND messages that arrived after the last
  // time staff opened the conversation. A null marker (never opened)
  // means every inbound message is unread.
  const lastReadMs = row.lastReadAt ? row.lastReadAt.getTime() : null;
  // The conversation "started from" the product on its first
  // PRODUCT_CARD message, when that card carried a ref (ADV-6).
  const productCard = messages.find((m) => m.kind === "PRODUCT_CARD" && m.refId);
  return {
    id: row.id,
    channel: row.channel as InboxChannel,
    externalThreadId: row.externalThreadId,
    customerDisplayName: row.customerName ?? "",
    customerPhone: detectedPhone,
    status: row.status as ConversationStatus,
    assignedAgentId: row.assignedToId,
    productRefId: productCard?.refId,
    unreadCount: messages.filter(
      (m) =>
        m.direction === "INBOUND" &&
        (lastReadMs === null || Date.parse(m.sentAt) > lastReadMs),
    ).length,
    lastReadAt: row.lastReadAt ? row.lastReadAt.toISOString() : null,
    lastMessageAt,
    createdAt: row.createdAt.toISOString(),
  };
}

async function messagesForConversationDb(conversationId: string): Promise<InboxMessage[]> {
  const rows = await prisma.inboxMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(rowToMessage);
}

/** All conversations with their messages (page + list route). */
export async function loadInbox(): Promise<{
  conversations: Conversation[];
  messagesByConversation: Map<string, InboxMessage[]>;
}> {
  const rows = await prisma.inboxConversation.findMany({ orderBy: { createdAt: "asc" } });
  const conversations: Conversation[] = [];
  const messagesByConversation = new Map<string, InboxMessage[]>();
  for (const row of rows) {
    const messages = await messagesForConversationDb(row.id);
    messagesByConversation.set(row.id, messages);
    conversations.push(rowToConversation(row, messages));
  }
  return { conversations, messagesByConversation };
}

export async function getConversationDb(
  conversationId: string,
): Promise<{ conversation: Conversation; messages: InboxMessage[] } | null> {
  const row = await prisma.inboxConversation.findUnique({ where: { id: conversationId } });
  if (!row) return null;
  const messages = await messagesForConversationDb(row.id);
  return { conversation: rowToConversation(row, messages), messages };
}

/**
 * Mark a conversation read: stamps `lastReadAt = now`, so the read
 * model (rowToConversation) reports unreadCount 0 until a NEW inbound
 * message arrives after the stamp. Returns the re-read conversation
 * (its unreadCount is computed from the persisted marker, so a caller
 * — or a page reload — always agrees), or null when the conversation
 * does not exist.
 */
export async function markConversationReadDb(
  conversationId: string,
): Promise<Conversation | null> {
  const existing = await prisma.inboxConversation.findUnique({
    where: { id: conversationId },
    select: { id: true },
  });
  if (!existing) return null;
  const row = await prisma.inboxConversation.update({
    where: { id: conversationId },
    data: { lastReadAt: new Date() },
  });
  const messages = await messagesForConversationDb(row.id);
  return rowToConversation(row, messages);
}

export interface IngestResult {
  conversation: Conversation;
  message: InboxMessage;
  /** True when (channel, externalMessageId) already existed — a no-op replay. */
  duplicate: boolean;
}

/**
 * Ingest one inbound message (the ChannelAdapter seam): upserts the
 * conversation by (channel, externalThreadId), inserts the message
 * unless (channel, externalMessageId) already exists — a webhook retry
 * is a no-op, never a second row. When the thread's text yields a valid
 * BD phone, the conversation's stored masked phone is refreshed (the
 * full number itself is never written to the conversation row).
 */
export async function ingestInboundMessage(
  input: InboundMessageInput & { direction?: MessageDirection; sentAtIso?: string },
): Promise<IngestResult> {
  const externalMessageId = input.externalMessageId ?? `local-${randomUUID()}`;
  const existingMessage = await prisma.inboxMessage.findUnique({
    where: {
      channel_externalMessageId: { channel: input.channel, externalMessageId },
    },
  });

  let conversationRow = await prisma.inboxConversation.upsert({
    where: {
      channel_externalThreadId: {
        channel: input.channel,
        externalThreadId: input.externalThreadId,
      },
    },
    create: {
      channel: input.channel,
      externalThreadId: input.externalThreadId,
      customerName: input.customerDisplayName,
      status: "OPEN",
    },
    update: {},
  });

  if (existingMessage) {
    const messages = await messagesForConversationDb(conversationRow.id);
    return {
      conversation: rowToConversation(conversationRow, messages),
      message: rowToMessage(existingMessage),
      duplicate: true,
    };
  }

  // Platform send time when the caller carries one (Meta webhooks):
  // the row's createdAt doubles as the message sentAt in the read
  // model, so a backfilled/replayed event keeps its true position in
  // the thread. Invalid/absent values fall back to DB now.
  const platformSentAt = input.sentAtIso ? new Date(input.sentAtIso) : null;
  const created = await prisma.inboxMessage.create({
    data: {
      conversationId: conversationRow.id,
      channel: input.channel,
      externalMessageId,
      direction: input.direction ?? "INBOUND",
      kind: input.kind,
      body: input.text ?? null,
      refId: input.refId ?? null,
      ...(platformSentAt && !Number.isNaN(platformSentAt.getTime())
        ? { createdAt: platformSentAt }
        : {}),
    },
  });

  const messages = await messagesForConversationDb(conversationRow.id);
  const detected = extractPhoneFromMessages(messages);
  if (detected) {
    const masked = maskPhone(detected);
    if (conversationRow.customerPhoneMasked !== masked) {
      conversationRow = await prisma.inboxConversation.update({
        where: { id: conversationRow.id },
        data: { customerPhoneMasked: masked },
      });
    }
  }

  return {
    conversation: rowToConversation(conversationRow, messages),
    message: rowToMessage(created),
    duplicate: false,
  };
}

/**
 * Persist a staff reply AFTER the channel provider accepted it (ADV-6
 * send path, src/inbox/send.ts). The row carries the PLATFORM message
 * id as externalMessageId — never a local placeholder — so a persisted
 * OUTBOUND row is proof of delivery acceptance, and the (channel,
 * externalMessageId) unique constraint dedupes a retried write.
 * Callers must invoke this ONLY on provider success: a failed send
 * persists nothing, so the thread never shows a fake "sent" bubble.
 * Throws when the conversation does not exist.
 */
export async function appendOutboundMessageDb(
  conversationId: string,
  input: { text: string; externalMessageId: string },
): Promise<InboxMessage> {
  const conversationRow = await prisma.inboxConversation.findUnique({
    where: { id: conversationId },
    select: { channel: true },
  });
  if (!conversationRow) throw new Error(`Inbox conversation not found: ${conversationId}`);
  const created = await prisma.inboxMessage.create({
    data: {
      conversationId,
      channel: conversationRow.channel,
      externalMessageId: input.externalMessageId,
      direction: "OUTBOUND",
      kind: "TEXT",
      body: input.text,
    },
  });
  return rowToMessage(created);
}

/**
 * Update conversation status (OPEN, PENDING, RESOLVED) or assigned agent.
 */
export async function updateConversationStatusDb(
  conversationId: string,
  patch: { status?: ConversationStatus; assignedToId?: string | null },
): Promise<Conversation | null> {
  const existing = await prisma.inboxConversation.findUnique({
    where: { id: conversationId },
    select: { id: true },
  });
  if (!existing) return null;
  const data: { status?: string; assignedToId?: string | null } = {};
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.assignedToId !== undefined) data.assignedToId = patch.assignedToId;

  const row = await prisma.inboxConversation.update({
    where: { id: conversationId },
    data,
  });
  const messages = await messagesForConversationDb(row.id);
  return rowToConversation(row, messages);
}

/**
 * Persist an outbound product recommendation card into the conversation.
 */
export async function appendProductCardMessageDb(
  conversationId: string,
  variantId: string,
  productTitle: string,
): Promise<InboxMessage> {
  const conversationRow = await prisma.inboxConversation.findUnique({
    where: { id: conversationId },
    select: { channel: true },
  });
  if (!conversationRow) throw new Error(`Inbox conversation not found: ${conversationId}`);
  const created = await prisma.inboxMessage.create({
    data: {
      conversationId,
      channel: conversationRow.channel,
      externalMessageId: `prod-card-${randomUUID()}`,
      direction: "OUTBOUND",
      kind: "PRODUCT_CARD",
      body: `🛍️ পণ্যের সুপারিশ: ${productTitle}`,
      refId: variantId,
    },
  });
  return rowToMessage(created);
}

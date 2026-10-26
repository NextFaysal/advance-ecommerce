/**
 * Inbox DB store — Prisma-backed persistence (Agent-14 module swap).
 *
 * Replaces the in-memory demo store in service.ts for the inbox routes
 * and the admin page. Channels are STILL types only — no Messenger /
 * Instagram / WhatsApp API is called and no channel token exists here;
 * `channelsLive` stays false. What changed is only where conversations
 * and messages live: the DB, with webhook-style dedupe on
 * (channel, externalMessageId).
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
 *   markConversationReadDb). PRODUCT_CARD / ORDER_CARD refs are still
 *   not persisted (InboxMessage has no refId column).
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
  return {
    id: row.id,
    channel: row.channel as InboxChannel,
    externalThreadId: row.externalThreadId,
    customerDisplayName: row.customerName ?? "",
    customerPhone: detectedPhone,
    status: row.status as ConversationStatus,
    assignedAgentId: row.assignedToId,
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
  input: InboundMessageInput & { direction?: MessageDirection },
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

  const created = await prisma.inboxMessage.create({
    data: {
      conversationId: conversationRow.id,
      channel: input.channel,
      externalMessageId,
      direction: input.direction ?? "INBOUND",
      kind: input.kind,
      body: input.text ?? null,
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

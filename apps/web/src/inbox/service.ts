/**
 * Inbox demo store + views — TEMPORARY in-memory, lost on restart. Agent 14.
 * No channel API is called; demo conversations stand in for webhook-ingested
 * threads until a ChannelAdapter + DB tables (inbox_conversations,
 * inbox_messages) land in the follow-up slice.
 */
import { maskPhone } from "../checkout/validation";
import type { Conversation, ConversationView, InboxMessage } from "./types";

export const DEMO_CONVERSATIONS: Conversation[] = [
  {
    id: "conv-1",
    channel: "MESSENGER",
    externalThreadId: "demo-thread-messenger-1",
    customerDisplayName: "Nusrat Jahan",
    customerPhone: "+8801912345678",
    status: "OPEN",
    assignedAgentId: null,
    productRefId: "var-jamdani-red",
    unreadCount: 2,
    lastMessageAt: "2026-10-24T07:10:00.000Z",
    createdAt: "2026-10-24T07:02:00.000Z",
  },
  {
    id: "conv-2",
    channel: "WHATSAPP",
    externalThreadId: "demo-thread-whatsapp-1",
    customerDisplayName: "Tanvir Ahmed",
    customerPhone: null,
    status: "OPEN",
    assignedAgentId: null,
    unreadCount: 1,
    lastMessageAt: "2026-10-24T07:12:00.000Z",
    createdAt: "2026-10-24T07:11:00.000Z",
  },
];

export const DEMO_MESSAGES: InboxMessage[] = [
  {
    id: "msg-1",
    conversationId: "conv-1",
    direction: "INBOUND",
    kind: "PRODUCT_CARD",
    text: "Eta nite chai",
    refId: "var-jamdani-red",
    sentAt: "2026-10-24T07:02:00.000Z",
  },
  {
    id: "msg-2",
    conversationId: "conv-1",
    direction: "INBOUND",
    kind: "TEXT",
    text: "Nusrat Jahan, 01912345678, House 12 Road 5 Dhanmondi Dhaka",
    sentAt: "2026-10-24T07:10:00.000Z",
  },
];

export const demoConversations: Conversation[] = [...DEMO_CONVERSATIONS];
export const demoMessages: InboxMessage[] = [...DEMO_MESSAGES];

export function toConversationView(c: Conversation): ConversationView {
  return {
    id: c.id,
    channel: c.channel,
    customerDisplayName: c.customerDisplayName,
    phoneMasked: c.customerPhone ? maskPhone(c.customerPhone) : null,
    status: c.status,
    assignedAgentId: c.assignedAgentId,
    productRefId: c.productRefId,
    unreadCount: c.unreadCount,
    lastMessageAt: c.lastMessageAt,
  };
}

export function messagesForConversation(
  messages: readonly InboxMessage[],
  conversationId: string,
): InboxMessage[] {
  return messages
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

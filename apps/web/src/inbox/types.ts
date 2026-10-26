/**
 * F-commerce unified inbox types — Agent 14 (Step 46, A6 / Part G).
 *
 * CHANNELS ARE TYPES ONLY in this slice. There is NO Messenger / Instagram /
 * WhatsApp API call anywhere in this module, and NO channel access token is
 * read, stored, or logged. A real channel integration (Step 46 follow-up)
 * implements a ChannelAdapter that maps each platform's webhook payload into
 * InboxMessage below — credentials for that live ONLY in Admin Settings
 * (encrypted), never in code.
 *
 * Identity rule: a conversation is keyed by (channel, externalThreadId). The
 * customer is linked to a store Customer only after a phone number is
 * captured in chat (phone-first, same as checkout) — never by scraping a
 * social profile.
 */
import { z } from "zod";

export type InboxChannel = "MESSENGER" | "INSTAGRAM" | "WHATSAPP";

export const INBOX_CHANNELS: readonly InboxChannel[] = ["MESSENGER", "INSTAGRAM", "WHATSAPP"];

export type MessageDirection = "INBOUND" | "OUTBOUND";

export type MessageKind = "TEXT" | "IMAGE" | "PRODUCT_CARD" | "ORDER_CARD" | "SYSTEM";

export interface InboxMessage {
  id: string;
  conversationId: string;
  direction: MessageDirection;
  kind: MessageKind;
  /** Text body for TEXT; caption / alt text for media kinds. Product/order cards carry a ref, not a payload copy. */
  text?: string;
  /** For PRODUCT_CARD / ORDER_CARD: the variant/order id the card refers to. */
  refId?: string;
  /** Platform message id, for dedupe on webhook retry. Unique per (channel, externalMessageId). */
  externalMessageId?: string;
  sentAt: string;
}

export type ConversationStatus = "OPEN" | "PENDING" | "RESOLVED";

export interface Conversation {
  id: string;
  channel: InboxChannel;
  /** Platform thread id. Opaque string — never parsed, never logged with PII. */
  externalThreadId: string;
  /** Display name from the platform profile. Shown to staff, never used as identity. */
  customerDisplayName: string;
  /** Set once a phone is captured + normalized in chat; null until then. */
  customerPhone: string | null;
  /** Linked store customer, once phone matching succeeds. */
  customerId?: string;
  status: ConversationStatus;
  assignedAgentId: string | null;
  /** Product variant the conversation started from (post/product card click), if any. */
  productRefId?: string;
  unreadCount: number;
  /** When staff last opened (marked read) this conversation; null = never. unreadCount counts INBOUND messages newer than this. */
  lastReadAt?: string | null;
  lastMessageAt: string;
  createdAt: string;
}

/** Outward conversation shape: phone masked (null stays null). */
export interface ConversationView {
  id: string;
  channel: InboxChannel;
  customerDisplayName: string;
  phoneMasked: string | null;
  status: ConversationStatus;
  assignedAgentId: string | null;
  productRefId?: string;
  unreadCount: number;
  lastMessageAt: string;
}

export const inboundMessageSchema = z.object({
  channel: z.enum(["MESSENGER", "INSTAGRAM", "WHATSAPP"]),
  externalThreadId: z.string().min(1),
  externalMessageId: z.string().min(1).optional(),
  customerDisplayName: z.string().min(1).max(120),
  kind: z.enum(["TEXT", "IMAGE", "PRODUCT_CARD", "ORDER_CARD", "SYSTEM"]).default("TEXT"),
  text: z.string().max(4000).optional(),
  refId: z.string().optional(),
});

export type InboundMessageInput = z.infer<typeof inboundMessageSchema>;

/**
 * Message -> order draft conversion — Agent 14 (Step 46, A6).
 *
 * Order-from-chat flow (outline implemented as pure steps):
 *  1. Customer chats on Messenger/Instagram/WhatsApp and picks a product
 *     (PRODUCT_CARD) or the agent attaches one.
 *  2. Agent (or the extraction below) collects name + phone + address text
 *     from the conversation. Phone is REQUIRED and normalized, exactly like
 *     checkout — no phone, no draft order.
 *  3. buildOrderDraft() validates with the SAME Zod pieces checkout uses
 *     (bdAddressSchema / checkoutItemSchema from src/checkout/validation),
 *     after running the Bangla address parser (src/bd) over the free text.
 *     A draft is NOT an order: it carries `needsConfirmation` flags for
 *     everything the parser was unsure about (confidence < 0.8) and for any
 *     address the parser could not complete (staff must confirm in the
 *     manual-order form — the draft pre-fills it, Step 17).
 *  4. Confirming the draft is the ORDERS module's job (POST /api/v1/public/
 *     orders with a real idempotency key). This module never creates orders.
 */
import { parseAddress } from "../bd/address-parser";
import {
  bdAddressSchema,
  checkoutItemSchema,
  normalizeBdPhone,
  type BdAddress,
} from "../checkout/validation";
import type { Conversation, InboxMessage } from "./types";

export interface ChatOrderLineInput {
  variantId: string;
  quantity: number;
}

export interface OrderDraft {
  source: "INBOX";
  channel: Conversation["channel"];
  conversationId: string;
  customerName: string;
  /** Normalized +8801XXXXXXXXX. */
  phone: string;
  address: BdAddress;
  items: { variantId: string; quantity: number }[];
  note?: string;
  /** True when staff must confirm parsed address fields before ordering. */
  needsStaffConfirmation: boolean;
  /** Parser confidence 0–1 for the address text, surfaced — never hidden. */
  addressConfidence: number;
}

export type DraftResult =
  | { ok: true; draft: OrderDraft }
  | { ok: false; errors: string[] };

/** BD phone anywhere in free chat text (loose scan, then strict normalize). */
const PHONE_IN_TEXT = /(?:\+?88)?01[3-9]\d{8}/;

/** Best-effort phone extraction from a conversation's messages. Null if none validates. */
export function extractPhoneFromMessages(messages: readonly InboxMessage[]): string | null {
  for (const m of messages) {
    if (m.direction !== "INBOUND" || !m.text) continue;
    const hit = m.text.replace(/[\s-]/g, "").match(PHONE_IN_TEXT);
    if (hit) {
      const normalized = normalizeBdPhone(hit[0]);
      if (normalized) return normalized;
    }
  }
  return null;
}

/**
 * Build an order draft from captured chat fields. `addressText` is the raw
 * free text from chat; it goes through parseAddress() first, and any field
 * the parser misses can be supplied explicitly via `addressOverride`
 * (staff-typed in the inbox panel).
 */
export function buildOrderDraft(input: {
  conversation: Conversation;
  customerName: string;
  phoneRaw: string;
  addressText: string;
  addressOverride?: Partial<BdAddress>;
  items: ChatOrderLineInput[];
  note?: string;
}): DraftResult {
  const errors: string[] = [];
  const phone = normalizeBdPhone(input.phoneRaw);
  if (!phone) errors.push("phone: Sothik Bangladesh mobile number lagbe (01XXXXXXXXX).");
  if (input.customerName.trim().length < 2) errors.push("customerName: Nam dite hobe.");

  const itemsParsed = checkoutItemSchema.array().min(1).safeParse(input.items);
  if (!itemsParsed.success) {
    errors.push(...itemsParsed.error.issues.map((i) => `items: ${i.message}`));
  }

  const parsed = parseAddress(input.addressText);
  const candidate: Partial<BdAddress> = {
    division: input.addressOverride?.division ?? parsed.division ?? undefined,
    district: input.addressOverride?.district ?? parsed.district ?? undefined,
    upazila: input.addressOverride?.upazila ?? parsed.upazila ?? parsed.area ?? undefined,
    union: input.addressOverride?.union,
    addressLine: input.addressOverride?.addressLine ?? parsed.addressLine,
  };
  const addressParsed = bdAddressSchema.safeParse(candidate);
  if (!addressParsed.success) {
    errors.push(...addressParsed.error.issues.map((i) => `address.${i.path.join(".")}: ${i.message}`));
  }
  if (errors.length > 0 || !phone || !itemsParsed.success || !addressParsed.success) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    draft: {
      source: "INBOX",
      channel: input.conversation.channel,
      conversationId: input.conversation.id,
      customerName: input.customerName.trim(),
      phone,
      address: addressParsed.data,
      items: itemsParsed.data,
      note: input.note,
      needsStaffConfirmation: parsed.confidence < 0.8 || input.addressOverride !== undefined,
      addressConfidence: parsed.confidence,
    },
  };
}

/** Count unread inbound messages in a thread (for the inbox badge). Pure helper. */
export function unreadInbound(messages: readonly InboxMessage[], readThroughId: string | null): number {
  if (readThroughId === null) return messages.filter((m) => m.direction === "INBOUND").length;
  const idx = messages.findIndex((m) => m.id === readThroughId);
  const after = idx === -1 ? messages : messages.slice(idx + 1);
  return after.filter((m) => m.direction === "INBOUND").length;
}

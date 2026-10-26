/**
 * Team chat (ADV-27 remainder, doc 23 wave 53-3) — ONE general room
 * for signed-in staff. Deliberately v1-small: no channels, no DMs,
 * no edit/delete, no websockets (none exist in this codebase — the
 * panel polls, and says so).
 *
 * PERSISTENCE — one Setting doc per month (house pattern, see
 * docs.ts): `team.chat.<yyyy-mm>` = { version: 1, messages: [...] },
 * month = the Asia/Dhaka calendar month of the message.
 *
 * CAP: a month doc keeps at most MAX_MESSAGES_PER_MONTH messages.
 * Beyond the cap the OLDEST messages are dropped on write — chat is
 * an operational scratchpad, not an archive; anything that must be
 * kept belongs in an order note / ticket, not here.
 *
 * READ-MODIFY-WRITE caveat inherited from docs.ts: two staff sending
 * in the same instant can race (last write wins for the whole doc).
 * Acceptable for a single-store team at v1.
 */
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { todayDhakaYmd } from "@/lib/dhaka-date";
import { TeamError, readDoc, writeDoc } from "./docs";

export const MAX_MESSAGES_PER_MONTH = 1000;
export const CHAT_BODY_MAX = 1000;

export const chatMessageSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  userName: z.string().max(120),
  body: z.string().min(1).max(CHAT_BODY_MAX),
  /** ISO instant the server recorded the message. */
  sentAt: z.string().min(1),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

const chatDocSchema = z.object({
  version: z.literal(1),
  messages: z.array(chatMessageSchema),
});

type ChatDoc = z.infer<typeof chatDocSchema>;

const EMPTY_DOC: ChatDoc = { version: 1, messages: [] };

export function chatKey(month: string): string {
  return `team.chat.${month}`;
}

async function readMonthDoc(month: string): Promise<ChatDoc> {
  return readDoc(chatKey(month), chatDocSchema, EMPTY_DOC);
}

/** Previous yyyy-mm (Dhaka months are plain calendar months). */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y as number, (m as number) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function currentChatMonth(now: Date = new Date()): string {
  return todayDhakaYmd(now).slice(0, 7);
}

/**
 * The latest `limit` messages, oldest-first. Reads this month's doc
 * and — when it holds fewer than `limit` — the previous month's too,
 * so the room does not look empty on the 1st of a month.
 */
export async function listLatestMessages(
  limit = 100,
  now: Date = new Date(),
): Promise<ChatMessage[]> {
  const month = currentChatMonth(now);
  const doc = await readMonthDoc(month);
  let messages = doc.messages;
  if (messages.length < limit) {
    const prev = await readMonthDoc(previousMonth(month));
    messages = [...prev.messages, ...messages];
  }
  return messages.slice(-limit);
}

/** Append a message for `author` (identity comes from the session,
 *  never the request payload — the route passes the session user). */
export async function postChatMessage(
  author: { id: string; name: string },
  rawBody: string,
  now: Date = new Date(),
): Promise<ChatMessage> {
  const body = rawBody.trim();
  if (body.length === 0 || body.length > CHAT_BODY_MAX) {
    throw new TeamError(
      "INVALID_INPUT",
      `Message must be 1-${CHAT_BODY_MAX} characters.`,
      400,
    );
  }
  const message: ChatMessage = {
    id: randomUUID(),
    userId: author.id,
    userName: author.name,
    body,
    sentAt: now.toISOString(),
  };
  const month = currentChatMonth(now);
  const doc = await readMonthDoc(month);
  doc.messages.push(message);
  // Cap enforcement: keep only the newest MAX_MESSAGES_PER_MONTH;
  // older messages are dropped (see the header — not an archive).
  if (doc.messages.length > MAX_MESSAGES_PER_MONTH) {
    doc.messages = doc.messages.slice(-MAX_MESSAGES_PER_MONTH);
  }
  await writeDoc(chatKey(month), doc, author.id);
  return message;
}

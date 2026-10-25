/**
 * Contact form — DB store (server-only, Prisma).
 *
 * ⚠️ MODEL LANDING THIS ROUND — the ContactMessage model is being
 * added to packages/db/prisma/schema.prisma by the schema owner with
 * exactly this shape:
 *
 *   model ContactMessage {
 *     id        String   @id @default(cuid())
 *     name      String
 *     phone     String?
 *     email     String?
 *     subject   String?
 *     message   String
 *     status    String   @default("NEW")
 *     createdAt DateTime @default(now())
 *     updatedAt DateTime @updatedAt
 *   }
 *
 * Until the generated client carries the `contactMessage` delegate,
 * this store throws ContactStoreUnavailableError and the routes map
 * that to an honest 503 — a submission is NEVER fake-stored in memory
 * as a fallback. The adapter is written against a structural view of
 * the delegate (the src/newsletter/store-db.ts pattern), so it starts
 * working unchanged the moment the delegate exists.
 *
 * The stored lifecycle status starts at "NEW" (the model's default).
 * The public endpoint's `status: "received"` response is the API-level
 * acknowledgement that the message was stored — it is not the stored
 * status value, and no email/SMS is sent by either flow.
 *
 * PRIVACY: rows keep the normalized phone because support needs to
 * call the sender back. Admin list output goes through
 * toContactMessageListView(), which masks the phone unless the caller
 * holds customers.view_full_phone — the same gate as the F-commerce
 * inbox.
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "@advance-ecommerce/validators";
import type { ContactSubmissionInput } from "./types";

/**
 * Thrown when the ContactMessage model is not in the generated Prisma
 * client yet (schema + migration landing this round — the routes map
 * this to an honest 503, never a fake success).
 */
export class ContactStoreUnavailableError extends Error {
  constructor(message = "ContactMessage model is not available in the Prisma client yet.") {
    super(message);
    this.name = "ContactStoreUnavailableError";
  }
}

/** A stored contact message, timestamps as ISO strings. */
export interface ContactMessageRecord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  subject: string | null;
  message: string;
  /** Stored lifecycle status — starts at "NEW". */
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface ContactMessageRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  subject: string | null;
  message: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Structural view of the delegate the model above will generate. */
interface ContactMessageDelegate {
  create(args: {
    data: {
      name: string;
      phone: string | null;
      email: string | null;
      subject: string | null;
      message: string;
      status: string;
    };
  }): Promise<ContactMessageRow>;
  findMany(args: {
    orderBy: { createdAt: "desc" };
    take: number;
  }): Promise<ContactMessageRow[]>;
}

function delegate(): ContactMessageDelegate {
  const d = (prisma as unknown as { contactMessage?: ContactMessageDelegate }).contactMessage;
  if (!d) throw new ContactStoreUnavailableError();
  return d;
}

function rowToRecord(row: ContactMessageRow): ContactMessageRecord {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    subject: row.subject,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Persist one validated submission. Status starts at "NEW". */
export async function createContactMessage(
  input: ContactSubmissionInput,
): Promise<ContactMessageRecord> {
  const store = delegate();
  const row = await store.create({
    data: {
      name: input.name,
      phone: input.phone,
      email: input.email,
      subject: input.subject,
      message: input.message,
      status: "NEW",
    },
  });
  return rowToRecord(row);
}

/** Newest-first submissions for the admin read. */
export async function listContactMessages(take = 100): Promise<ContactMessageRecord[]> {
  const store = delegate();
  const rows = await store.findMany({ orderBy: { createdAt: "desc" }, take });
  return rows.map(rowToRecord);
}

/**
 * Admin list view of a submission. The phone is masked unless the
 * caller holds customers.view_full_phone (the inbox gate). The message
 * body IS included — the sender wrote it for staff to read, and this
 * view is only reachable behind admin auth + customers.view.
 */
export interface ContactMessageListView {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  subject: string | null;
  message: string;
  status: string;
  createdAt: string;
}

export function toContactMessageListView(
  record: ContactMessageRecord,
  canViewFullPhone: boolean,
): ContactMessageListView {
  return {
    id: record.id,
    name: record.name,
    phone:
      record.phone === null ? null : canViewFullPhone ? record.phone : maskPhone(record.phone),
    email: record.email,
    subject: record.subject,
    message: record.message,
    status: record.status,
    createdAt: record.createdAt,
  };
}

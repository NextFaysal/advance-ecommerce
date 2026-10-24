/**
 * Contact form — support inbox store. Agent 47.
 *
 * IN-MEMORY DEMO STORE: submissions live in a module-level array and
 * are lost on server restart. Labelled "in-memory-demo" in the API
 * meta. The DB version persists the same ContactSubmission shape to a
 * support-inbox table (the unified inbox module's human channels) —
 * recordContactSubmission / listContactSubmissions keep their contract.
 *
 * PRIVACY: the stored record keeps the normalized phone because support
 * needs to call the sender back, but every list/log view goes through
 * toContactListView(), which masks the phone and omits the body.
 */
import { maskPhone } from "@advance-ecommerce/validators";
import type {
  ContactSubmission,
  ContactSubmissionInput,
  ContactSubmissionListView,
} from "./types";

let sequence = 0;

function nextReferenceId(): string {
  sequence += 1;
  return `MSG-${Date.now().toString(36).toUpperCase()}-${String(sequence).padStart(4, "0")}`;
}

/** Mutable in-memory support inbox (demo only). */
export const contactSubmissionStore: ContactSubmission[] = [];

export function recordContactSubmission(
  input: ContactSubmissionInput,
  sourceIp: string,
  now: Date = new Date(),
): ContactSubmission {
  const record: ContactSubmission = {
    ...input,
    id: nextReferenceId(),
    status: "received",
    sourceIp,
    createdAt: now.toISOString(),
  };
  contactSubmissionStore.push(record);
  return record;
}

/**
 * A reference id that LOOKS like a real one but is never stored — used
 * for honeypot drops so the bot gets a plausible 201 and moves on.
 */
export function unstoredReferenceId(): string {
  return nextReferenceId();
}

export function toContactListView(record: ContactSubmission): ContactSubmissionListView {
  return {
    id: record.id,
    name: record.name,
    phoneMasked: maskPhone(record.phone),
    email: record.email,
    subject: record.subject,
    status: record.status,
    createdAt: record.createdAt,
  };
}

export function listContactSubmissions(): ContactSubmissionListView[] {
  return contactSubmissionStore.map(toContactListView);
}

// ---- Honeypot drop counter (silent — never exposed on the endpoint) --

let honeypotDropCount = 0;

/** Increment the silent drop counter. Call INSTEAD of storing. */
export function noteHoneypotDrop(): void {
  honeypotDropCount += 1;
}

export function getHoneypotDropCount(): number {
  return honeypotDropCount;
}

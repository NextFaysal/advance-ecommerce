/**
 * Contact form — shared types. Agent 47.
 *
 * A contact submission is persisted to the ContactMessage table (see
 * src/contact/store-db.ts) with lifecycle status "NEW". The public
 * success payload's status "received" means ONLY that the message was
 * accepted and stored — no email or SMS is ever sent by this flow, and
 * no type or response in this module may claim otherwise.
 */

/** Public acknowledgement status of a stored submission. */
export type ContactSubmissionStatus = "received";

/** Validated submission input (phone already normalized to +8801…). */
export interface ContactSubmissionInput {
  name: string;
  /** Normalized BD phone: +8801XXXXXXXXX. */
  phone: string;
  email: string | null;
  subject: string;
  message: string;
}

/** Public success payload of POST /api/v1/public/contact. */
export interface ContactReceivedData {
  id: string;
  status: ContactSubmissionStatus;
}

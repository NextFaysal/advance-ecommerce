/**
 * Contact form — shared types. Agent 47.
 *
 * A contact submission lands in the (demo) support inbox as a record
 * with status "received". That status means ONLY that the message was
 * accepted and stored — no email or SMS is ever sent by this flow, and
 * no type or response in this module may claim otherwise.
 */

/** Lifecycle of a support-inbox record. Only "received" exists today. */
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

/** Stored record (in-memory demo store — see store.ts). */
export interface ContactSubmission extends ContactSubmissionInput {
  id: string;
  status: ContactSubmissionStatus;
  /**
   * Client IP as observed from the request headers. PLACEHOLDER: until
   * a trusted-proxy setup exists this is just the first x-forwarded-for
   * hop (or "unknown") and must not be treated as a verified identity.
   */
  sourceIp: string;
  /** ISO timestamp. */
  createdAt: string;
}

/**
 * List/log view of a submission — the ONLY shape a list, log line, or
 * admin view may use. The phone is masked; the message body is omitted
 * (open the record to read it).
 */
export interface ContactSubmissionListView {
  id: string;
  name: string;
  phoneMasked: string;
  email: string | null;
  subject: string;
  status: ContactSubmissionStatus;
  createdAt: string;
}

/** Public success payload of POST /api/v1/public/contact. */
export interface ContactReceivedData {
  id: string;
  status: ContactSubmissionStatus;
}

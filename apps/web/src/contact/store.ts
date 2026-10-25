/**
 * Contact form — honeypot bookkeeping. Agent 47.
 *
 * Persistence lives in src/contact/store-db.ts (Prisma ContactMessage
 * table) — this module no longer stores submissions. What remains
 * here is the anti-spam side of the flow:
 *
 * - unstoredReferenceId(): a reference id that LOOKS like a real one
 *   but is never stored — honeypot-dropped bots get a plausible 201
 *   with one of these and move on, so they cannot tell they were
 *   dropped.
 * - the silent honeypot drop counter (never exposed on the endpoint).
 */

let sequence = 0;

function nextReferenceId(): string {
  sequence += 1;
  return `MSG-${Date.now().toString(36).toUpperCase()}-${String(sequence).padStart(4, "0")}`;
}

/** A plausible-looking reference id that is never stored (honeypot). */
export function unstoredReferenceId(): string {
  return nextReferenceId();
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

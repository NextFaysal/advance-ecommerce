/**
 * Support ticket status presentation (ADV-16b) — pure data, safe for
 * server and client components. OPEN means the ball is with staff,
 * PENDING means staff answered last, CLOSED is resolved/closed.
 */
import type { TicketStatus } from "./schema";

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "খোলা — স্টাফের উত্তরের অপেক্ষায়",
  PENDING: "স্টাফ উত্তর দিয়েছেন",
  CLOSED: "বন্ধ",
};

export const TICKET_STATUS_TONE: Record<TicketStatus, string> = {
  OPEN: "bg-amber-50 text-amber-700",
  PENDING: "bg-sky-50 text-sky-700",
  CLOSED: "bg-surface-2 text-text-muted",
};

export function formatTicketDate(iso: string): string {
  return new Intl.DateTimeFormat("bn-BD", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(new Date(iso));
}

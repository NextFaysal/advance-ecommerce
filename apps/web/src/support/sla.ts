/**
 * Support ticket SLA computation (ADV-16 remainder, doc 22).
 *
 * READ-TIME ONLY — by design there is NO background job, NO cron and
 * NO stored timer anywhere in this feature. Every SLA figure below is
 * derived on each read from data the ticket system already records:
 *
 *   first-response deadline = ticket.createdAt + sla_first_response_hours
 *   first response time     = createdAt of the earliest SupportTicketMessage
 *                             with authorType = "STAFF" (the thread itself
 *                             is the record — staff replies are stored with
 *                             authorType/authorId by replyToTicketAsStaff)
 *   resolution deadline     = ticket.createdAt + sla_resolution_hours
 *   resolution time         = for a CLOSED ticket, its updatedAt. That is
 *                             a proxy, stated honestly: the status PATCH
 *                             that closes a ticket stamps updatedAt, and a
 *                             closed ticket's row is not touched again
 *                             unless it is reopened (status stops being
 *                             CLOSED) — so while a ticket reads CLOSED,
 *                             updatedAt is the close moment.
 *
 * Targets live in Settings (`support.sla_first_response_hours`,
 * default 4; `support.sla_resolution_hours`, default 48) so changing
 * them re-judges every open ticket on the next read.
 */
import { getSetting } from "@/lib/settings";
import type { TicketStatus } from "./schema";

export const SLA_FIRST_RESPONSE_KEY = "support.sla_first_response_hours";
export const SLA_RESOLUTION_KEY = "support.sla_resolution_hours";
export const SLA_FIRST_RESPONSE_DEFAULT_HOURS = 4;
export const SLA_RESOLUTION_DEFAULT_HOURS = 48;

const HOUR_MS = 60 * 60 * 1000;
/** A pending deadline enters "at risk" once this fraction remains. */
const AT_RISK_FRACTION = 0.25;

export interface SlaConfig {
  firstResponseHours: number;
  resolutionHours: number;
}

export type TicketSlaState = "OK" | "AT_RISK" | "BREACHED";

export interface TicketSla {
  /** createdAt + first-response target (ISO). */
  firstResponseDueAt: string;
  /** Earliest STAFF message time (ISO), or null when staff never replied. */
  firstResponseAt: string | null;
  firstResponseBreached: boolean;
  /** createdAt + resolution target (ISO). */
  resolutionDueAt: string;
  resolutionBreached: boolean;
  state: TicketSlaState;
}

function parseHours(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  // Sanity bound: > 0 and at most 30 days — a typo'd "4000" must not
  // silently suspend every SLA badge.
  return Number.isFinite(n) && n > 0 && n <= 24 * 30 ? n : fallback;
}

/** SLA targets from Settings, falling back to the built-in defaults. */
export async function loadSlaConfig(): Promise<SlaConfig> {
  const [first, resolution] = await Promise.all([
    getSetting(SLA_FIRST_RESPONSE_KEY),
    getSetting(SLA_RESOLUTION_KEY),
  ]);
  return {
    firstResponseHours: parseHours(first, SLA_FIRST_RESPONSE_DEFAULT_HOURS),
    resolutionHours: parseHours(resolution, SLA_RESOLUTION_DEFAULT_HOURS),
  };
}

function toMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function atRisk(dueMs: number, windowMs: number, nowMs: number): boolean {
  return nowMs < dueMs && dueMs - nowMs <= windowMs * AT_RISK_FRACTION;
}

/**
 * Pure SLA state for one ticket. `now` is injectable for tests; the
 * store passes the read moment, so two reads a minute apart can
 * legitimately disagree near a deadline — that is the nature of a
 * read-time timer and is accepted.
 */
export function computeTicketSla(args: {
  createdAt: Date | string;
  status: TicketStatus;
  firstStaffReplyAt: Date | string | null;
  updatedAt: Date | string;
  config: SlaConfig;
  now?: Date;
}): TicketSla {
  const createdMs = toMs(args.createdAt);
  const nowMs = (args.now ?? new Date()).getTime();
  const firstWindowMs = args.config.firstResponseHours * HOUR_MS;
  const resolutionWindowMs = args.config.resolutionHours * HOUR_MS;
  const firstDueMs = createdMs + firstWindowMs;
  const resolutionDueMs = createdMs + resolutionWindowMs;

  const firstResponseMs =
    args.firstStaffReplyAt === null ? null : toMs(args.firstStaffReplyAt);
  const firstResponseBreached =
    firstResponseMs !== null ? firstResponseMs > firstDueMs : nowMs > firstDueMs;

  const closed = args.status === "CLOSED";
  const resolutionBreached = closed
    ? toMs(args.updatedAt) > resolutionDueMs
    : nowMs > resolutionDueMs;

  let state: TicketSlaState = "OK";
  if (firstResponseBreached || resolutionBreached) {
    state = "BREACHED";
  } else if (
    (firstResponseMs === null && atRisk(firstDueMs, firstWindowMs, nowMs)) ||
    (!closed && atRisk(resolutionDueMs, resolutionWindowMs, nowMs))
  ) {
    state = "AT_RISK";
  }

  return {
    firstResponseDueAt: new Date(firstDueMs).toISOString(),
    firstResponseAt:
      firstResponseMs === null ? null : new Date(firstResponseMs).toISOString(),
    firstResponseBreached,
    resolutionDueAt: new Date(resolutionDueMs).toISOString(),
    resolutionBreached,
    state,
  };
}

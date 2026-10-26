import { z } from "zod";

/**
 * Support ticket input contracts (ADV-16b, doc 22).
 *
 * Statuses are app-level strings on SupportTicket.status (the model
 * deliberately uses a String column, mirroring Review.status):
 *   OPEN    — waiting on staff (new ticket, or customer replied last)
 *   PENDING — staff replied last; waiting on the customer
 *   CLOSED  — staff closed it; a customer reply reopens it to OPEN
 */
export const TICKET_STATUSES = ["OPEN", "PENDING", "CLOSED"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const AUTHOR_TYPES = ["CUSTOMER", "STAFF"] as const;
export type TicketAuthorType = (typeof AUTHOR_TYPES)[number];

export const createTicketSchema = z.object({
  subject: z.string().trim().min(3, "বিষয় লিখুন").max(120),
  body: z.string().trim().min(3, "বার্তা লিখুন").max(5000),
  orderId: z.string().trim().min(1).max(64).optional(),
});
export type CreateTicketInput = z.infer<typeof createTicketSchema>;

export const ticketReplySchema = z.object({
  body: z.string().trim().min(1, "বার্তা লিখুন").max(5000),
});
export type TicketReplyInput = z.infer<typeof ticketReplySchema>;

export const setTicketStatusSchema = z.object({
  status: z.enum(TICKET_STATUSES),
});

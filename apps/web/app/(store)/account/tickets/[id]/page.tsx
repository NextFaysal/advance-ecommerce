/**
 * /account/tickets/[id] — one ticket thread (ADV-16b).
 *
 * Ownership is enforced in the store read (id + customerId in one
 * query): another customer's ticket renders the 404 page exactly
 * like a missing ticket. Replies go through the account tickets API,
 * which re-checks ownership again and reopens the ticket to OPEN.
 */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentCustomer } from "@/customer-auth/auth";
import { getTicketForCustomer } from "@/support/store";
import { TICKET_STATUS_LABEL, TICKET_STATUS_TONE, formatTicketDate } from "@/support/labels";
import { TicketReplyForm } from "../ticket-reply-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "টিকিট — Advance Ecommerce",
  robots: { index: false, follow: false },
};

export default async function AccountTicketDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const customer = await getCurrentCustomer();
  if (customer === null) redirect("/account");

  const ticket = await getTicketForCustomer(customer.id, params.id);
  if (ticket === null) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <p className="text-sm">
        <a href="/account/tickets" className="font-semibold text-brand-700 hover:underline">
          ← সব টিকিট
        </a>
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h1 className="font-display text-2xl font-bold text-text-main">{ticket.subject}</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${TICKET_STATUS_TONE[ticket.status]}`}
        >
          {TICKET_STATUS_LABEL[ticket.status]}
        </span>
        {ticket.orderNo ? (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted">
            অর্ডার: {ticket.orderNo}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm text-text-muted">
        খোলা হয়েছে {formatTicketDate(ticket.createdAt)}
        {ticket.status === "CLOSED"
          ? " · টিকিটটি বন্ধ আছে — উত্তর লিখলেই আবার খুলে যাবে।"
          : ""}
      </p>

      <section
        className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card"
        aria-label="বার্তাসমূহ"
      >
        <ul className="space-y-5">
          {ticket.messages.map((m) => (
            <li key={m.id} className={m.authorType === "STAFF" ? "pl-0 sm:pl-10" : "pr-0 sm:pr-10"}>
              <div
                className={`rounded-2xl px-4 py-3 ${
                  m.authorType === "STAFF" ? "bg-brand-50" : "bg-surface-2"
                }`}
              >
                <p className="text-xs font-bold text-text-main">
                  {m.authorType === "STAFF" ? "সাপোর্ট টিম" : "আপনি"}
                  <span className="ml-2 font-medium text-text-subtle">
                    {formatTicketDate(m.createdAt)}
                  </span>
                </p>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-text-main [overflow-wrap:anywhere]">
                  {m.body}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-6 border-t border-border pt-5">
          <TicketReplyForm ticketId={ticket.id} />
        </div>
      </section>
    </main>
  );
}

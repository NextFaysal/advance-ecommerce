/**
 * /account/tickets — the customer's support tickets (ADV-16b).
 *
 * Server-rendered from the SupportTicket table via src/support —
 * ONLY the signed-in customer's own tickets are ever read (the store
 * filters on customerId). Logged-out visitors are sent to /account
 * to log in first. The create form's order dropdown is built from
 * the customer's own recent orders; the server re-verifies any
 * submitted orderId against the same ownership rule.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentCustomer, listCustomerOrders } from "@/customer-auth/auth";
import { listTicketsForCustomer } from "@/support/store";
import { TICKET_STATUS_LABEL, TICKET_STATUS_TONE, formatTicketDate } from "@/support/labels";
import { CreateTicketForm } from "./create-ticket-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "সাপোর্ট টিকিট — Advance Ecommerce",
  description: "আপনার সাপোর্ট টিকিটসমূহ ও নতুন টিকিট খুলুন।",
  robots: { index: false, follow: false },
};

export default async function AccountTicketsPage() {
  const customer = await getCurrentCustomer();
  if (customer === null) redirect("/account");

  const [tickets, { orders }] = await Promise.all([
    listTicketsForCustomer(customer.id),
    listCustomerOrders(customer.id, 1, 20),
  ]);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <p className="text-sm">
        <a href="/account" className="font-semibold text-brand-700 hover:underline">
          ← আমার অ্যাকাউন্ট
        </a>
      </p>
      <h1 className="mt-2 font-display text-2xl font-bold text-text-main">সাপোর্ট টিকিট</h1>
      <p className="mt-1.5 text-sm leading-6 text-text-muted">
        অর্ডার বা কেনাকাটা নিয়ে কোনো সমস্যা থাকলে টিকিট খুলুন — আমাদের টিম এখানেই উত্তর দেবে।
        প্রতিটি টিকিটের সব বার্তা এক জায়গায় থাকে। টিকিট খোলার আগে{" "}
        <a href="/kb" className="font-semibold text-brand-700 hover:underline">
          সাহায্য কেন্দ্র / Knowledge base
        </a>
        -এ সাধারণ প্রশ্নের উত্তর খুঁজে দেখতে পারেন।
      </p>

      <section
        className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card"
        aria-label="আমার টিকিট"
      >
        <h2 className="text-base font-bold text-text-main">আমার টিকিট</h2>
        {tickets.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-text-muted">
            এখনো কোনো টিকিট খোলেননি।
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {tickets.map((t) => (
              <li key={t.id} className="py-3.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <a
                    href={`/account/tickets/${t.id}`}
                    className="text-sm font-semibold text-text-main hover:text-brand-700 hover:underline"
                  >
                    {t.subject}
                  </a>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${TICKET_STATUS_TONE[t.status]}`}
                  >
                    {TICKET_STATUS_LABEL[t.status]}
                  </span>
                  {t.orderNo ? (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted">
                      অর্ডার: {t.orderNo}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted">
                  {t.lastMessagePreview ?? ""}
                </p>
                <p className="mt-1 text-xs text-text-subtle">
                  {t.messageCount}টি বার্তা · সর্বশেষ {formatTicketDate(t.updatedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card"
        aria-label="নতুন টিকিট"
      >
        <h2 className="text-base font-bold text-text-main">নতুন টিকিট খুলুন</h2>
        <p className="mt-1.5 text-xs leading-5 text-text-muted">
          হয়তো আপনার প্রশ্নের উত্তর{" "}
          <a href="/kb" className="font-semibold text-brand-700 hover:underline">
            সাহায্য কেন্দ্রে
          </a>{" "}
          আগেই আছে — একবার দেখে নিন।
        </p>
        <div className="mt-4">
          <CreateTicketForm orders={orders.map((o) => ({ id: o.id, orderNo: o.orderNo }))} />
        </div>
      </section>
    </main>
  );
}

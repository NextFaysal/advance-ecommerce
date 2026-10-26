"use client";

/**
 * New support ticket form (account area). POSTs to
 * /api/v1/public/account/tickets; the optional order is one of the
 * customer's OWN orders (the server re-verifies ownership — a
 * tampered orderId is rejected with ORDER_NOT_OWNED and the API's
 * message is shown as-is). On success we navigate to the new
 * ticket's thread page.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

interface CreateResponse {
  data?: { ticket: { id: string } };
  error?: { message?: string };
}

const inputClass =
  "h-12 w-full rounded-xl border border-border bg-surface px-4 text-sm text-text-main shadow-sm outline-none focus:border-brand-500";

export function CreateTicketForm({
  orders,
}: {
  orders: Array<{ id: string; orderNo: string }>;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [orderId, setOrderId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/public/account/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          body: body.trim(),
          ...(orderId ? { orderId } : {}),
        }),
      });
      const json = (await res.json().catch(() => null)) as CreateResponse | null;
      if (!res.ok || !json?.data?.ticket) {
        setError(json?.error?.message ?? "টিকিট খোলা যায়নি — আবার চেষ্টা করুন।");
        return;
      }
      router.push(`/account/tickets/${json.data.ticket.id}`);
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3.5">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-main" htmlFor="ticket-subject">
          বিষয়
        </label>
        <input
          id="ticket-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
          minLength={3}
          maxLength={120}
          placeholder="যেমন: অর্ডার এখনো পৌঁছায়নি"
          className={inputClass}
        />
      </div>

      {orders.length > 0 ? (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-main" htmlFor="ticket-order">
            সংশ্লিষ্ট অর্ডার (ঐচ্ছিক)
          </label>
          <select
            id="ticket-order"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            className={inputClass}
          >
            <option value="">কোনো নির্দিষ্ট অর্ডার নয়</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNo}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-main" htmlFor="ticket-body">
          বিস্তারিত লিখুন
        </label>
        <textarea
          id="ticket-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          minLength={3}
          maxLength={5000}
          rows={4}
          placeholder="সমস্যাটি বিস্তারিত লিখুন…"
          className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-6 text-text-main shadow-sm outline-none focus:border-brand-500"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-rose-600">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="brand-gradient h-12 rounded-xl px-6 text-sm font-bold text-white shadow-md transition hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
      >
        {submitting ? "খোলা হচ্ছে…" : "টিকিট খুলুন"}
      </button>
    </form>
  );
}

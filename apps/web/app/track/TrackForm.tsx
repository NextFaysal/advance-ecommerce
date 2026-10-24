"use client";

/**
 * Tracking lookup form + result — Agent 19. Client component.
 * Posts { orderNo, phone } to /api/v1/public/track (POST so the phone is
 * never in a URL). Renders the timeline from the API view: done/current/
 * upcoming steps, shipment status, items and total. Phone shown masked only.
 */
import { useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import type { TrackingView } from "@/storefront-ux/order-tracking";

type State =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "error"; message: string }
  | { phase: "done"; view: TrackingView };

export default function TrackForm() {
  const [orderNo, setOrderNo] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ phase: "submitting" });
    try {
      const res = await fetch("/api/v1/public/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderNo, phone }),
      });
      const body: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: { message?: string } }).error.message ?? "খুঁজে পাওয়া যায়নি।")
            : "খুঁজে পাওয়া যায়নি।";
        setState({ phase: "error", message });
        return;
      }
      setState({ phase: "done", view: (body as { data: { tracking: TrackingView } }).data.tracking });
    } catch {
      setState({ phase: "error", message: "নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।" });
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="rounded-xl border bg-white px-4 py-5 shadow-sm">
        <label className="block text-sm font-semibold" htmlFor="track-order-no">
          অর্ডার নম্বর
        </label>
        <input
          id="track-order-no"
          placeholder="ORD-100245"
          value={orderNo}
          onChange={(e) => setOrderNo(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          required
        />
        <label className="mt-4 block text-sm font-semibold" htmlFor="track-phone">
          মোবাইল নম্বর (অর্ডারের সময় দেওয়া)
        </label>
        <input
          id="track-phone"
          inputMode="tel"
          autoComplete="tel"
          placeholder="01XXXXXXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
          required
        />
        <button
          type="submit"
          disabled={state.phase === "submitting"}
          className="mt-4 w-full rounded-lg bg-[#4F46E5] px-4 py-3 font-semibold text-white disabled:opacity-60"
        >
          {state.phase === "submitting" ? "খুঁজছি…" : "অর্ডার ট্র্যাক করুন"}
        </button>
        <p className="mt-2 text-xs text-slate-500">
          নিরাপত্তার জন্য অল্প সময়ে বারবার চেষ্টা সীমিত (rate limit) করা আছে।
        </p>
        {state.phase === "error" && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {state.message}
          </p>
        )}
      </form>

      {state.phase === "done" && (
        <section className="mt-4 rounded-xl border bg-white px-4 py-5 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold">{state.view.orderNo}</h2>
            <span className="rounded-full bg-[#EEF0FE] px-3 py-1 text-sm font-medium text-[#4F46E5]">
              {state.view.statusLabelBn}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500">ফোন: {state.view.maskedPhone}</p>

          <ol className="mt-4 space-y-3">
            {state.view.timeline.map((step) => (
              <li key={step.status} className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs text-white ${
                    step.state === "done"
                      ? "bg-green-500"
                      : step.state === "current"
                        ? "bg-[#4F46E5]"
                        : "bg-slate-300"
                  }`}
                >
                  {step.state === "done" ? "✓" : step.state === "current" ? "•" : ""}
                </span>
                <span>
                  <span className={step.state === "upcoming" ? "text-slate-400" : "font-medium"}>{step.labelBn}</span>
                  {step.at && (
                    <span className="block text-xs text-slate-500">
                      {new Date(step.at).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>

          {state.view.shipmentStatusLabelBn && (
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              কুরিয়ার: {state.view.courier ?? "—"}
              {state.view.trackingId ? ` • ট্র্যাকিং: ${state.view.trackingId}` : ""} • {state.view.shipmentStatusLabelBn}
            </p>
          )}

          <h3 className="mt-4 text-sm font-semibold">পণ্য</h3>
          <ul className="mt-1 space-y-1 text-sm">
            {state.view.items.map((item, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>
                  {item.productName} × {item.quantity}
                </span>
                <span>{formatBdt(item.unitPricePoisha * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex justify-between border-t pt-2 font-semibold">
            <span>মোট</span>
            <span>{formatBdt(state.view.totalPoisha)}</span>
          </p>
          <p className="mt-1 text-sm text-slate-500">
            পেমেন্ট: {state.view.paymentMethod} / {state.view.paymentStatus}
          </p>
        </section>
      )}
    </div>
  );
}

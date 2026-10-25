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
import { Icon } from "@/components/ui/icon";
import { useDigitText } from "@/components/ui/numerals";

// Mobile polish (Design v3 §3): 48px fields and submit, token colours,
// and a connected result timeline. Presentation only — the lookup call
// and the TrackingView rendering contract are unchanged.
const TRACK_INPUT_CLASS =
  "mt-1.5 h-12 w-full rounded-xl border border-border bg-card px-4 text-sm text-text-main outline-none transition placeholder:text-text-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";

type State =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "error"; message: string }
  | { phase: "done"; view: TrackingView };

export default function TrackForm() {
  const [orderNo, setOrderNo] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<State>({ phase: "idle" });
  // Money honours the visitor's numerals preference (order numbers
  // and quantities are never passed through this — display only).
  const digits = useDigitText();

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
      <form onSubmit={submit} className="rounded-2xl border border-border bg-card px-5 py-5 shadow-card">
        <label className="block text-sm font-semibold text-text-main" htmlFor="track-order-no">
          অর্ডার নম্বর
        </label>
        <input
          id="track-order-no"
          autoComplete="off"
          placeholder="ORD-100245"
          value={orderNo}
          onChange={(e) => setOrderNo(e.target.value)}
          className={TRACK_INPUT_CLASS}
          required
        />
        <label className="mt-4 block text-sm font-semibold text-text-main" htmlFor="track-phone">
          মোবাইল নম্বর (অর্ডারের সময় দেওয়া)
        </label>
        <input
          id="track-phone"
          inputMode="tel"
          autoComplete="tel"
          placeholder="01XXXXXXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={TRACK_INPUT_CLASS}
          required
        />
        <button
          type="submit"
          disabled={state.phase === "submitting"}
          className="brand-gradient mt-5 h-12 w-full rounded-xl text-base font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60"
        >
          {state.phase === "submitting" ? "খুঁজছি…" : "অর্ডার ট্র্যাক করুন"}
        </button>
        <p className="mt-2.5 text-xs leading-5 text-text-muted">
          নিরাপত্তার জন্য অল্প সময়ের মধ্যে বারবার চেষ্টা সীমিত রাখা হয়েছে।
        </p>
        {state.phase === "error" && (
          <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
            {state.message}
          </p>
        )}
      </form>

      {state.phase === "done" && (
        <section className="mt-4 rounded-2xl border border-border bg-card px-5 py-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-text-main">{state.view.orderNo}</h2>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">
              {state.view.statusLabelBn}
            </span>
          </div>
          <p className="mt-1 text-sm text-text-muted">ফোন: {state.view.maskedPhone}</p>

          <ol className="mt-5 space-y-4">
            {state.view.timeline.map((step, idx) => (
              <li key={step.status} className="relative flex items-start gap-3">
                {idx < state.view.timeline.length - 1 && (
                  <span aria-hidden className="absolute -bottom-4 left-[13px] top-7 w-0.5 bg-border" />
                )}
                <span
                  aria-hidden
                  className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    step.state === "done"
                      ? "bg-emerald-500 text-white"
                      : step.state === "current"
                        ? "bg-brand-600 text-white ring-4 ring-brand-100"
                        : "border-2 border-border bg-card"
                  }`}
                >
                  {step.state === "done" ? (
                    <Icon name="check" size={14} strokeWidth={2.5} />
                  ) : step.state === "current" ? (
                    <span className="h-2 w-2 rounded-full bg-white" />
                  ) : null}
                </span>
                <span className="min-w-0 pt-0.5">
                  <span
                    className={
                      step.state === "upcoming" ? "text-sm text-text-subtle" : "text-sm font-semibold text-text-main"
                    }
                  >
                    {step.labelBn}
                  </span>
                  {step.at && (
                    <span className="block text-xs text-text-muted">
                      {new Date(step.at).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>

          {state.view.shipmentStatusLabelBn && (
            <p className="mt-5 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-text-main">
              কুরিয়ার: {state.view.courier ?? "—"}
              {state.view.trackingId ? ` • ট্র্যাকিং: ${state.view.trackingId}` : ""} • {state.view.shipmentStatusLabelBn}
            </p>
          )}

          <h3 className="mt-5 text-sm font-semibold text-text-main">পণ্য</h3>
          <ul className="mt-1.5 space-y-1.5 text-sm">
            {state.view.items.map((item, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="min-w-0">
                  {item.productName} × {item.quantity}
                </span>
                <span className="shrink-0 tabular-nums">{digits(formatBdt(item.unitPricePoisha * item.quantity))}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex justify-between border-t border-border pt-3 font-semibold text-text-main">
            <span>মোট</span>
            <span className="tabular-nums">{digits(formatBdt(state.view.totalPoisha))}</span>
          </p>
          <p className="mt-1.5 text-sm text-text-muted">
            পেমেন্ট: {state.view.paymentMethod} / {state.view.paymentStatus}
          </p>
        </section>
      )}
    </div>
  );
}

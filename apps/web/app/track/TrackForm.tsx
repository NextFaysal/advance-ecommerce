"use client";

/**
 * Tracking lookup form + result — Agent 19. Client component.
 * Posts { orderNo, phone } to /api/v1/public/track (POST so the phone is
 * never in a URL). Renders the timeline from the API view: done/current/
 * upcoming steps, items and total. Phone shown masked only.
 *
 * Shipment section (doc 21 G3-20): when the view carries real parcels
 * (view.parcels, from Shipment rows) each parcel gets its own card —
 * courier, tracking code, a parcel stepper in OD5's visual language,
 * its split items when the booking was split, and the REAL courier
 * event timeline. When the order has no Shipment rows the API marks
 * the view shipmentSource "order-status" and this renders the old
 * derived summary strip PLUS an explicit note that it follows the
 * order's steps, not live courier data — never a fake parcel.
 */
import { useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import type { TrackingParcel, TrackingView } from "@/storefront-ux/order-tracking";
import { Icon, type IconName } from "@/components/ui/icon";
import { useDigitText } from "@/components/ui/numerals";

// Mobile polish (Design v3 §3): 48px fields and submit, token colours,
// and a connected result timeline. Presentation only — the lookup call
// and the TrackingView rendering contract are unchanged.
const TRACK_INPUT_CLASS =
  "mt-1.5 h-12 w-full rounded-xl border border-border bg-card px-4 text-sm text-text-main outline-none transition placeholder:text-text-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";

/* Parcel stepper — the OD5 shipments-panel visual language (same
 * pipeline steps, off-path banners and tones), mirrored here rather
 * than imported: the panel is admin code and must not leak into the
 * public storefront bundle. OD7's account stepper follows the same
 * mirror-don't-import pattern. */
const PARCEL_PIPELINE_STEPS = [
  { status: "CREATED", labelBn: "তৈরি", icon: "package" },
  { status: "PICKED_UP", labelBn: "পিকআপ", icon: "box" },
  { status: "IN_TRANSIT", labelBn: "পথে", icon: "truck" },
  { status: "OUT_FOR_DELIVERY", labelBn: "ডেলিভারিতে", icon: "arrow-right" },
  { status: "DELIVERED", labelBn: "ডেলিভার্ড", icon: "check" },
] as const satisfies readonly { status: string; labelBn: string; icon: IconName }[];

const PARCEL_OFF_PATH: Record<string, { labelBn: string; icon: IconName; cls: string }> = {
  FAILED: { labelBn: "ডেলিভারি ব্যর্থ হয়েছে", icon: "alert", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  RETURNING: { labelBn: "পার্সেলটি ফেরত আসছে", icon: "rotate-ccw", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  RETURNED: { labelBn: "পার্সেলটি ফেরত এসেছে", icon: "rotate-ccw", cls: "border-border bg-slate-50 text-slate-600" },
};

function ParcelStepper({ status }: { status: string }) {
  const activeIdx = PARCEL_PIPELINE_STEPS.findIndex((s) => s.status === status);
  if (activeIdx === -1) {
    const off = PARCEL_OFF_PATH[status];
    if (!off) return null;
    return (
      <p className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${off.cls}`}>
        <Icon name={off.icon} size={16} />
        {off.labelBn}
      </p>
    );
  }
  return (
    <ol className="mt-3 flex items-start" aria-label={`পার্সেলের অবস্থা: ${PARCEL_PIPELINE_STEPS[activeIdx].labelBn}`}>
      {PARCEL_PIPELINE_STEPS.map((step, idx) => {
        const done = idx < activeIdx || status === "DELIVERED";
        const active = idx === activeIdx && status !== "DELIVERED";
        return (
          <li key={step.status} className={`flex items-start ${idx > 0 ? "flex-1" : ""}`}>
            {idx > 0 && (
              <span aria-hidden="true" className={`mx-1 mt-[13px] h-0.5 flex-1 rounded ${idx <= activeIdx ? "bg-emerald-400" : "bg-border"}`} />
            )}
            <span className="flex w-12 flex-col items-center gap-1 text-center sm:w-14">
              <span
                aria-hidden="true"
                className={`flex h-[27px] w-[27px] items-center justify-center rounded-full ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-brand-600 text-white ring-4 ring-brand-100"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                <Icon name={done ? "check" : step.icon} size={14} />
              </span>
              <span className={`text-caption leading-tight ${done || active ? "font-semibold text-text-main" : "text-text-muted"}`}>
                {step.labelBn}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** One real parcel: courier + tracking code, stepper, split items and
 *  the recorded courier events (real timestamps, oldest first). */
function ParcelCard({ parcel, index, total }: { parcel: TrackingParcel; index: number; total: number }) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-2/60 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-main">
          {total > 1 ? `পার্সেল ${index + 1} — ` : ""}কুরিয়ার: {parcel.courier}
        </h3>
        <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
          {parcel.statusLabelBn}
        </span>
      </div>
      {parcel.trackingId && <p className="mt-1 text-xs text-text-muted">ট্র্যাকিং নম্বর: {parcel.trackingId}</p>}

      <ParcelStepper status={parcel.status} />

      {parcel.items && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-text-muted">এই পার্সেলে আছে:</p>
          <ul className="mt-1 space-y-0.5 text-sm text-text-main">
            {parcel.items.map((item, i) => (
              <li key={i}>
                {item.productName} × {item.quantity}
              </li>
            ))}
          </ul>
        </div>
      )}

      {parcel.events.length > 0 && (
        <ol className="mt-4 space-y-3 border-t border-border pt-3">
          {parcel.events.map((ev, i) => (
            <li key={i} className="relative flex items-start gap-2.5">
              {i < parcel.events.length - 1 && (
                <span aria-hidden className="absolute -bottom-3 left-[5px] top-4 w-0.5 bg-border" />
              )}
              <span
                aria-hidden
                className={`relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full ${
                  i === parcel.events.length - 1 ? "bg-brand-600 ring-4 ring-brand-100" : "bg-emerald-500"
                }`}
              />
              <span className="min-w-0">
                <span className="text-sm font-medium text-text-main">{ev.labelBn}</span>
                <span className="block text-xs text-text-muted">
                  {new Date(ev.at).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })}
                  {ev.location ? ` • ${ev.location}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

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

          {/* Restaurant kitchen state (ADV-23, wave 56): present only
              when the order has a kitchen ticket — the real ticket
              status from the KDS queue, projected server-side. */}
          {state.view.kitchen && (
            <p className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-text-main">
              <span aria-hidden="true">🍳</span>
              <span className="font-semibold">রান্নাঘর:</span>
              <span>{state.view.kitchen.statusLabelBn}</span>
              <span className="text-text-muted">
                {state.view.kitchen.fulfilmentType === "DINE_IN"
                  ? `• ডাইন-ইন${state.view.kitchen.tableLabel ? ` • টেবিল: ${state.view.kitchen.tableLabel}` : ""}`
                  : "• টেকঅওয়ে"}
              </span>
            </p>
          )}

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

          {state.view.parcels.length > 0 ? (
            <div>
              {state.view.parcels.map((parcel, i) => (
                <ParcelCard key={i} parcel={parcel} index={i} total={state.view.parcels.length} />
              ))}
            </div>
          ) : (
            <>
              {state.view.shipmentStatusLabelBn && (
                <p className="mt-5 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-text-main">
                  কুরিয়ার: {state.view.courier ?? "—"}
                  {state.view.trackingId ? ` • ট্র্যাকিং: ${state.view.trackingId}` : ""} • {state.view.shipmentStatusLabelBn}
                </p>
              )}
              {/* Honest fallback label (G3-20): no Shipment rows exist for
                  this order yet, so nothing above is live courier data. */}
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-5 text-amber-800">
                <Icon name="info" size={14} className="mt-0.5 shrink-0" />
                কুরিয়ারের লাইভ ট্র্যাকিং তথ্য এখনো এই অর্ডারে যুক্ত হয়নি — বুকিং হলে কুরিয়ারের নাম, ট্র্যাকিং
                নম্বর ও লাইভ অবস্থা এখানে দেখা যাবে। আপাতত অবস্থা অর্ডারের ধাপ অনুযায়ী দেখানো হচ্ছে।
              </p>
            </>
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

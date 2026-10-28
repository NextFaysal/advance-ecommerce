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
 *
 * Language (doc 30, slice L3d): all chrome copy comes from
 * ./strings via useLocale(). The API view carries Bangla-only labels
 * next to raw status codes — in Bangla mode those server labels are
 * rendered as-is; in English mode labels are translated from the
 * status code via the strings maps (server label as fallback). Server
 * API error messages are shown verbatim (they arrive Bangla-only from
 * the API — see slice report remainder).
 */
import { useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import type { TrackingParcel, TrackingView } from "@/storefront-ux/order-tracking";
import { Icon, type IconName } from "@/components/ui/icon";
import { useDigitText } from "@/components/ui/numerals";
import { useLocale } from "@/i18n/LocaleProvider";
import { intlLocale, pick, type Locale } from "@/i18n/locale";
import {
  KITCHEN_STATUS_STRINGS,
  ORDER_STATUS_STRINGS,
  PARCEL_STEP_STRINGS,
  SHIPMENT_STATUS_STRINGS,
  TRACK_STRINGS,
  type TrackStrings,
} from "./strings";

// Mobile polish (Design v3 §3): 48px fields and submit, token colours,
// and a connected result timeline. Presentation only — the lookup call
// and the TrackingView rendering contract are unchanged.
const TRACK_INPUT_CLASS =
  "mt-1.5 h-12 w-full rounded-xl border border-border bg-card px-4 text-sm text-text-main outline-none transition placeholder:text-text-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";

/* Parcel stepper — the OD5 shipments-panel visual language (same
 * pipeline steps, off-path banners and tones), mirrored here rather
 * than imported: the panel is admin code and must not leak into the
 * public storefront bundle. OD7's account stepper follows the same
 * mirror-don't-import pattern. Step labels come from PARCEL_STEP_STRINGS
 * in the active locale. */
const PARCEL_PIPELINE_STEPS = [
  { status: "CREATED", icon: "package" },
  { status: "PICKED_UP", icon: "box" },
  { status: "IN_TRANSIT", icon: "truck" },
  { status: "OUT_FOR_DELIVERY", icon: "arrow-right" },
  { status: "DELIVERED", icon: "check" },
] as const satisfies readonly { status: string; icon: IconName }[];

const PARCEL_OFF_PATH: Record<string, { icon: IconName; cls: string }> = {
  FAILED: { icon: "alert", cls: "border-danger/30 bg-danger-soft text-danger" },
  RETURNING: { icon: "rotate-ccw", cls: "border-warning-solid/30 bg-warning-soft text-warning-solid" },
  RETURNED: { icon: "rotate-ccw", cls: "border-border bg-surface-2 text-text-muted" },
};

function stepLabel(locale: Locale, status: string): string {
  const labels = pick(locale, PARCEL_STEP_STRINGS) as Record<string, string>;
  return labels[status] ?? status;
}

function ParcelStepper({ status, locale }: { status: string; locale: Locale }) {
  const t = pick(locale, TRACK_STRINGS);
  const activeIdx = PARCEL_PIPELINE_STEPS.findIndex((s) => s.status === status);
  if (activeIdx === -1) {
    const off = PARCEL_OFF_PATH[status];
    if (!off) return null;
    return (
      <p className={`mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${off.cls}`}>
        <Icon name={off.icon} size={16} />
        {stepLabel(locale, status)}
      </p>
    );
  }
  return (
    <ol
      className="mt-3 flex items-start"
      aria-label={`${t.parcelStatusAria}: ${stepLabel(locale, PARCEL_PIPELINE_STEPS[activeIdx].status)}`}
    >
      {PARCEL_PIPELINE_STEPS.map((step, idx) => {
        const done = idx < activeIdx || status === "DELIVERED";
        const active = idx === activeIdx && status !== "DELIVERED";
        return (
          <li key={step.status} className={`flex items-start ${idx > 0 ? "flex-1" : ""}`}>
            {idx > 0 && (
              <span aria-hidden="true" className={`mx-1 mt-[13px] h-0.5 flex-1 rounded ${idx <= activeIdx ? "bg-success-solid" : "bg-border"}`} />
            )}
            <span className="flex w-12 flex-col items-center gap-1 text-center sm:w-14">
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 items-center justify-center rounded-full ${
                  done
                    ? "bg-success-solid text-white"
                    : active
                      ? "bg-brand-600 text-white ring-4 ring-brand-100"
                      : "bg-surface-2 text-text-subtle"
                }`}
              >
                <Icon name={done ? "check" : step.icon} size={14} />
              </span>
              <span className={`text-caption leading-tight ${done || active ? "font-semibold text-text-main" : "text-text-muted"}`}>
                {stepLabel(locale, step.status)}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Label for a status-coded value: Bangla renders the server's label
 *  (canonical wording); English translates from the code via `dict`,
 *  falling back to the server label for unknown codes. */
function statusLabel(
  locale: Locale,
  dict: Record<Locale, Record<string, string>>,
  code: string,
  serverLabelBn: string,
): string {
  if (locale === "bn") return serverLabelBn;
  return pick(locale, dict)[code] ?? serverLabelBn;
}

/** One real parcel: courier + tracking code, stepper, split items and
 *  the recorded courier events (real timestamps, oldest first). */
function ParcelCard({
  parcel,
  index,
  total,
  locale,
  t,
}: {
  parcel: TrackingParcel;
  index: number;
  total: number;
  locale: Locale;
  t: TrackStrings;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-border bg-surface-2/60 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-main">
          {total > 1 ? `${t.parcelPrefix} ${index + 1} — ` : ""}
          {t.courierLabel}: {parcel.courier}
        </h3>
        <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
          {statusLabel(locale, SHIPMENT_STATUS_STRINGS, parcel.status, parcel.statusLabelBn)}
        </span>
      </div>
      {parcel.trackingId && (
        <p className="mt-1 text-xs text-text-muted">
          {t.trackingNoLabel}: {parcel.trackingId}
        </p>
      )}

      <ParcelStepper status={parcel.status} locale={locale} />

      {parcel.items && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-text-muted">{t.parcelItemsHeading}</p>
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
                  i === parcel.events.length - 1 ? "bg-brand-600 ring-4 ring-brand-100" : "bg-success-solid"
                }`}
              />
              <span className="min-w-0">
                <span className="text-sm font-medium text-text-main">
                  {statusLabel(locale, SHIPMENT_STATUS_STRINGS, ev.status, ev.labelBn)}
                </span>
                <span className="block text-xs text-text-muted">
                  {new Date(ev.at).toLocaleString(intlLocale(locale), { timeZone: "Asia/Dhaka" })}
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
  const { locale } = useLocale();
  const t = pick(locale, TRACK_STRINGS);
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
            ? String((body as { error: { message?: string } }).error.message ?? t.notFoundFallback)
            : t.notFoundFallback;
        setState({ phase: "error", message });
        return;
      }
      setState({ phase: "done", view: (body as { data: { tracking: TrackingView } }).data.tracking });
    } catch {
      setState({ phase: "error", message: t.networkError });
    }
  }

  return (
    <div>
      <form onSubmit={submit} className="rounded-2xl border border-border bg-card px-5 py-5 shadow-card">
        <label className="block text-sm font-semibold text-text-main" htmlFor="track-order-no">
          {t.orderNoLabel}
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
          {t.phoneLabel}
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
          {state.phase === "submitting" ? t.submitBusy : t.submitIdle}
        </button>
        <p className="mt-2.5 text-xs leading-5 text-text-muted">{t.rateLimitNote}</p>
        {state.phase === "error" && (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
            {state.message}
          </p>
        )}
      </form>

      {state.phase === "done" && (
        <section className="mt-4 rounded-2xl border border-border bg-card px-5 py-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-text-main">{state.view.orderNo}</h2>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700">
              {statusLabel(locale, ORDER_STATUS_STRINGS, state.view.status, state.view.statusLabelBn)}
            </span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            {t.phonePrefix}: {state.view.maskedPhone}
          </p>

          {/* Merchant workflow stage (ADV-26, BUILD-LITE): present
              only when staff set a stage on this order — a friendly
              step label under the canonical status above, which
              remains the status of record. The view carries BOTH
              labels, so it follows the active locale directly. */}
          {state.view.workflowStage && (
            <p className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-text-main">
              <span className="font-semibold">{t.currentStageLabel}</span>
              <span>{locale === "bn" ? state.view.workflowStage.labelBn : state.view.workflowStage.labelEn}</span>
            </p>
          )}

          {/* Restaurant kitchen state (ADV-23, wave 56): present only
              when the order has a kitchen ticket — the real ticket
              status from the KDS queue, projected server-side. */}
          {state.view.kitchen && (
            <p className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-surface-2 px-4 py-3 text-sm text-text-main">
              <span aria-hidden="true">🍳</span>
              <span className="font-semibold">{t.kitchenLabel}</span>
              <span>{statusLabel(locale, KITCHEN_STATUS_STRINGS, state.view.kitchen.status, state.view.kitchen.statusLabelBn)}</span>
              <span className="text-text-muted">
                {state.view.kitchen.fulfilmentType === "DINE_IN"
                  ? `• ${t.dineIn}${state.view.kitchen.tableLabel ? ` • ${t.tableLabel}: ${state.view.kitchen.tableLabel}` : ""}`
                  : `• ${t.takeaway}`}
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
                      ? "bg-success-solid text-white"
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
                    {statusLabel(locale, ORDER_STATUS_STRINGS, step.status, step.labelBn)}
                  </span>
                  {step.at && (
                    <span className="block text-xs text-text-muted">
                      {new Date(step.at).toLocaleString(intlLocale(locale), { timeZone: "Asia/Dhaka" })}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>

          {state.view.parcels.length > 0 ? (
            <div>
              {state.view.parcels.map((parcel, i) => (
                <ParcelCard key={i} parcel={parcel} index={i} total={state.view.parcels.length} locale={locale} t={t} />
              ))}
            </div>
          ) : (
            <>
              {state.view.shipmentStatusLabelBn && (
                <p className="mt-5 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-text-main">
                  {t.courierLabel}: {state.view.courier ?? "—"}
                  {state.view.trackingId ? ` • ${t.shipmentTrackingLabel}: ${state.view.trackingId}` : ""} •{" "}
                  {state.view.shipmentStatus
                    ? statusLabel(locale, SHIPMENT_STATUS_STRINGS, state.view.shipmentStatus, state.view.shipmentStatusLabelBn)
                    : state.view.shipmentStatusLabelBn}
                </p>
              )}
              {/* Honest fallback label (G3-20): no Shipment rows exist for
                  this order yet, so nothing above is live courier data. */}
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-warning-solid/30 bg-warning-soft px-3.5 py-2.5 text-xs leading-5 text-warning-solid">
                <Icon name="info" size={14} className="mt-0.5 shrink-0" />
                {t.noLiveCourierNote}
              </p>
            </>
          )}

          <h3 className="mt-5 text-sm font-semibold text-text-main">{t.itemsHeading}</h3>
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
            <span>{t.totalLabel}</span>
            <span className="tabular-nums">{digits(formatBdt(state.view.totalPoisha))}</span>
          </p>
          <p className="mt-1.5 text-sm text-text-muted">
            {t.paymentLabel}: {state.view.paymentMethod} / {state.view.paymentStatus}
          </p>
        </section>
      )}
    </div>
  );
}

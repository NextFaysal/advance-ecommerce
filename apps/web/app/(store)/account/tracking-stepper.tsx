/**
 * Customer tracking stepper (doc 19 batch OD7, plan §3-S7) — the
 * horizontal order tracker on the /account order cards.
 *
 * Mirrors OD5's ParcelStepper pattern (shipments panel): a linear
 * PIPELINE of happy-path statuses rendered as a stepper, and every
 * other status rendered as an honest OFF-PATH banner — a cancelled or
 * returned order never gets a fake position on the delivery pipeline.
 *
 * All labels/icons/tones come from the ONE OD0 status language
 * (ORDER_STATUS_VISUAL in src/orders/components/labels.ts); nothing is
 * re-declared here beyond the pipeline order itself. Pure
 * presentation: the only prop is the order's status string, exactly
 * as the account payload carries it. No data is fetched or invented —
 * the payload carries no courier name or slot, so none is shown.
 */
import { Icon } from "@/components/ui/icon";
import {
  ORDER_STATUS_VISUAL,
  type StatusTone,
} from "@/orders/components/labels";
import type { OrderStatus } from "@/orders/types";

/** The happy-path delivery pipeline, in order. Every other order
 *  status is off-path (see OFF_PATH handling below). */
export const CUSTOMER_TRACKING_PIPELINE = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
] as const satisfies readonly OrderStatus[];

export type CustomerTrackingState =
  | { kind: "pipeline"; activeIndex: number }
  | { kind: "off-path"; status: OrderStatus }
  | { kind: "unknown" };

const PIPELINE_SET: ReadonlySet<string> = new Set(CUSTOMER_TRACKING_PIPELINE);

/** Pure status → rendering-path mapping (asserted by the OD7 smoke):
 *  the 6 pipeline statuses map to their step index; the other 7 of
 *  the 13 order statuses map to the off-path banner; anything else is
 *  unknown and renders nothing. */
export function customerTrackingState(status: string): CustomerTrackingState {
  if (PIPELINE_SET.has(status)) {
    return {
      kind: "pipeline",
      activeIndex: CUSTOMER_TRACKING_PIPELINE.indexOf(status as (typeof CUSTOMER_TRACKING_PIPELINE)[number]),
    };
  }
  if (status in ORDER_STATUS_VISUAL) {
    return { kind: "off-path", status: status as OrderStatus };
  }
  return { kind: "unknown" };
}

/** Banner classes per OD0 tone — mirrors the tone records in
 *  ui/badge.tsx / OD5's OFF_PATH cls values so the banner reads in the
 *  same colour language as the status badge beside it. */
const TONE_BANNER_CLASS: Record<StatusTone, string> = {
  brand: "border-brand-200 bg-brand-50 text-brand-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  info: "border-sky-200 bg-sky-50 text-sky-700",
  neutral: "border-border bg-surface-2 text-text-muted",
};

export default function CustomerTrackingStepper({ status }: { status: string }) {
  const state = customerTrackingState(status);

  if (state.kind === "unknown") return null;

  if (state.kind === "off-path") {
    const visual = ORDER_STATUS_VISUAL[state.status];
    return (
      <p
        className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${TONE_BANNER_CLASS[visual.tone]}`}
      >
        <Icon name={visual.icon} size={16} />
        {visual.labelBn}
      </p>
    );
  }

  const activeIdx = state.activeIndex;
  const delivered = status === "DELIVERED";
  return (
    <ol
      className="mt-3 flex items-start"
      aria-label={`অর্ডারের অবস্থা: ${ORDER_STATUS_VISUAL[status as OrderStatus].labelBn}`}
    >
      {CUSTOMER_TRACKING_PIPELINE.map((stepStatus, idx) => {
        const visual = ORDER_STATUS_VISUAL[stepStatus];
        const done = idx < activeIdx || delivered;
        const active = idx === activeIdx && !delivered;
        return (
          <li key={stepStatus} className={`flex items-start ${idx > 0 ? "flex-1" : ""}`}>
            {idx > 0 && (
              <span
                aria-hidden="true"
                className={`mx-1 mt-[13px] h-0.5 flex-1 rounded ${idx <= activeIdx ? "bg-emerald-400" : "bg-border"}`}
              />
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
                <Icon name={done ? "check" : visual.icon} size={14} />
              </span>
              <span
                className={`text-caption leading-tight ${
                  done || active ? "font-semibold text-text-main" : "text-text-muted"
                }`}
              >
                {visual.labelBn}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

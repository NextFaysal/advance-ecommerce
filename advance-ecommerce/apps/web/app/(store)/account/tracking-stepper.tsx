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
 * (ORDER_STATUS_VISUAL in src/orders/components/labels.ts), which
 * carries both labelBn and labelEn; doc 30 picks by request locale.
 * Pure presentation: the only prop is the order's status string,
 * exactly as the account payload carries it. No data is fetched or
 * invented — the payload carries no courier name or slot, so none
 * is shown.
 */
import { Icon } from "@/components/ui/icon";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import {
  ORDER_STATUS_VISUAL,
  type StatusTone,
} from "@/orders/components/labels";
import type { OrderStatus } from "@/orders/types";
import { ACCOUNT_STRINGS } from "./strings";

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
 *  same colour language as the status badge beside it. Doc 32 (P6):
 *  values are the tokens-v4 semantic solid/soft pairs (they flip in
 *  Aurora/Circuit dark; raw palette classes did not). */
const TONE_BANNER_CLASS: Record<StatusTone, string> = {
  brand: "border-brand-500/30 bg-brand-soft text-brand-ink",
  success: "border-success-solid/30 bg-success-soft text-success-solid",
  warning: "border-warning-solid/30 bg-warning-soft text-warning-solid",
  danger: "border-danger/30 bg-danger-soft text-danger",
  info: "border-info-solid/30 bg-info-soft text-info-solid",
  neutral: "border-border bg-surface-2 text-text-muted",
};

export default async function CustomerTrackingStepper({ status }: { status: string }) {
  const locale = await getRequestLocale();
  const s = pick(locale, ACCOUNT_STRINGS);
  const labelOf = (st: OrderStatus) =>
    locale === "bn" ? ORDER_STATUS_VISUAL[st].labelBn : ORDER_STATUS_VISUAL[st].labelEn;
  const state = customerTrackingState(status);

  if (state.kind === "unknown") return null;

  if (state.kind === "off-path") {
    const visual = ORDER_STATUS_VISUAL[state.status];
    return (
      <p
        className={`mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${TONE_BANNER_CLASS[visual.tone]}`}
      >
        <Icon name={visual.icon} size={16} />
        {labelOf(state.status)}
      </p>
    );
  }

  const activeIdx = state.activeIndex;
  const delivered = status === "DELIVERED";
  return (
    <ol
      className="mt-3 flex items-start"
      aria-label={interpolate(s.orderStatusAria, {
        label: labelOf(status as OrderStatus),
      })}
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
                className={`mx-1 mt-[13px] h-0.5 flex-1 rounded ${idx <= activeIdx ? "bg-success-solid" : "bg-border"}`}
              />
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
                <Icon name={done ? "check" : visual.icon} size={14} />
              </span>
              <span
                className={`text-caption leading-tight ${
                  done || active ? "font-semibold text-text-main" : "text-text-muted"
                }`}
              >
                {labelOf(stepStatus)}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

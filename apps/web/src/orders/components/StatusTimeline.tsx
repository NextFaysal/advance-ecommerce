// Order status timeline — renders Order.history (the state machine appends
// one entry per accepted transition). Newest last, matching the mock/API
// history order. Pure display: it never invents entries.
//
// OD0 v2 (doc 19 §2.4), ADDITIVE: pass the optional `entries` prop to
// render TYPED entries (status changes interleaved with courier events,
// call outcomes, refunds and notes — each with its own icon + tone from
// TIMELINE_KIND_VISUAL / ORDER_STATUS_VISUAL). When `entries` is absent
// the component renders `history` exactly as v1 did; existing consumers
// (the order detail page) are unaffected until OD2 adopts entries.
import { Card } from "../../components/ui/card";
import { Icon, type IconName } from "../../components/ui/icon";
import {
  ORDER_STATUS_BN,
  ORDER_STATUS_VISUAL,
  STATUS_TONE_DOT_CLASS,
  formatDhakaTime,
  type StatusTone,
} from "./labels";
import type { OrderStatus, OrderStatusHistoryEntry } from "../types";

export type TimelineEntryKind = "status" | "courier" | "call" | "refund" | "note";

export interface TimelineEntry {
  kind: TimelineEntryKind;
  /** Headline, already localised by the caller (data stays honest: the
   *  component formats nothing it wasn't given). */
  title: string;
  detail?: string;
  /** Who/what caused it — agent name, courier, "system". */
  actor?: string;
  /** ISO timestamp; rendered in Asia/Dhaka like the v1 history. */
  at: string;
  /** For kind="status": the status entered — picks the exact status
   *  visual (icon + tone) from ORDER_STATUS_VISUAL. */
  status?: OrderStatus;
}

/** Per-kind visuals for entries that don't carry their own status.
 *  Icons are verified IconNames from ui/icon.tsx. */
export const TIMELINE_KIND_VISUAL: Record<TimelineEntryKind, { icon: IconName; tone: StatusTone }> = {
  status: { icon: "check", tone: "brand" },
  courier: { icon: "truck", tone: "info" },
  call: { icon: "phone", tone: "brand" },
  refund: { icon: "banknote", tone: "warning" },
  note: { icon: "info", tone: "neutral" },
};

/** Chip classes per tone — mirrors the tone record in ui/badge.tsx. */
const TONE_CHIP_CLASS: Record<StatusTone, string> = {
  brand: "bg-brand-100 text-brand-700",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-rose-50 text-rose-700",
  info: "bg-sky-50 text-sky-700",
  neutral: "bg-slate-100 text-slate-600",
};

function TypedTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <ol className="space-y-0">
      {entries.map((e, idx) => {
        const isLast = idx === entries.length - 1;
        const visual =
          e.kind === "status" && e.status
            ? ORDER_STATUS_VISUAL[e.status]
            : TIMELINE_KIND_VISUAL[e.kind];
        return (
          <li key={idx} className="relative flex gap-3 pb-4 last:pb-0">
            {!isLast && (
              <span aria-hidden="true" className="absolute left-[13px] top-7 h-full w-px bg-border" />
            )}
            <span
              aria-hidden="true"
              className={`relative flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full ${TONE_CHIP_CLASS[visual.tone]}`}
            >
              <Icon name={visual.icon} size={14} />
              <span className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-card ${STATUS_TONE_DOT_CLASS[visual.tone]}`} />
            </span>
            <div className="min-w-0 pt-0.5 text-sm">
              <p className="font-medium">
                {e.title}
                {isLast && <span className="text-text-muted"> (সর্বশেষ)</span>}
              </p>
              {e.detail ? <p className="text-text-muted">{e.detail}</p> : null}
              <p className="text-text-muted">
                {e.actor ? `${e.actor} · ` : ""}
                {formatDhakaTime(e.at)} (ঢাকা সময়)
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function StatusTimeline({
  history,
  entries,
}: {
  history: OrderStatusHistoryEntry[];
  entries?: TimelineEntry[];
}) {
  if (entries !== undefined) {
    return (
      <Card>
        <h2 className="mb-4 text-base font-semibold">স্ট্যাটাস টাইমলাইন</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-text-muted">এখনো কোনো কার্যকলাপ হয়নি।</p>
        ) : (
          <TypedTimeline entries={entries} />
        )}
      </Card>
    );
  }
  return (
    <Card>
      <h2 className="mb-4 text-base font-semibold">স্ট্যাটাস টাইমলাইন</h2>
      {history.length === 0 ? (
        <p className="text-sm text-text-muted">এখনো কোনো স্ট্যাটাস পরিবর্তন হয়নি।</p>
      ) : (
        <ol className="space-y-0">
          {history.map((h, idx) => {
            const isLast = idx === history.length - 1;
            return (
              <li key={idx} className="relative flex gap-3 pb-4 last:pb-0">
                {!isLast && (
                  <span aria-hidden="true" className="absolute left-[5px] top-3 h-full w-px bg-border" />
                )}
                <span
                  aria-hidden="true"
                  className={`relative mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full ${
                    isLast ? "bg-brand-600" : "bg-slate-300"
                  }`}
                />
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {h.from ? `${ORDER_STATUS_BN[h.from]} → ` : ""}
                    {ORDER_STATUS_BN[h.to]}
                    {isLast && <span className="text-text-muted"> (বর্তমান)</span>}
                  </p>
                  <p className="text-text-muted">
                    {h.changedBy} · {formatDhakaTime(h.changedAt)} (ঢাকা সময়)
                    {h.reason ? ` · কারণ: ${h.reason}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

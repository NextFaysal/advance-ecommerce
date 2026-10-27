// OD2 (doc 19 §3-S2) — typed timeline entries for the order
// workspace's ইতিহাস tab, built ONLY from the two streams the detail
// payload already carries:
//
//   - order.history → kind "status" entries. The history stream does
//     NOT distinguish who/what drove a transition beyond `changedBy`
//     (a courier-webhook transition and a staff click look identical),
//     so no "courier" / "call" kinds are inferred from it — that
//     would fabricate a kind the data doesn't carry.
//   - order.notes → kind "note" entries (staff notes are a distinct
//     stream with their own author + timestamp).
//
// Refund/courier/call events are NOT in this payload, so they never
// appear here; the panels that own them (RefundsPanel, ShipmentsPanel)
// render their own histories in their tabs. Pure function of the
// payload — no fetch, no invention.
import { ORDER_STATUS_VISUAL } from "../../../../src/orders/components/labels";
import { interpolate, pick, type Locale } from "../../../../src/i18n/locale";
import type { TimelineEntry } from "../../../../src/orders/components/StatusTimeline";
import type { Order } from "../../../../src/orders/types";
import { ORDER_STRINGS } from "../strings";

export function buildWorkspaceTimelineEntries(
  order: Pick<Order, "history" | "notes">,
  locale: Locale,
): TimelineEntry[] {
  const s = pick(locale, ORDER_STRINGS);
  const statusLabel = (status: keyof typeof ORDER_STATUS_VISUAL): string => {
    const visual = ORDER_STATUS_VISUAL[status];
    return locale === "bn" ? visual.labelBn : visual.labelEn;
  };
  const entries: TimelineEntry[] = [];
  for (const h of order.history) {
    entries.push({
      kind: "status",
      status: h.to,
      title: h.from
        ? `${statusLabel(h.from)} → ${statusLabel(h.to)}`
        : statusLabel(h.to),
      detail: h.reason ? interpolate(s.tlReason, { reason: h.reason }) : undefined,
      actor: h.changedBy,
      at: h.changedAt,
    });
  }
  for (const n of order.notes) {
    entries.push({
      kind: "note",
      title: s.tlNote,
      detail: n.text,
      actor: n.author,
      at: n.createdAt,
    });
  }
  // Merge the two streams oldest → newest (the timeline's convention:
  // newest last, flagged "সর্বশেষ"). Stable: equal or unparseable
  // timestamps keep their stream order; an unparseable timestamp is
  // never given an invented position — it sorts to the end.
  return entries
    .map((entry, i) => ({ entry, i, t: Date.parse(entry.at) }))
    .sort((a, b) => {
      const at = Number.isNaN(a.t) ? Number.POSITIVE_INFINITY : a.t;
      const bt = Number.isNaN(b.t) ? Number.POSITIVE_INFINITY : b.t;
      return at - bt || a.i - b.i;
    })
    .map(({ entry }) => entry);
}

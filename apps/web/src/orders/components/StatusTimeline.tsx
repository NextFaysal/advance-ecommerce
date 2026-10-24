// Order status timeline — renders Order.history (the state machine appends
// one entry per accepted transition). Newest last, matching the mock/API
// history order. Pure display: it never invents entries.
import { Card } from "../../components/ui/card";
import { ORDER_STATUS_BN, formatDhakaTime } from "./labels";
import type { OrderStatusHistoryEntry } from "../types";

export function StatusTimeline({ history }: { history: OrderStatusHistoryEntry[] }) {
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

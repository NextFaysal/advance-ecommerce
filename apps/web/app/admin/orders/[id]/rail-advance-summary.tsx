"use client";

// OD2 (doc 19 §3-S2) — rail advance summary for the order workspace.
// A compact mirror of AdvancePanel fed by the SAME read model
// (data.advance on the detail payload); it renders nothing under
// exactly the panel's condition (no advance requirement and no OTP
// gate), and it never collects or re-issues anything — the full
// panel in the পেমেন্ট ও রিফান্ড tab stays the detailed surface.
// Props are serialisable only; the jump callback is an internal
// client-side handler (this component never crosses the RSC split).
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatPoisha } from "@/components/ui/money";
import { formatDhakaTime } from "../../../../src/orders/components/labels";
import type { OrderAdvanceView } from "../../../../src/orders/advance";

export function RailAdvanceSummary({
  advance,
  onShowPayments,
}: {
  advance?: OrderAdvanceView;
  onShowPayments: () => void;
}) {
  if (!advance || (advance.requiredPoisha <= 0 && !advance.requiresOtp)) return null;
  const satisfied = advance.satisfiedAt !== null;
  return (
    <Card className="shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">অগ্রিম পেমেন্ট</h2>
        {advance.requiredPoisha > 0 ? (
          satisfied ? (
            <Badge tone="success">সম্পূর্ণ</Badge>
          ) : (
            <Badge tone="warning">বাকি আছে</Badge>
          )
        ) : null}
      </div>
      <dl className="space-y-2 text-sm">
        {advance.requiredPoisha > 0 ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">প্রয়োজনীয় অগ্রিম</dt>
              <dd className="font-semibold">{formatPoisha(advance.requiredPoisha)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">পরিশোধিত</dt>
              <dd>{formatPoisha(advance.paidPoisha)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">বাকি</dt>
              <dd className={satisfied ? "" : "font-semibold text-amber-600"}>
                {formatPoisha(advance.remainingPoisha)}
              </dd>
            </div>
          </>
        ) : null}
        {advance.requiresOtp ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">OTP যাচাই</dt>
            <dd>
              {advance.otpVerifiedAt ? (
                <Badge tone="success">সম্পন্ন</Badge>
              ) : (
                <Badge tone="warning">বাকি আছে</Badge>
              )}
            </dd>
          </div>
        ) : null}
        {advance.activeLink ? (
          <p className="rounded-md bg-surface-2 px-3 py-2 text-small leading-relaxed">
            সক্রিয় পেমেন্ট লিংক আছে — মেয়াদ শেষ {formatDhakaTime(advance.activeLink.expiresAt)}।
          </p>
        ) : null}
      </dl>
      <Button variant="outline" size="sm" className="mt-4 w-full" onClick={onShowPayments}>
        পেমেন্ট ও রিফান্ড ট্যাবে বিস্তারিত
      </Button>
    </Card>
  );
}

"use client";

/**
 * Advance payment panel — order detail page (doc 17, O3).
 *
 * Renders the `advance` read model the detail GET attaches to the
 * order payload (src/orders/advance.getOrderAdvanceView): how much
 * advance is required and why, how much has been paid against it,
 * whether it is satisfied (which is what unlocks PENDING ->
 * CONFIRMED), the OTP gate state, and the active payment link.
 *
 * HONEST COPY, by design: the panel only REPORTS state — collecting
 * happens through the payment link / payment funnels, and an existing
 * link's URL cannot be re-shown (only its SHA-256 hash is stored, so
 * the plain URL exists exactly once, in the create response; staff
 * issue a fresh link from BD Tools when one is lost).
 *
 * Props are serializable only; the panel renders nothing when the
 * order carries neither an advance requirement nor an OTP gate.
 */
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPoisha } from "@/components/ui/money";
import type { OrderAdvanceView } from "../../../../src/orders/advance";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function AdvancePanel({ advance }: { advance?: OrderAdvanceView }) {
  if (!advance || (advance.requiredPoisha <= 0 && !advance.requiresOtp)) return null;
  const satisfied = advance.satisfiedAt !== null;
  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="text-h3">অগ্রিম পেমেন্ট</h2>
        <p className="mt-0.5 text-small text-text-muted">
          অগ্রিম পরিশোধ সম্পূর্ণ না হলে এই অর্ডার নিশ্চিত (Confirm) করা যাবে না — শুধুমাত্র
          orders.override_advance অনুমতিপ্রাপ্ত কর্মী কারণ লিখে override করতে পারবেন।
        </p>
      </div>

      {advance.requiredPoisha > 0 ? (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-muted">প্রয়োজনীয় অগ্রিম</span>
            <span className="font-semibold">{formatPoisha(advance.requiredPoisha)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-muted">এখন পর্যন্ত পরিশোধিত</span>
            <span>{formatPoisha(advance.paidPoisha)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-muted">বাকি</span>
            <span className={satisfied ? "" : "font-semibold text-amber-600"}>
              {formatPoisha(advance.remainingPoisha)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-muted">অবস্থা</span>
            {satisfied ? (
              <Badge tone="success">পরিশোধ সম্পূর্ণ — {formatWhen(advance.satisfiedAt as string)}</Badge>
            ) : (
              <Badge tone="warning">অগ্রিম বাকি আছে</Badge>
            )}
          </div>
          {advance.reason ? (
            <p className="rounded-md bg-surface-2 px-3 py-2 text-small leading-relaxed">{advance.reason}</p>
          ) : null}
          {advance.activeLink ? (
            <div className="rounded-md bg-surface-2 px-3 py-2 text-small leading-relaxed">
              <p>
                সক্রিয় পেমেন্ট লিংক: {formatPoisha(advance.activeLink.amountPoisha)} — মেয়াদ শেষ{" "}
                {formatWhen(advance.activeLink.expiresAt)}।
              </p>
              <p className="mt-1 text-text-muted">
                লিংকের পুরো URL শুধুমাত্র তৈরির সময় একবার দেখানো হয় (ডাটাবেসে শুধু এর হ্যাশ থাকে) —
                হারিয়ে গেলে BD Tools থেকে নতুন লিংক তৈরি করুন।
              </p>
            </div>
          ) : !satisfied ? (
            <p className="text-small text-text-muted">
              এই অর্ডারের জন্য কোনো সক্রিয় পেমেন্ট লিংক নেই — BD Tools থেকে লিংক তৈরি করে গ্রাহককে পাঠান।
            </p>
          ) : null}
        </div>
      ) : null}

      {advance.requiresOtp ? (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-text-muted">OTP যাচাইকরণ</span>
          {advance.otpVerifiedAt ? (
            <Badge tone="success">যাচাই সম্পন্ন — {formatWhen(advance.otpVerifiedAt)}</Badge>
          ) : (
            <Badge tone="warning">যাচাই বাকি আছে</Badge>
          )}
        </div>
      ) : null}
    </Card>
  );
}

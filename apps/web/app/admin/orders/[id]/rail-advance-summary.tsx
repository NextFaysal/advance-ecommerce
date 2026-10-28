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
import type { OrderAdvanceView } from "../../../../src/orders/advance";
import { pick, intlLocale, type Locale } from "../../../../src/i18n/locale";
import { useLocale } from "../../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "../strings";

function formatWhen(iso: string, locale: Locale): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(intlLocale(locale), { timeZone: "Asia/Dhaka", dateStyle: "medium", timeStyle: "short" });
}

export function RailAdvanceSummary({
  advance,
  onShowPayments,
}: {
  advance?: OrderAdvanceView;
  onShowPayments: () => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  if (!advance || (advance.requiredPoisha <= 0 && !advance.requiresOtp)) return null;
  const satisfied = advance.satisfiedAt !== null;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{s.advTitle}</h2>
        {advance.requiredPoisha > 0 ? (
          satisfied ? (
            <Badge tone="success">{s.railComplete}</Badge>
          ) : (
            <Badge tone="warning">{s.railDue}</Badge>
          )
        ) : null}
      </div>
      <dl className="space-y-2 text-sm">
        {advance.requiredPoisha > 0 ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">{s.advRequired}</dt>
              <dd className="font-semibold">{formatPoisha(advance.requiredPoisha)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">{s.railPaid}</dt>
              <dd>{formatPoisha(advance.paidPoisha)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">{s.advRemaining}</dt>
              <dd className={satisfied ? "" : "font-semibold text-amber-600"}>
                {formatPoisha(advance.remainingPoisha)}
              </dd>
            </div>
          </>
        ) : null}
        {advance.requiresOtp ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-text-muted">{s.railOtp}</dt>
            <dd>
              {advance.otpVerifiedAt ? (
                <Badge tone="success">{s.railDone}</Badge>
              ) : (
                <Badge tone="warning">{s.railDue}</Badge>
              )}
            </dd>
          </div>
        ) : null}
        {advance.activeLink ? (
          <p className="rounded-md bg-surface-2 px-3 py-2 text-small leading-relaxed">
            {s.railActiveLink} {formatWhen(advance.activeLink.expiresAt, locale)}.
          </p>
        ) : null}
      </dl>
      <Button variant="outline" size="sm" className="mt-4 w-full" onClick={onShowPayments}>
        {s.railPaymentsDetail}
      </Button>
    </Card>
  );
}

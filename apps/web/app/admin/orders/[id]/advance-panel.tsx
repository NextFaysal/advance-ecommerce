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
import { pick, intlLocale } from "../../../../src/i18n/locale";
import { useLocale } from "../../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "../strings";

function formatWhen(iso: string, locale: "bn" | "en"): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(intlLocale(locale));
}

export function AdvancePanel({ advance }: { advance?: OrderAdvanceView }) {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  if (!advance || (advance.requiredPoisha <= 0 && !advance.requiresOtp)) return null;
  const satisfied = advance.satisfiedAt !== null;
  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="text-h3">{s.advTitle}</h2>
        <p className="mt-0.5 text-small text-text-muted">
          {s.advIntro}
        </p>
      </div>

      {advance.requiredPoisha > 0 ? (
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-muted">{s.advRequired}</span>
            <span className="font-semibold">{formatPoisha(advance.requiredPoisha)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-muted">{s.advPaidSoFar}</span>
            <span>{formatPoisha(advance.paidPoisha)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-muted">{s.advRemaining}</span>
            <span className={satisfied ? "" : "font-semibold text-amber-600"}>
              {formatPoisha(advance.remainingPoisha)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-text-muted">{s.status}</span>
            {satisfied ? (
              <Badge tone="success">{s.advPaidComplete} — {formatWhen(advance.satisfiedAt as string, locale)}</Badge>
            ) : (
              <Badge tone="warning">{s.advDue}</Badge>
            )}
          </div>
          {advance.reason ? (
            <p className="rounded-md bg-surface-2 px-3 py-2 text-small leading-relaxed">{advance.reason}</p>
          ) : null}
          {advance.activeLink ? (
            <div className="rounded-md bg-surface-2 px-3 py-2 text-small leading-relaxed">
              <p>
                {s.advActiveLink}: {formatPoisha(advance.activeLink.amountPoisha)} — {s.advExpires}{" "}
                {formatWhen(advance.activeLink.expiresAt, locale)}
              </p>
              <p className="mt-1 text-text-muted">
                {s.advLinkOnce}
              </p>
            </div>
          ) : !satisfied ? (
            <p className="text-small text-text-muted">
              {s.advNoLink}
            </p>
          ) : null}
        </div>
      ) : null}

      {advance.requiresOtp ? (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-text-muted">{s.advOtp}</span>
          {advance.otpVerifiedAt ? (
            <Badge tone="success">{s.advOtpDone} — {formatWhen(advance.otpVerifiedAt, locale)}</Badge>
          ) : (
            <Badge tone="warning">{s.advOtpPending}</Badge>
          )}
        </div>
      ) : null}
    </Card>
  );
}

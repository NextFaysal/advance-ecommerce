"use client";

/**
 * Funnel offer panel — doc 34 §3.7 (wave L8). The one-click action
 * layer of an upsell/downsell step, rendered by the step page above
 * the step's own LandingView content.
 *
 * The panel is deliberately dumb about money: every price it shows
 * was resolved server-side from the live catalog + the step's
 * stored discount rule, and the accept call sends NO price — only
 * the funnel token, the step claim, and the phone the customer
 * types (the §3.7 ownership re-proof; the order's real phone is
 * never rendered into the page). The server re-resolves and
 * re-checks everything at accept time.
 *
 * Accept → POST /api/v1/public/orders/<orderNo>/amend → success
 * shows the added state (with the separate-order note when the
 * server took the held-order fallback) and continues to the step's
 * accept target; decline is a plain link to the decline target.
 * Both targets carry the funnel token — routing is data (§3.7).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatBdt } from "@advance-ecommerce/validators";
import { StoreImage } from "@/storefront-ux/components/StoreImage";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { LANDING_STRINGS } from "@/landing/strings";

export interface FunnelOfferPanelData {
  title: { bn: string; en: string };
  productSlug: string;
  imageUrl: string | null;
  /** Human variant line (attribute values), empty for a plain variant. */
  attributesLine: string;
  livePricePoisha: number;
  discountPoisha: number;
  finalPricePoisha: number;
  stock: number;
}

interface Props {
  locale: Locale;
  orderNo: string;
  stepId: string;
  token: string;
  /** Millisecond epoch when the offer window closes (server-computed). */
  endsAtMs: number;
  acceptHref: string;
  declineHref: string;
  offer: FunnelOfferPanelData;
}

type Phase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "accepted"; separateOrderNo: string | null }
  | { kind: "failed"; message: string }
  | { kind: "expired" };

function useRemainingMs(endsAtMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return Math.max(0, endsAtMs - now);
}

export function FunnelOfferPanel({ locale, orderNo, stepId, token, endsAtMs, acceptHref, declineHref, offer }: Props) {
  const s = pick(locale, LANDING_STRINGS);
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const remainingMs = useRemainingMs(endsAtMs);
  const expired = remainingMs <= 0;
  const effectivePhase: Phase = phase.kind === "idle" && expired ? { kind: "expired" } : phase;

  const mm = Math.floor(remainingMs / 60000);
  const ss = Math.floor((remainingMs % 60000) / 1000);
  const title = locale === "en" ? offer.title.en || offer.title.bn : offer.title.bn;
  const outOfStock = offer.stock < 1;

  useEffect(() => {
    if (phase.kind !== "accepted") return;
    const t = window.setTimeout(() => router.push(acceptHref), 1800);
    return () => window.clearTimeout(t);
  }, [phase, acceptHref, router]);

  async function accept() {
    if (effectivePhase.kind !== "idle" || outOfStock) return;
    setPhase({ kind: "submitting" });
    try {
      const res = await fetch(`/api/v1/public/orders/${encodeURIComponent(orderNo)}/amend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, phone: phone.trim(), stepClaim: { stepId } }),
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { path?: string; fallbackOrderNo?: string | null }; error?: { code?: string; message?: string } }
        | null;
      if (res.ok && body?.data) {
        setPhase({
          kind: "accepted",
          separateOrderNo: body.data.path === "fallback_order" ? (body.data.fallbackOrderNo ?? null) : null,
        });
        return;
      }
      if (body?.error?.code === "FUNNEL_TOKEN_EXPIRED" || body?.error?.code === "OFFER_WINDOW_EXPIRED") {
        setPhase({ kind: "expired" });
        return;
      }
      setPhase({ kind: "failed", message: body?.error?.message ?? s.funnelAcceptFailed });
    } catch {
      setPhase({ kind: "failed", message: s.errorNetwork });
    }
  }

  return (
    <section className="mx-auto max-w-3xl px-4 pt-6">
      <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
        <p className="text-center font-display text-lg font-bold text-text-main">{s.funnelOfferHeading}</p>

        <div className="mt-4 flex items-center gap-4">
          {offer.imageUrl ? (
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-surface-2">
              <StoreImage src={offer.imageUrl} alt={title} preset="thumb" fillParent />
            </div>
          ) : null}
          <div className="min-w-0">
            <p className="font-semibold leading-snug text-text-main">{title}</p>
            {offer.attributesLine ? <p className="mt-0.5 text-sm text-text-muted">{offer.attributesLine}</p> : null}
            <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
              <span className="text-2xl font-bold text-brand-600">{formatBdt(offer.finalPricePoisha)}</span>
              {offer.discountPoisha > 0 ? (
                <>
                  <span className="text-sm tabular-nums text-text-subtle line-through">{formatBdt(offer.livePricePoisha)}</span>
                  <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-bold text-success-solid">
                    {interpolate(s.funnelYouSave, { amount: formatBdt(offer.discountPoisha) })}
                  </span>
                </>
              ) : null}
            </p>
            <a href={`/product/${offer.productSlug}`} className="text-sm text-brand-600 underline">
              {s.viewDetailsShort}
            </a>
          </div>
        </div>

        {effectivePhase.kind === "accepted" ? (
          <div className="mt-5 rounded-2xl bg-success-soft p-4 text-center">
            <p className="font-bold text-success-solid">✓ {s.funnelAddedTitle}</p>
            {effectivePhase.separateOrderNo ? (
              <p className="mt-1 text-sm text-text-main">
                {interpolate(s.funnelSeparateOrderNote, { orderNo: effectivePhase.separateOrderNo })}
              </p>
            ) : null}
            <a
              href={acceptHref}
              className="brand-gradient mt-3 inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 font-bold text-white"
            >
              {s.funnelContinue}
            </a>
          </div>
        ) : effectivePhase.kind === "expired" ? (
          <p className="mt-5 rounded-2xl bg-warning-soft p-4 text-center text-sm font-medium text-warning-solid">
            {s.funnelOfferExpired}
          </p>
        ) : (
          <>
            <p className="mt-5 text-center text-sm text-text-muted" aria-live="polite">
              {s.funnelOfferEndsIn}:{" "}
              <span className="font-bold tabular-nums text-text-main">
                {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
              </span>
            </p>
            <label className="mt-4 block">
              <span className="text-sm font-medium text-text-main">{s.phoneLabel}</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="01XXXXXXXXX"
                className="mt-1 h-12 w-full rounded-xl border border-border bg-bg-app px-3 text-text-main outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              />
            </label>
            {effectivePhase.kind === "failed" ? (
              <p className="mt-3 rounded-xl bg-danger-soft p-3 text-sm font-medium text-danger" role="alert">
                {effectivePhase.message}
              </p>
            ) : null}
            {outOfStock ? (
              <p className="mt-3 rounded-xl bg-danger-soft p-3 text-sm font-medium text-danger" role="alert">
                {s.outOfStock}
              </p>
            ) : null}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={accept}
                disabled={effectivePhase.kind === "submitting" || outOfStock || phone.trim().length < 6}
                className="brand-gradient min-h-[48px] flex-1 rounded-xl px-5 font-bold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {effectivePhase.kind === "submitting" ? s.funnelAdding : `${s.funnelAccept} — ${formatBdt(offer.finalPricePoisha)}`}
              </button>
              <a
                href={declineHref}
                className="inline-flex min-h-[48px] flex-1 items-center justify-center rounded-xl border border-border bg-surface-2 px-5 font-semibold text-text-main transition hover:border-brand-500"
              >
                {s.funnelDecline}
              </a>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

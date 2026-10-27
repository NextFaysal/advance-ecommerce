import { formatBdt } from "@advance-ecommerce/validators";
import { getCustomerMembershipState } from "@/marketing/membership-tiers";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { ACCOUNT_STRINGS } from "./strings";

/**
 * Membership tier card (ADV-18A) — server component on the account
 * page, rendered only when module.marketing_mechanics is on (the
 * page checks the flag). Every figure is the REAL derived state:
 * the tier comes from lifetime DELIVERED spend (src/marketing/
 * membership-tiers.getCustomerMembershipState), the progress bar is
 * the exact fraction of the gap to the next tier, and the benefits
 * listed are the tier's configured discount bps / free shipping —
 * the same values the checkout route applies. Tier names are
 * merchant-configured {labelBn, labelEn} pairs, picked by locale.
 */
export default async function MembershipTierCard({ customerId }: { customerId: string }) {
  const locale = await getRequestLocale();
  const s = pick(locale, ACCOUNT_STRINGS);
  const state = await getCustomerMembershipState(customerId);
  const { tier, nextTier } = state;
  const progressPct = Math.round(state.progressBps / 100);
  const tierLabel = locale === "bn" ? tier.labelBn : tier.labelEn;
  const nextTierLabel = nextTier ? (locale === "bn" ? nextTier.labelBn : nextTier.labelEn) : "";
  return (
    <section
      className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card"
      aria-label={s.membershipTier}
    >
      <h2 className="text-base font-bold text-text-main">{s.membershipTier}</h2>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-lg font-bold text-brand-700">{tierLabel}</span>
        <span className="text-sm text-text-muted">
          {interpolate(s.lifetimeSpend, { amount: formatBdt(state.lifetimeSpendPoisha) })}
        </span>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm text-text-main">
        {tier.discountBps > 0 ? (
          <li>✓ {interpolate(s.tierDiscount, { pct: (tier.discountBps / 100).toFixed(tier.discountBps % 100 === 0 ? 0 : 2) })}</li>
        ) : null}
        {tier.freeShipping ? <li>✓ {s.tierFreeShipping}</li> : null}
        {tier.discountBps === 0 && !tier.freeShipping ? (
          <li className="text-text-muted">{s.tierNoBenefits}</li>
        ) : null}
      </ul>
      {nextTier ? (
        <div className="mt-4">
          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={interpolate(s.tierProgressAria, { tier: nextTierLabel })}
          >
            <div className="brand-gradient h-full rounded-full" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            {interpolate(s.tierRemaining, {
              tier: nextTierLabel,
              amount: formatBdt(state.toNextTierPoisha),
            })}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm leading-6 text-text-muted">{s.tierTop}</p>
      )}
    </section>
  );
}

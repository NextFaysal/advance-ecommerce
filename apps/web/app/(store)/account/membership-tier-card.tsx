import { formatBdt } from "@advance-ecommerce/validators";
import { getCustomerMembershipState } from "@/marketing/membership-tiers";

/**
 * Membership tier card (ADV-18A) — server component on the account
 * page, rendered only when module.marketing_mechanics is on (the
 * page checks the flag). Every figure is the REAL derived state:
 * the tier comes from lifetime DELIVERED spend (src/marketing/
 * membership-tiers.getCustomerMembershipState), the progress bar is
 * the exact fraction of the gap to the next tier, and the benefits
 * listed are the tier's configured discount bps / free shipping —
 * the same values the checkout route applies.
 */
export default async function MembershipTierCard({ customerId }: { customerId: string }) {
  const state = await getCustomerMembershipState(customerId);
  const { tier, nextTier } = state;
  const progressPct = Math.round(state.progressBps / 100);
  return (
    <section
      className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card"
      aria-label="মেম্বারশিপ টিয়ার"
    >
      <h2 className="text-base font-bold text-text-main">মেম্বারশিপ টিয়ার</h2>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-lg font-bold text-brand-700">{tier.labelBn}</span>
        <span className="text-sm text-text-muted">
          মোট কেনাকাটা (ডেলিভারি সম্পন্ন): {formatBdt(state.lifetimeSpendPoisha)}
        </span>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm text-text-main">
        {tier.discountBps > 0 ? (
          <li>✓ প্রতিটি অর্ডারে পণ্যের মূল্যে {(tier.discountBps / 100).toFixed(tier.discountBps % 100 === 0 ? 0 : 2)}% ছাড়</li>
        ) : null}
        {tier.freeShipping ? <li>✓ সব অর্ডারে ডেলিভারি চার্জ ফ্রি</li> : null}
        {tier.discountBps === 0 && !tier.freeShipping ? (
          <li className="text-text-muted">এই টিয়ারে এখনো কোনো বিশেষ সুবিধা নেই — কেনাকাটা বাড়লে পরের টিয়ারে ছাড় ও ফ্রি ডেলিভারি মিলবে।</li>
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
            aria-label={`${nextTier.labelBn} টিয়ারের অগ্রগতি`}
          >
            <div className="brand-gradient h-full rounded-full" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            <span className="font-semibold text-text-main">{nextTier.labelBn}</span> টিয়ারে পৌঁছাতে আরও{" "}
            {formatBdt(state.toNextTierPoisha)} কেনাকাটা বাকি।
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm leading-6 text-text-muted">আপনি সর্বোচ্চ টিয়ারে আছেন — ধন্যবাদ!</p>
      )}
    </section>
  );
}

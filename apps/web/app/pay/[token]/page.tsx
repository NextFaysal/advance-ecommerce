/**
 * /pay/[token] — public payment link page. Agent 19 (E1 follow-up).
 *
 * Server component: resolves the link server-side by token-hash lookup
 * (resolvePayLink). The token/hash never render into the page. States:
 * active (amount + sandbox pay form), paid, expired, cancelled, not found.
 * Bangla-first, mobile-first. noindex — a payment link is not a search page.
 *
 * Data is the DB-backed payment_links store (DB swap 2026-10-24); the
 * store behind resolvePayLink changed, this page only gained awaits.
 *
 * OD7 (doc 19 §3-S7) trust redesign — presentation only: brand block
 * (store name from the SAME public settings source the print centre
 * and storefront read — getPublicSettings()["general.store_name"];
 * the key's default is EMPTY, so the name renders only when the owner
 * has actually set it, never a fabricated one), amount-due hero, and
 * an order summary in the MoneyBreakdown visual language. The public
 * pay-link view carries exactly one figure (the amount this link
 * collects) — no items or money split exist in it by design, so none
 * are shown. Token flow, expiry and every state keep their prior
 * logic and copy.
 */
import type { Metadata } from "next";
import { ensureDemoPaymentLink, resolvePayLink } from "@/storefront-ux/pay-link-view";
import { getPublicSettings } from "@/lib/settings";
import { DigitText } from "@/components/ui/numerals";
import { Badge } from "@/components/ui/badge";
import { Icon, type IconName } from "@/components/ui/icon";
import type { PaymentLinkStatus } from "@/bd/payment-link";
import PayForm from "./PayForm";

export const metadata: Metadata = {
  title: "পেমেন্ট — Advance Ecommerce",
  robots: { index: false, follow: false },
};

const STATUS_BADGE: Record<PaymentLinkStatus, { tone: "success" | "warning" | "neutral"; icon: IconName }> = {
  active: { tone: "warning", icon: "clock" },
  paid: { tone: "success", icon: "check" },
  expired: { tone: "warning", icon: "clock" },
  cancelled: { tone: "neutral", icon: "x" },
};

export default async function PayPage({ params }: { params: { token: string } }) {
  await ensureDemoPaymentLink();
  const resolved = await resolvePayLink(params.token);
  const publicSettings = await getPublicSettings();
  const storeName = (publicSettings["general.store_name"] ?? "").trim();

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-4 py-8">
      {/* Brand block — the trust anchor for an SMS-landed page. The
          store tile always renders; the name only when configured. */}
      <header className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white"
        >
          <Icon name="store" size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold leading-tight text-text-main">
            {storeName || "পেমেন্ট"}
          </h1>
          <p className="flex items-center gap-1 text-xs text-text-muted">
            <Icon name="shield" size={12} />
            {storeName ? "নিরাপদ পেমেন্ট লিংক" : "অনলাইন পেমেন্ট"}
          </p>
        </div>
      </header>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-text-muted">
        <Icon name="info" size={13} />
        Sandbox payment only — no real money moves.
      </p>

      {!resolved.ok && (
        <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5">
          <p className="flex items-center gap-2 font-semibold text-rose-700">
            <Icon name="alert" size={17} />
            পেমেন্ট লিংক পাওয়া যায়নি
          </p>
          <p className="mt-1 text-sm leading-6 text-rose-600">লিংকটি ভুল বা মুছে ফেলা হয়েছে। দোকানে যোগাযোগ করুন।</p>
        </div>
      )}

      {resolved.ok && (
        <section className="mt-6 rounded-2xl border border-border bg-card px-4 py-5 shadow-card sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-text-main">{resolved.view.purposeLabelBn}</p>
            <Badge
              tone={STATUS_BADGE[resolved.view.status].tone}
              icon={<Icon name={STATUS_BADGE[resolved.view.status].icon} size={12} />}
            >
              {resolved.view.statusLabelBn}
            </Badge>
          </div>

          {/* Amount hero — the one figure this link collects. The
              caption follows the link's state: "payable now" is only
              claimed while the link is actually active. */}
          <p className="mt-3 text-caption font-medium uppercase tracking-wide text-text-muted">
            {resolved.view.status === "active"
              ? "এখন পরিশোধযোগ্য"
              : resolved.view.status === "paid"
                ? "পরিশোধিত পরিমাণ"
                : "লিংকের পরিমাণ"}
          </p>
          <p className="mt-0.5 text-4xl font-bold text-brand-700">
            <DigitText text={resolved.view.amountFormatted} />
          </p>

          <dl className="mt-4 space-y-1.5 border-t border-border pt-3 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-text-muted">অর্ডার</dt>
              <dd className="font-medium tabular-nums">{resolved.view.orderId}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-text-muted">অবস্থা</dt>
              <dd className="font-medium">{resolved.view.statusLabelBn}</dd>
            </div>
            {resolved.view.status === "active" && (
              <div className="flex items-baseline justify-between">
                <dt className="text-text-muted">মেয়াদ শেষ</dt>
                <dd className="font-medium">
                  {new Date(resolved.view.expiresAt).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })}
                </dd>
              </div>
            )}
          </dl>

          {resolved.view.status === "active" && <PayForm token={params.token} />}

          {resolved.view.status === "paid" && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm leading-6 text-emerald-700">
              <Icon name="check" size={16} className="mt-1 shrink-0" />
              <span>
                এই লিংকের পেমেন্ট সম্পন্ন হয়েছে। ধন্যবাদ!
                {resolved.view.paidAt
                  ? ` (${new Date(resolved.view.paidAt).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })})`
                  : ""}
              </span>
            </p>
          )}
          {resolved.view.status === "expired" && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm leading-6 text-amber-800">
              <Icon name="clock" size={16} className="mt-1 shrink-0" />
              <span>এই লিংকের মেয়াদ শেষ হয়ে গেছে। নতুন লিংকের জন্য দোকানে যোগাযোগ করুন।</span>
            </p>
          )}
          {resolved.view.status === "cancelled" && (
            <p className="mt-4 flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2.5 text-sm leading-6 text-text-muted">
              <Icon name="x" size={16} className="mt-1 shrink-0" />
              <span>এই লিংক বাতিল করা হয়েছে। সাহায্যের জন্য দোকানে যোগাযোগ করুন।</span>
            </p>
          )}
        </section>
      )}
    </main>
  );
}

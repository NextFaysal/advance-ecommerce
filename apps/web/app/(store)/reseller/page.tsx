/**
 * /reseller — reseller self-service portal (ADV-12).
 *
 * Gate: module.reseller_portal (seeded OFF) + the reseller_session
 * cookie (phone + code login at /reseller/login). All data comes from
 * buildPortalDashboard (src/reseller/portal.ts): the reseller's own
 * code + referral link, tier derived from lifetime earned commission
 * with progress to the next tier, attributed orders (customer phone
 * MASKED), the commission ledger, payout balances (computed:
 * wallet − PAID − held requests) and the payout request form.
 * PAID on a payout means staff recorded an external payment — the
 * copy here says exactly that.
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { formatBdt } from "@/checkout/pricing";
import { isResellerPortalEnabled } from "@/reseller/flags";
import { buildPortalDashboard } from "@/reseller/portal";
import { RESELLER_SESSION_COOKIE, verifyResellerSessionToken } from "@/reseller/portal-auth";
import PayoutRequestForm from "./payout-form";
import ResellerLogoutButton from "./logout-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "রিসেলার পোর্টাল — Advance Ecommerce",
  robots: { index: false, follow: false },
};

const PAYOUT_STATUS_BN: Record<string, string> = {
  PENDING: "অপেক্ষমাণ",
  APPROVED: "অনুমোদিত",
  PAID: "পরিশোধিত (স্টোর বাইরে থেকে পাঠিয়েছে)",
  REJECTED: "প্রত্যাখ্যাত",
};

const COMMISSION_STATUS_BN: Record<string, string> = {
  CREDITED: "কমিশন জমা হয়েছে",
  AWAITING_DELIVERY: "ডেলিভারির অপেক্ষায়",
  NOT_CREDITED: "কমিশন জমা হয়নি",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
      <h2 className="font-display text-lg font-bold text-text-main">{title}</h2>
      {children}
    </section>
  );
}

export default async function ResellerPortalPage() {
  if (!isResellerPortalEnabled()) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-card">
          <h1 className="font-display text-xl font-bold text-text-main">রিসেলার পোর্টাল</h1>
          <p role="status" className="mt-3 text-sm leading-7 text-text-muted">
            🔒 এই মডিউলটি এই স্টোরে বন্ধ আছে। রিসেলার পোর্টাল চালু করতে স্টোর কর্তৃপক্ষকে বলুন।
          </p>
        </div>
      </main>
    );
  }
  const store = await cookies();
  const resellerId = await verifyResellerSessionToken(store.get(RESELLER_SESSION_COOKIE)?.value);
  if (!resellerId) redirect("/reseller/login");
  const d = await buildPortalDashboard(resellerId);
  if (!d) redirect("/reseller/login");

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-main">স্বাগতম, {d.name}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {d.phoneMasked} · টিয়ার: <strong className="text-text-main">{d.tier}</strong> · কমিশন হার:{" "}
            {(d.commissionBps / 100).toFixed(2).replace(/\.?0+$/, "")}%
            {d.nextTier
              ? ` · ${d.nextTier} হতে আর ${formatBdt(d.toNextTierPoisha)} কমিশন দরকার`
              : " · সর্বোচ্চ টিয়ার"}
          </p>
        </div>
        <ResellerLogoutButton />
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="আপনার রেফারেল লিংক">
          {d.code ? (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-text-muted">
                কোড: <code className="font-semibold text-text-main">{d.code}</code>
              </p>
              <p className="break-all rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-700">
                <code>{d.referralLink}</code>
              </p>
              <p className="text-xs leading-6 text-text-muted">
                এই লিংক দিয়ে কেউ অর্ডার করলে (৩০ দিনের মধ্যে) অর্ডারটি আপনার নামে যুক্ত হয় এবং ডেলিভারি
                হলেই কমিশন আপনার ওয়ালেটে জমা হয়।
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-text-muted">আপনার অ্যাকাউন্টে এখনো কোনো রেফারেল কোড যুক্ত হয়নি।</p>
          )}
        </Card>

        <Card title="কমিশন ও ব্যালেন্স">
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-text-muted">মোট কমিশন (সর্বকাল)</dt>
              <dd className="mt-0.5 font-semibold text-text-main">{formatBdt(d.lifetimeCommissionPoisha)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">এই মাসের কমিশন</dt>
              <dd className="mt-0.5 font-semibold text-text-main">{formatBdt(d.monthlyCommissionPoisha)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">ওয়ালেট ব্যালেন্স</dt>
              <dd className="mt-0.5 font-semibold text-text-main">{formatBdt(d.balances.walletBalancePoisha)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">উত্তোলনযোগ্য</dt>
              <dd className="mt-0.5 font-semibold text-text-main">{formatBdt(d.balances.availablePoisha)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">পরিশোধিত (রেকর্ডকৃত)</dt>
              <dd className="mt-0.5 font-semibold text-text-main">{formatBdt(d.balances.paidOutPoisha)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">অনুরোধে আটকে আছে</dt>
              <dd className="mt-0.5 font-semibold text-text-main">{formatBdt(d.balances.heldPoisha)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card title="পে-আউট অনুরোধ">
        <PayoutRequestForm availablePoisha={d.balances.availablePoisha} />
        {d.payoutRequests.length > 0 ? (
          <ul className="mt-5 space-y-2">
            {d.payoutRequests.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm"
              >
                <span className="text-text-main">
                  {formatBdt(r.amountPoisha)} · {r.method} · {new Date(r.createdAt).toLocaleDateString("bn-BD")}
                </span>
                <span className="text-text-muted">{PAYOUT_STATUS_BN[r.status] ?? r.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-text-muted">এখনো কোনো পে-আউট অনুরোধ করেননি।</p>
        )}
      </Card>

      <Card title="আপনার অর্ডারসমূহ">
        {d.orders.length > 0 ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-text-muted">
                  <th className="py-2 pr-3 font-medium">অর্ডার</th>
                  <th className="py-2 pr-3 font-medium">গ্রাহক</th>
                  <th className="py-2 pr-3 font-medium">পরিমাণ</th>
                  <th className="py-2 pr-3 font-medium">স্ট্যাটাস</th>
                  <th className="py-2 font-medium">কমিশন</th>
                </tr>
              </thead>
              <tbody>
                {d.orders.map((o) => (
                  <tr key={o.orderId} className="border-t border-border">
                    <td className="py-2 pr-3 text-text-main">{o.orderNo}</td>
                    <td className="py-2 pr-3 text-text-main">
                      {o.customerName} <span className="text-text-muted">({o.customerPhoneMasked})</span>
                    </td>
                    <td className="py-2 pr-3 text-text-main">{formatBdt(o.totalPoisha)}</td>
                    <td className="py-2 pr-3 text-text-muted">{o.status}</td>
                    <td className="py-2 text-text-main">
                      {o.creditedPoisha > 0 ? formatBdt(o.creditedPoisha) : "—"}{" "}
                      <span className="text-text-muted">
                        ({COMMISSION_STATUS_BN[o.commissionStatus] ?? o.commissionStatus})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-text-muted">এখনো আপনার লিংক দিয়ে কোনো অর্ডার হয়নি।</p>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="কমিশন লেজার">
          {d.ledger.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {d.ledger.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-text-muted">
                    {new Date(e.createdAt).toLocaleDateString("bn-BD")} · {e.type}
                  </span>
                  <span className={e.amountPoisha >= 0 ? "font-medium text-green-700" : "font-medium text-red-700"}>
                    {e.amountPoisha >= 0 ? "+" : "−"}
                    {formatBdt(Math.abs(e.amountPoisha))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text-muted">এখনো কোনো লেজার এন্ট্রি নেই।</p>
          )}
        </Card>

        <Card title="আপনার বিক্রয়মূল্য">
          {d.priceEntries.length > 0 ? (
            <ul className="mt-4 space-y-2 text-sm">
              {d.priceEntries.map((e) => (
                <li key={e.variantId} className="flex items-center justify-between gap-2">
                  <span className="text-text-main">
                    {e.productName} <span className="text-text-muted">({e.sku})</span>
                  </span>
                  <span className="text-text-muted">
                    বেস {formatBdt(e.basePricePoisha)} → আপনার {formatBdt(e.resellerPricePoisha)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text-muted">এখনো কোনো পণ্যে আপনার আলাদা বিক্রয়মূল্য সেট করা হয়নি।</p>
          )}
        </Card>
      </div>
    </main>
  );
}

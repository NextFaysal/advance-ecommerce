/**
 * /vendor — vendor self-service portal (ADV-13).
 *
 * Gate: module.vendor_portal (seeded OFF) + the vendor_session
 * cookie (phone + SMS one-time code login at /vendor/login). All
 * data comes from buildVendorPortalDashboard (src/vendors/portal.ts):
 * shop info + account status, KYC state (staff note shown verbatim),
 * own products with stock AS RECORDED on the linked variant, orders
 * containing their products (customer phone MASKED), the commission
 * ledger and the payout summary.
 *
 * Payout (schema wave 2): VendorPayoutRequest records now exist.
 * The card shows the net payable, what PAID requests have settled
 * (staff-recorded external payments), what PENDING/APPROVED
 * requests hold, and the available remainder the request form can
 * draw on. PAID never means the system sent money.
 *
 * Documents (schema wave 2): staff-recorded VendorDocument rows are
 * listed on the KYC card. Self-upload stays DISABLED with the
 * reason from getVendorDocumentStatus (storage unconfigured and/or
 * no upload endpoint yet) — no upload is attempted.
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { formatBdt } from "@/checkout/pricing";
import { canVendorSubmitKyc, vendorKycStatusLabel } from "@/vendors/kyc";
import { vendorDocumentKindLabel, vendorDocumentStatusLabel } from "@/vendors/documents";
import { getRequestLocale } from "@/i18n/server";
import { isVendorPortalEnabled, VENDOR_SESSION_COOKIE, verifyVendorSessionToken } from "@/vendors/portal-auth";
import { buildVendorPortalDashboard } from "@/vendors/portal";
import KycSubmitButton from "./kyc-submit-button";
import VendorLogoutButton from "./logout-button";
import VendorProductForm from "./product-form";
import VendorPayoutRequestForm from "./payout-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ভেন্ডর পোর্টাল — Advance Ecommerce",
  robots: { index: false, follow: false },
};

const ACCOUNT_STATUS_BN: Record<string, string> = {
  ACTIVE: "সক্রিয়",
  PENDING: "অনুমোদনের অপেক্ষায়",
  SUSPENDED: "স্থগিত",
  REJECTED: "প্রত্যাখ্যাত",
};

const APPROVAL_BN: Record<string, string> = {
  PENDING_REVIEW: "রিভিউয়ের অপেক্ষায়",
  APPROVED: "অনুমোদিত",
  REJECTED: "প্রত্যাখ্যাত",
  CHANGES_REQUESTED: "পরিবর্তন চাওয়া হয়েছে",
};

const COMMISSION_STATUS_BN: Record<string, string> = {
  CREDITED: "আয় জমা হয়েছে",
  AWAITING_DELIVERY: "ডেলিভারির অপেক্ষায়",
  NOT_CREDITED: "আয় জমা হয়নি",
};

const PAYOUT_STATUS_BN: Record<string, string> = {
  PENDING: "অপেক্ষমাণ",
  APPROVED: "অনুমোদিত",
  PAID: "পরিশোধিত (স্টাফ বাইরে পেমেন্ট রেকর্ড করেছেন)",
  REJECTED: "প্রত্যাখ্যাত",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-card">
      <h2 className="font-display text-lg font-bold text-text-main">{title}</h2>
      {children}
    </section>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("bn-BD", { timeZone: "Asia/Dhaka" });
}

const thClass = "px-3 py-2 text-left font-medium text-text-muted";
const tdClass = "px-3 py-2 text-text-main";

export default async function VendorPortalPage() {
  if (!isVendorPortalEnabled()) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-card">
          <h1 className="font-display text-xl font-bold text-text-main">ভেন্ডর পোর্টাল</h1>
          <p role="status" className="mt-3 text-sm leading-7 text-text-muted">
            🔒 এই মডিউলটি এই স্টোরে বন্ধ আছে। ভেন্ডর পোর্টাল চালু করতে স্টোর কর্তৃপক্ষকে বলুন।
          </p>
        </div>
      </main>
    );
  }
  const locale = await getRequestLocale();
  const store = await cookies();
  const vendorId = await verifyVendorSessionToken(store.get(VENDOR_SESSION_COOKIE)?.value);
  if (!vendorId) redirect("/vendor/login");
  const d = await buildVendorPortalDashboard(vendorId);
  if (!d) redirect("/vendor/login");

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-main">{d.shopName}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {d.ownerName ? `${d.ownerName} · ` : ""}
            {d.phoneMasked} · অবস্থা:{" "}
            <strong className="text-text-main">{ACCOUNT_STATUS_BN[d.status] ?? d.status}</strong> ·
            কমিশন হার: {(d.commissionBps / 100).toFixed(2).replace(/\.?0+$/, "")}%
          </p>
        </div>
        <VendorLogoutButton />
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="KYC যাচাই">
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="text-text-muted">অবস্থা:</dt>
              <dd className="font-semibold text-text-main">
                {vendorKycStatusLabel(d.kyc.status, locale)}
              </dd>
            </div>
            {d.kyc.note ? (
              <div className="flex gap-2">
                <dt className="text-text-muted">স্টাফের নোট:</dt>
                <dd className="text-text-main">{d.kyc.note}</dd>
              </div>
            ) : null}
            {d.kyc.submittedAt ? (
              <div className="flex gap-2">
                <dt className="text-text-muted">জমা:</dt>
                <dd className="text-text-main">{fmtDate(d.kyc.submittedAt)}</dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-3 text-xs leading-6 text-text-muted">
            KYC মানে আপনার দোকানের কাগজপত্র (ট্রেড লাইসেন্স, NID ইত্যাদি) স্টোরের কাছে যাচাই করা।
            কাগজপত্র আপলোডের ব্যবস্থা এখনো তৈরি হয়নি — কাগজপত্র স্টোরে জমা দিয়ে নিচের বাটনে জমা
            নিশ্চিত করুন; স্টাফ যাচাই করে অবস্থা আপডেট করে দেবেন।
          </p>
          {d.documents.length > 0 ? (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-sm font-medium text-text-main">রেকর্ডকৃত কাগজপত্র</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {d.documents.map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0 text-text-main">
                      {vendorDocumentKindLabel(doc.kind, locale)}
                      <span className="block text-xs text-text-muted">
                        {doc.fileName} · {fmtDate(doc.createdAt)}
                        {doc.note ? ` · ${doc.note}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-medium text-text-main">
                      {vendorDocumentStatusLabel(doc.status, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-xs leading-6 text-text-muted">
              এখনো কোনো কাগজপত্র রেকর্ড করা হয়নি — জমা দিলে স্টাফ এখানে তালিকাভুক্ত করবেন।
            </p>
          )}
          <div className="mt-3">
            <label className="block">
              <span className="text-sm text-text-muted">কাগজপত্র আপলোড</span>
              <input type="file" disabled className="mt-1 block w-full text-sm text-text-muted opacity-60" />
            </label>
            <p className="mt-1 text-xs leading-6 text-text-muted">{d.documentUpload.reasonBn}</p>
          </div>
          {canVendorSubmitKyc(d.kyc.status) ? <KycSubmitButton /> : null}
        </Card>

        <Card title="পে-আউট সারাংশ">
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-text-muted">মোট বিক্রি (আমার পণ্য)</dt>
              <dd className="mt-0.5 font-semibold text-text-main">{formatBdt(d.payout.grossPoisha)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">প্ল্যাটফর্ম কমিশন</dt>
              <dd className="mt-0.5 font-semibold text-text-main">− {formatBdt(d.payout.commissionPoisha)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">রিফান্ড বাদ</dt>
              <dd className="mt-0.5 font-semibold text-text-main">− {formatBdt(d.payout.refundsPoisha)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">নিট পাওনা (মোট বকেয়া)</dt>
              <dd className="mt-0.5 font-semibold text-text-main">{formatBdt(d.payout.netPayablePoisha)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">পরিশোধিত (রেকর্ডকৃত)</dt>
              <dd className="mt-0.5 font-semibold text-text-main">{formatBdt(d.payout.paidOutPoisha)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">অনুরোধে আটকে আছে</dt>
              <dd className="mt-0.5 font-semibold text-text-main">{formatBdt(d.payout.heldPoisha)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">উত্তোলনযোগ্য</dt>
              <dd className="mt-0.5 font-semibold text-text-main">{formatBdt(d.payout.availablePoisha)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-6 text-text-muted">
            "নিট পাওনা" ডেলিভার্ড অর্ডারের আসল কমিশন লাইন থেকে হিসাব করা ({d.payout.orderCount}টি
            অর্ডার)। পে-আউট এই সিস্টেম থেকে সরাসরি পাঠানো হয় না — নিচে অনুরোধ পাঠালে স্টাফ
            যাচাই করে সিস্টেমের বাইরে (বিকাশ/নগদ/ব্যাংক) পেমেন্ট করেন এবং এখানে "পরিশোধিত"
            রেকর্ড করেন; সেই রেকর্ডই উপরের "পরিশোধিত" অঙ্ক।
          </p>
          {d.status === "ACTIVE" ? (
            <VendorPayoutRequestForm availablePoisha={d.payout.availablePoisha} />
          ) : (
            <p className="mt-3 text-xs leading-6 text-text-muted">
              পে-আউট অনুরোধ শুধু সক্রিয় (ACTIVE) ভেন্ডররা পাঠাতে পারেন — আপনার বর্তমান অবস্থা:{" "}
              {ACCOUNT_STATUS_BN[d.status] ?? d.status}।
            </p>
          )}
          {d.payoutRequests.length > 0 ? (
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-sm font-medium text-text-main">আমার পে-আউট অনুরোধ</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {d.payoutRequests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-text-main">
                      {fmtDate(r.createdAt)} · {formatBdt(r.amountPoisha)} · {r.method}
                      {r.note ? <span className="block text-xs text-text-muted">স্টাফের নোট: {r.note}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-text-main">
                      {PAYOUT_STATUS_BN[r.status] ?? r.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>

      <Card title="আমার পণ্য">
        {d.products.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">এখনো কোনো পণ্য জমা দেওয়া হয়নি।</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className={thClass}>পণ্য</th>
                  <th className={thClass}>SKU</th>
                  <th className={thClass}>দাম</th>
                  <th className={thClass}>স্টক</th>
                  <th className={thClass}>অনুমোদন</th>
                </tr>
              </thead>
              <tbody>
                {d.products.map((p) => (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className={tdClass}>
                      {p.productName}
                      {p.rejectionReason ? (
                        <span className="block text-xs text-red-700">কারণ: {p.rejectionReason}</span>
                      ) : null}
                    </td>
                    <td className={`${tdClass} font-mono text-xs`}>{p.sku}</td>
                    <td className={tdClass}>{formatBdt(p.pricePoisha)}</td>
                    <td className={tdClass}>
                      {p.stock === null ? (
                        <span className="text-text-muted">ট্র্যাক করা হয়নি</span>
                      ) : (
                        p.stock
                      )}
                    </td>
                    <td className={tdClass}>{APPROVAL_BN[p.approval] ?? p.approval}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <VendorProductForm />
      </Card>

      <Card title="আমার পণ্যসহ অর্ডার">
        {d.orders.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">এখনো কোনো অর্ডারে আপনার পণ্য যায়নি।</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className={thClass}>অর্ডার</th>
                  <th className={thClass}>তারিখ</th>
                  <th className={thClass}>গ্রাহক</th>
                  <th className={thClass}>আমার পণ্য</th>
                  <th className={thClass}>আমার মোট</th>
                  <th className={thClass}>কমিশন</th>
                </tr>
              </thead>
              <tbody>
                {d.orders.map((o) => (
                  <tr key={o.orderId} className="border-b border-border last:border-0">
                    <td className={`${tdClass} font-mono text-xs`}>
                      {o.orderNo}
                      <span className="block font-sans text-text-muted">{o.status}</span>
                    </td>
                    <td className={tdClass}>{fmtDate(o.createdAt)}</td>
                    <td className={tdClass}>
                      {o.customerName}
                      <span className="block text-xs text-text-muted">{o.customerPhoneMasked}</span>
                    </td>
                    <td className={tdClass}>
                      {o.lines.map((l) => `${l.productName} ×${l.quantity}`).join(", ")}
                    </td>
                    <td className={tdClass}>{formatBdt(o.myGrossPoisha)}</td>
                    <td className={tdClass}>
                      {COMMISSION_STATUS_BN[o.commissionStatus] ?? o.commissionStatus}
                      {o.vendorEarningPoisha !== null ? (
                        <span className="block text-xs text-text-muted">
                          আয়: {formatBdt(o.vendorEarningPoisha)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="কমিশন লেজার">
        {d.ledger.length === 0 ? (
          <p className="mt-3 text-sm text-text-muted">
            এখনো কোনো কমিশন জমা হয়নি — আপনার পণ্যসহ অর্ডার ডেলিভারি হলেই এখানে লাইন আসবে।
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className={thClass}>তারিখ</th>
                  <th className={thClass}>অর্ডার</th>
                  <th className={thClass}>মোট বিক্রি</th>
                  <th className={thClass}>কমিশন</th>
                  <th className={thClass}>আমার আয়</th>
                </tr>
              </thead>
              <tbody>
                {d.ledger.map((l) => (
                  <tr key={`${l.orderId}-${l.createdAt}`} className="border-b border-border last:border-0">
                    <td className={tdClass}>{fmtDate(l.createdAt)}</td>
                    <td className={`${tdClass} font-mono text-xs`}>{l.orderNo ?? l.orderId}</td>
                    <td className={tdClass}>{formatBdt(l.grossPoisha)}</td>
                    <td className={tdClass}>− {formatBdt(l.commissionPoisha)}</td>
                    <td className={`${tdClass} font-semibold`}>{formatBdt(l.vendorEarningPoisha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {d.refunds.length > 0 ? (
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-sm font-medium text-text-main">রিফান্ড চার্জব্যাক</p>
            <ul className="mt-2 space-y-1 text-sm text-text-muted">
              {d.refunds.map((r) => (
                <li key={r.id}>
                  {fmtDate(r.createdAt)} · − {formatBdt(r.amountPoisha)} · {r.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </main>
  );
}

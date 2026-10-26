/**
 * /account/b2b — B2B buyer portal (ADV-14, doc 22).
 *
 * A section INSIDE the customer account: the session is the account's
 * own customer_session (src/customer-auth) — there is no separate B2B
 * login. The B2B profile is the B2bCustomer row carrying the same
 * phone as the account; every figure on this page comes from that row
 * or from the customer's real orders/payments (src/b2b/portal.ts):
 *   - credit used = duePoisha AS RECORDED on the B2B account;
 *   - available credit = limit − used, computed and labelled হিসাব;
 *   - per-order dues computed from Payment / Refund rows.
 * Accepting a quotation runs the wave-27 conversion service — the
 * order is created at the quotation's contract prices and the credit
 * rules (limit / overdue / approval) answer with their own refusals.
 *
 * States: module.b2b_portal OFF → locked notice; logged out → the
 * account page (login forms); no B2B profile on the account's phone →
 * a clear "B2B অ্যাকাউন্ট নয়" state; profile present → dashboard
 * (approval status shown as recorded, incl. PENDING / SUSPENDED).
 *
 * Invoices: there is NO customer-facing invoice/print surface in the
 * storefront (orders print v2 + Mushak 6.3 are staff surfaces), so no
 * invoice link is fabricated — each order links to /track, the
 * customer order surface that exists, and shows its full money state.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/customer-auth/auth";
import {
  buildB2bPortalDashboard,
  getB2bProfileByPhone,
  isB2bPortalEnabled,
  type B2bPortalOrder,
  type B2bPortalQuotation,
} from "@/b2b/portal";
import { Money } from "@/components/ui/money";
import { Icon } from "@/components/ui/icon";
import QuotationActions from "./quotation-actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "B2B পোর্টাল — Advance Ecommerce",
  description: "আপনার কোম্পানির কোটেশন, ক্রেডিট ও অর্ডারের হিসাব।",
  robots: { index: false, follow: false },
};

const APPROVAL_BN: Record<string, string> = {
  APPROVED: "অনুমোদিত",
  PENDING: "অনুমোদনের অপেক্ষায়",
  REJECTED: "প্রত্যাখ্যাত",
  SUSPENDED: "স্থগিত",
};

const QUOTATION_STATUS_BN: Record<string, string> = {
  DRAFT: "খসড়া (স্টোর এখনো পাঠায়নি)",
  SENT: "পাঠানো হয়েছে — আপনার সিদ্ধান্তের অপেক্ষায়",
  ACCEPTED: "গৃহীত — অর্ডার তৈরির প্রক্রিয়ায়",
  REJECTED: "প্রত্যাখ্যাত",
  EXPIRED: "মেয়াদোত্তীর্ণ",
  CONVERTED: "অর্ডারে রূপান্তরিত",
};

const PAYMENT_STATUS_BN: Record<string, string> = {
  UNPAID: "অপরিশোধিত",
  PARTIAL: "আংশিক পরিশোধিত",
  PAID: "পরিশোধিত",
  REFUNDED: "রিফান্ড হয়েছে",
  PARTIALLY_REFUNDED: "আংশিক রিফান্ড",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("bn-BD", { dateStyle: "medium" }).format(new Date(iso));
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card" aria-label={title}>
      <h2 className="text-base font-bold text-text-main">{title}</h2>
      {children}
    </section>
  );
}

function QuotationBlock({ quotation }: { quotation: B2bPortalQuotation }) {
  const status = quotation.effectiveStatus;
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-text-main">
          কোটেশন <span className="text-text-muted">#{quotation.id.slice(-8)}</span>
        </p>
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
          {QUOTATION_STATUS_BN[status] ?? status}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        {formatDate(quotation.createdAt)}
        {quotation.validUntil ? ` · মেয়াদ: ${formatDate(quotation.validUntil)}` : ""}
        {status === "CONVERTED" && quotation.convertedOrderId
          ? " · নিচের অর্ডার তালিকায় অর্ডারটি দেখুন"
          : ""}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-text-muted">
              <th className="py-1 pr-3 font-medium">পণ্য</th>
              <th className="py-1 pr-3 font-medium">পরিমাণ</th>
              <th className="py-1 pr-3 font-medium">একক মূল্য</th>
              <th className="py-1 font-medium">মোট</th>
            </tr>
          </thead>
          <tbody>
            {quotation.lines.map((l, i) => (
              <tr key={`${l.variantId}-${i}`} className="border-t border-border">
                <td className="py-1.5 pr-3 text-text-main">
                  {l.productName} <span className="text-text-muted">({l.sku})</span>
                </td>
                <td className="py-1.5 pr-3 text-text-main">{l.quantity}</td>
                <td className="py-1.5 pr-3 text-text-main"><Money poisha={l.unitPricePoisha} /></td>
                <td className="py-1.5 text-text-main"><Money poisha={l.unitPricePoisha * l.quantity} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-sm font-bold text-text-main">
        সর্বমোট: <Money poisha={quotation.totalPoisha} />
      </p>
      {status === "SENT" ? (
        <div className="mt-3">
          <QuotationActions quotationId={quotation.id} />
        </div>
      ) : null}
    </li>
  );
}

function OrderRow({ order }: { order: B2bPortalOrder }) {
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <a
          href={`/track?orderNo=${encodeURIComponent(order.orderNo)}`}
          className="text-sm font-semibold text-text-main hover:text-brand-700 hover:underline"
        >
          {order.orderNo}
        </a>
        <span className="text-xs text-text-muted">{formatDate(order.createdAt)}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        অবস্থা: {order.status} · পেমেন্ট: {PAYMENT_STATUS_BN[order.paymentStatus] ?? order.paymentStatus}
        {order.isB2bCreditOrder ? " · B2B ক্রেডিট অর্ডার" : ""}
      </p>
      <dl className="mt-1.5 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-text-muted">মোট</dt>
          <dd className="font-semibold text-text-main"><Money poisha={order.totalPoisha} /></dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">পরিশোধিত</dt>
          <dd className="font-semibold text-text-main"><Money poisha={order.paidPoisha} /></dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">বকেয়া</dt>
          <dd className="font-semibold text-text-main"><Money poisha={order.duePoisha} /></dd>
        </div>
      </dl>
    </li>
  );
}

export default async function B2bPortalPage() {
  if (!isB2bPortalEnabled()) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <h1 className="font-display text-xl font-bold text-text-main">B2B পোর্টাল</h1>
          <p role="status" className="mt-3 text-sm leading-7 text-text-muted">
            🔒 এই মডিউলটি এই স্টোরে বন্ধ আছে। B2B পোর্টাল চালু করতে স্টোর কর্তৃপক্ষকে বলুন।
          </p>
          <p className="mt-3 text-sm">
            <a href="/account" className="font-semibold text-brand-700 hover:underline">
              ← আমার অ্যাকাউন্টে ফিরুন
            </a>
          </p>
        </div>
      </main>
    );
  }

  const customer = await getCurrentCustomer();
  if (customer === null) redirect("/account");

  const profile = await getB2bProfileByPhone(customer.phone);
  if (profile === null) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-10">
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <h1 className="font-display text-xl font-bold text-text-main">B2B অ্যাকাউন্ট নয়</h1>
          <p className="mt-3 text-sm leading-7 text-text-muted">
            আপনার অ্যাকাউন্ট ({customer.phoneMasked})-এর সঙ্গে কোনো B2B (পাইকারি) কোম্পানি
            প্রোফাইল যুক্ত নেই। B2B অ্যাকাউন্ট স্টোর কর্তৃপক্ষ আবেদন যাচাই করে তৈরি করে —
            ট্রেড লাইসেন্সসহ আবেদন করতে স্টোরে যোগাযোগ করুন। অনুমোদনের পর এই নম্বর দিয়েই
            লগইন করে কোটেশন, ক্রেডিট ও অর্ডারের হিসাব এখানে দেখতে পাবেন।
          </p>
          <p className="mt-3 text-sm">
            <a href="/account" className="font-semibold text-brand-700 hover:underline">
              ← আমার অ্যাকাউন্টে ফিরুন
            </a>
          </p>
        </div>
      </main>
    );
  }

  const dashboard = await buildB2bPortalDashboard(customer, profile);
  const { company } = dashboard;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <p className="text-sm">
        <a href="/account" className="font-semibold text-brand-700 hover:underline">
          ← আমার অ্যাকাউন্ট
        </a>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white"
        >
          <Icon name="store" size={18} />
        </span>
        <h1 className="font-display text-2xl font-bold text-text-main">{company.businessName}</h1>
        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
          {APPROVAL_BN[company.approvalStatus] ?? company.approvalStatus}
        </span>
      </div>
      <p className="mt-1.5 text-sm leading-6 text-text-muted">
        B2B ক্রেতা পোর্টাল — আপনার কোম্পানির কোটেশন, ক্রেডিট ও অর্ডারের হিসাব।
      </p>

      <Card title="কোম্পানি ও ক্রেডিট">
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-text-muted">যোগাযোগের ব্যক্তি</dt>
            <dd className="mt-0.5 font-semibold text-text-main">{company.contactName}</dd>
          </div>
          <div>
            <dt className="text-text-muted">ট্রেড লাইসেন্স নম্বর</dt>
            <dd className="mt-0.5 font-semibold text-text-main">{company.tradeLicenseNo ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-text-muted">ক্রেডিট সীমা</dt>
            <dd className="mt-0.5 font-semibold text-text-main"><Money poisha={company.creditLimitPoisha} /></dd>
          </div>
          <div>
            <dt className="text-text-muted">ব্যবহৃত ক্রেডিট (রেকর্ড অনুযায়ী বকেয়া)</dt>
            <dd className="mt-0.5 font-semibold text-text-main"><Money poisha={company.creditUsedPoisha} /></dd>
          </div>
          <div>
            <dt className="text-text-muted">ব্যবহারযোগ্য ক্রেডিট (হিসাব: সীমা − বকেয়া)</dt>
            <dd className="mt-0.5 font-semibold text-text-main"><Money poisha={company.availableCreditPoisha} /></dd>
          </div>
          <div>
            <dt className="text-text-muted">সবচেয়ে পুরনো বকেয়ার তারিখ</dt>
            <dd className="mt-0.5 font-semibold text-text-main">
              {company.oldestDueDate ? formatDate(company.oldestDueDate) : "—"}
            </dd>
          </div>
        </dl>
        {company.overdue ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800" role="alert">
            ⚠ আপনার মেয়াদোত্তীর্ণ বকেয়া আছে — বকেয়া পরিশোধ না হলে নতুন ক্রেডিট অর্ডার
            (কোটেশন গ্রহণ) করা যাবে না।
          </p>
        ) : null}
        {company.approvalStatus !== "APPROVED" ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800" role="alert">
            আপনার B2B অ্যাকাউন্টের অবস্থা: {APPROVAL_BN[company.approvalStatus] ?? company.approvalStatus} —
            অনুমোদিত না হলে কোটেশন গ্রহণ করে ক্রেডিট অর্ডার করা যাবে না।
          </p>
        ) : null}
      </Card>

      <Card title="আমার কোটেশন">
        {dashboard.quotations.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-text-muted">
            এখনো কোনো কোটেশন নেই। পাইকারি দামের জন্য স্টোরে যোগাযোগ করলে কোটেশন এখানে দেখা যাবে।
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {dashboard.quotations.map((q) => (
              <QuotationBlock key={q.id} quotation={q} />
            ))}
          </ul>
        )}
      </Card>

      <Card title="আমার অর্ডার">
        {dashboard.orders.length === 0 ? (
          <p className="mt-3 text-sm leading-6 text-text-muted">এখনো কোনো অর্ডার নেই।</p>
        ) : (
          <ul className="divide-y divide-border">
            {dashboard.orders.map((o) => (
              <OrderRow key={o.id} order={o} />
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs leading-5 text-text-muted">
          অর্ডার নম্বরে ক্লিক করলে ট্র্যাকিং পেজে বিস্তারিত অবস্থা দেখা যাবে। চালান (ইনভয়েস)
          স্টোর থেকে ইস্যু করা হয় — এই পেজে প্রতিটি অর্ডারের মোট, পরিশোধিত ও বকেয়া অঙ্ক
          আসল রেকর্ড থেকে দেখানো হচ্ছে।
        </p>
      </Card>
    </main>
  );
}

/**
 * /account — customer account (ADV-15: phone-OTP primary, password
 * secondary, Google when configured in Settings).
 *
 * Logged OUT: AuthForms — OTP (phone → code; a first-time phone
 * creates the account at verify), password login + registration, and
 * the Google button only when the server reports it configured.
 * Registering with a phone claims the guest Customer row checkout
 * created for it, so orders placed as a guest with the same number
 * appear here after registration — nothing is copied or duplicated.
 * Logged IN: profile summary + sign-in methods, order history (real
 * DB orders, each linking to /track), saved addresses, logout.
 *
 * Session: the httpOnly `customer_session` cookie, resolved server-side
 * via src/customer-auth. This page never receives or renders a password
 * or a session token.
 */
import type { Metadata } from "next";
import {
  getCurrentCustomer,
  listCustomerAddresses,
  listCustomerOrders,
  type AccountOrderSummary,
} from "@/customer-auth/auth";
import ReorderButton from "./reorder-button";
import ReturnsSection from "./returns-section";
import DownloadsSection from "./downloads-section";
import CustomerTrackingStepper from "./tracking-stepper";
import AuthForms from "@/customer-auth/components/AuthForms";
import { isGoogleLoginConfigured } from "@/customer-auth/google";
import AddressManager from "@/customer-auth/components/AddressManager";
import LogoutButton from "@/customer-auth/components/LogoutButton";
import PushSubscribeToggle from "@/pwa/push-subscribe";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { getB2bProfileByPhone } from "@/b2b/portal";
import MembershipTierCard from "./membership-tier-card";
import { Icon } from "@/components/ui/icon";
import { Money } from "@/components/ui/money";
import {
  OrderPaymentBadge,
  OrderStatusBadge,
} from "@/orders/components/OrderStatusBadge";
import {
  ORDER_STATUS_VISUAL,
  PAYMENT_STATUS_VISUAL,
} from "@/orders/components/labels";
import type { OrderStatus, PaymentStatus } from "@/orders/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "আমার অ্যাকাউন্ট — Advance Ecommerce",
  description: "লগইন করুন, আপনার অর্ডার ও সংরক্ষিত ঠিকানা দেখুন।",
  robots: { index: false, follow: false },
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("bn-BD", { dateStyle: "medium" }).format(new Date(iso));
}

function isOrderStatus(status: string): status is OrderStatus {
  return status in ORDER_STATUS_VISUAL;
}

function isPaymentStatus(status: string): status is PaymentStatus {
  return status in PAYMENT_STATUS_VISUAL;
}

/**
 * One order as a designed card (doc 19 OD7): item tile, OD0 status +
 * payment badges, the customer tracking stepper, and a money-lite
 * block. ONLY figures the account payload actually carries are shown
 * (totalPoisha; the COD due equals the total only while UNPAID — a
 * PARTIAL order's paid amount is not in the payload, so no due figure
 * is invented for it). The delivery-slot chip reads
 * `deliverySlotLabel`, which listCustomerOrders resolves from the
 * order's persisted slot id (doc 21 G3-19).
 */
function OrderCard({ order }: { order: AccountOrderSummary }) {
  const firstInitial = order.firstItemName ? [...order.firstItemName][0] : null;
  const codDuePoisha =
    order.paymentMethod === "cod" && order.paymentStatus === "UNPAID"
      ? order.totalPoisha
      : null;
  return (
    <li className="px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-base font-bold text-brand-700"
        >
          {firstInitial ?? <Icon name="package" size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <a
              href={`/track?orderNo=${encodeURIComponent(order.orderNo)}`}
              className="text-sm font-semibold text-text-main hover:text-brand-700 hover:underline"
            >
              {order.orderNo}
            </a>
            {isOrderStatus(order.status) ? (
              <OrderStatusBadge status={order.status} />
            ) : (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                {order.status}
              </span>
            )}
            {isPaymentStatus(order.paymentStatus) && order.paymentStatus !== "PAID" ? (
              <OrderPaymentBadge status={order.paymentStatus} />
            ) : null}
            {order.deliverySlotLabel ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted">
                <Icon name="clock" size={12} />
                ডেলিভারি স্লট: {order.deliverySlotLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs leading-5 text-text-muted">
            {formatDate(order.createdAt)} · {order.itemCount}টি পণ্য
            {order.firstItemName ? ` · ${order.firstItemName}` : ""}
          </p>
        </div>
        <p className="shrink-0 text-sm font-bold text-text-main">
          <Money poisha={order.totalPoisha} />
        </p>
      </div>

      <CustomerTrackingStepper status={order.status} />

      {codDuePoisha !== null ? (
        <div className="mt-3 flex items-baseline justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm">
          <span className="font-medium text-amber-800">
            ডেলিভারির সময় বকেয়া (ক্যাশ অন ডেলিভারি)
          </span>
          <span className="font-semibold text-amber-700">
            <Money poisha={codDuePoisha} />
          </span>
        </div>
      ) : null}

      <div className="mt-3">
        <ReorderButton orderId={order.id} orderNo={order.orderNo} />
      </div>
    </li>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: { authError?: string };
}) {
  const customer = await getCurrentCustomer();

  if (customer === null) {
    // Server-driven availability: the Google button exists only when
    // credentials are configured in Settings (ADV-15).
    const googleEnabled = await isGoogleLoginConfigured();
    return (
      <main className="mx-auto w-full max-w-md px-4 py-8 sm:py-10">
        <h1 className="font-display text-2xl font-bold text-text-main">আমার অ্যাকাউন্ট</h1>
        <p className="mt-1.5 text-sm leading-6 text-text-muted">
          মোবাইল নম্বরে OTP কোড দিয়ে লগইন করুন — পাসওয়ার্ডও ব্যবহার করা যাবে।
        </p>
        {searchParams.authError ? (
          <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
            Google লগইন সম্পন্ন হয়নি। আবার চেষ্টা করুন, অথবা OTP/পাসওয়ার্ড দিয়ে লগইন করুন।
          </p>
        ) : null}
        <div className="mt-5">
          <AuthForms googleEnabled={googleEnabled} />
        </div>
        <p className="mt-4 text-sm leading-6 text-text-muted">
          অ্যাকাউন্ট ছাড়াও অর্ডার নম্বর ও ফোন নম্বর দিয়ে{" "}
          <a href="/track" className="font-semibold text-brand-700 hover:underline">অর্ডার ট্র্যাক</a>{" "}
          করা যায় — অতিথি হিসেবে অর্ডার করা সবসময়ই চালু আছে।
        </p>
      </main>
    );
  }

  const [{ orders, total }, addresses] = await Promise.all([
    listCustomerOrders(customer.id, 1, 10),
    listCustomerAddresses(customer.id),
  ]);

  // B2B buyer portal entry (ADV-14): shown only when the portal module
  // is on AND this account's phone carries a B2B company profile.
  const b2bProfile = isFeatureEnabled("module.b2b_portal")
    ? await getB2bProfileByPhone(customer.phone)
    : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-main">আমার অ্যাকাউন্ট</h1>
          <p className="mt-1.5 text-sm leading-6 text-text-muted">
            স্বাগতম, <span className="font-semibold text-text-main">{customer.name}</span>
          </p>
        </div>
        <LogoutButton />
      </div>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card" aria-label="প্রোফাইল">
        <h2 className="text-base font-bold text-text-main">প্রোফাইল</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-text-muted">নাম</dt>
            <dd className="mt-0.5 font-semibold text-text-main">{customer.name}</dd>
          </div>
          <div>
            <dt className="text-text-muted">মোবাইল নম্বর</dt>
            <dd className="mt-0.5 font-semibold text-text-main">{customer.phoneMasked}</dd>
          </div>
          <div>
            <dt className="text-text-muted">ইমেইল</dt>
            <dd className="mt-0.5 font-semibold text-text-main">{customer.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-text-muted">সদস্য হয়েছেন</dt>
            <dd className="mt-0.5 font-semibold text-text-main">{formatDate(customer.createdAt)}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card" aria-label="লগইন পদ্ধতি">
        <h2 className="text-base font-bold text-text-main">লগইন পদ্ধতি</h2>
        <ul className="mt-3 space-y-3 text-sm">
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-text-muted">মোবাইল OTP</span>
            <span className="font-semibold text-text-main">{customer.phoneMasked} — সবসময় চালু</span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-text-muted">পাসওয়ার্ড</span>
            <span className="font-semibold text-text-main">
              {customer.hasPassword ? "সেট করা আছে" : "সেট করা নেই — OTP দিয়ে লগইন করুন"}
            </span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-text-muted">Google</span>
            <span className="font-semibold text-text-main">
              {customer.email
                ? `${customer.email} — এই ইমেইল দিয়ে সাইন-ইন করা যাবে`
                : "ইমেইল যোগ করা নেই"}
            </span>
          </li>
        </ul>
      </section>

      {isFeatureEnabled("module.marketing_mechanics") ? (
        <MembershipTierCard customerId={customer.id} />
      ) : null}

      {b2bProfile ? (
        <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card" aria-label="B2B পোর্টাল">
          <h2 className="flex items-center gap-2.5 text-base font-bold text-text-main">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white"
            >
              <Icon name="store" size={18} />
            </span>
            B2B পোর্টাল — {b2bProfile.businessName}
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            আপনার কোম্পানির কোটেশন, ক্রেডিট সীমা ও বকেয়ার হিসাব এবং অর্ডারগুলো এক জায়গায় দেখুন।
          </p>
          <p className="mt-3">
            <a href="/account/b2b" className="font-semibold text-brand-700 hover:underline">
              B2B পোর্টালে যান →
            </a>
          </p>
        </section>
      ) : null}

      <section className="mt-6 rounded-2xl border border-border bg-card shadow-card" aria-label="আমার অর্ডার">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="flex items-center gap-2.5 text-base font-bold text-text-main">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white"
            >
              <Icon name="package" size={18} />
            </span>
            আমার অর্ডার
          </h2>
          <span className="text-xs font-medium text-text-muted">মোট {total}টি</span>
        </div>
        {orders.length === 0 ? (
          <p className="px-5 py-5 text-sm leading-6 text-text-muted">
            এখনো কোনো অর্ডার নেই। <a href="/shop" className="font-semibold text-brand-700 hover:underline">কেনাকাটা শুরু করুন</a> —
            এই নম্বর দিয়ে অতিথি হিসেবে করা অর্ডারও এখানে দেখা যেত।
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border pb-2">
            {orders.map((o) => (
              <OrderCard key={o.id} order={o} />
            ))}
          </ul>
        )}
        {total > orders.length ? (
          <p className="px-5 pb-4 text-xs text-text-muted">
            সাম্প্রতিক {orders.length}টি দেখানো হচ্ছে। নির্দিষ্ট অর্ডারের অবস্থা{" "}
            <a href="/track" className="font-semibold text-brand-700 hover:underline">ট্র্যাক</a> পেজে দেখুন।
          </p>
        ) : null}
      </section>

      <ReturnsSection
        orders={orders.map((o) => ({ id: o.id, orderNo: o.orderNo, status: o.status }))}
      />

      <DownloadsSection />

      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card" aria-label="সাপোর্ট টিকিট">
        <h2 className="text-base font-bold text-text-main">সাপোর্ট টিকিট</h2>
        <p className="mt-1.5 text-sm leading-6 text-text-muted">
          অর্ডার বা কেনাকাটা নিয়ে সমস্যা থাকলে টিকিট খুলুন — আমাদের টিমের উত্তর ও পুরো
          কথোপকথন এক জায়গায় পাবেন।
        </p>
        <a
          href="/account/tickets"
          className="mt-3 inline-block rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-text-main transition hover:bg-surface-2"
        >
          আমার টিকিট দেখুন / নতুন টিকিট খুলুন
        </a>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card" aria-label="সংরক্ষিত ঠিকানা">
        <h2 className="text-base font-bold text-text-main">সংরক্ষিত ঠিকানা</h2>
        <div className="mt-3">
          <AddressManager addresses={addresses} />
        </div>
      </section>

      <section className="mt-6" aria-label="পুশ নোটিফিকেশন">
        <PushSubscribeToggle />
      </section>
    </main>
  );
}

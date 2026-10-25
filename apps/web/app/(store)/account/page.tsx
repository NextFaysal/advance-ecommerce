/**
 * /account — customer account (phone + password).
 *
 * Logged OUT: login + registration forms (AuthForms). Registering with
 * a phone claims the guest Customer row checkout created for it, so
 * orders placed as a guest with the same number appear here after
 * registration — nothing is copied or duplicated.
 * Logged IN: profile summary, order history (real DB orders, each
 * linking to /track), saved addresses, logout.
 *
 * Session: the httpOnly `customer_session` cookie, resolved server-side
 * via src/customer-auth. This page never receives or renders a password
 * or a session token. There is NO password-reset flow yet (no live
 * SMS/email channel to deliver one) and the UI says so honestly.
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
import AddressManager from "@/customer-auth/components/AddressManager";
import LogoutButton from "@/customer-auth/components/LogoutButton";
import PushSubscribeToggle from "@/pwa/push-subscribe";
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
 * is invented for it). The payload carries no delivery slot either:
 * `deliverySlotLabel` is accepted so the chip lights up unchanged if
 * a future wave adds the field to AccountOrderSummary.
 */
function OrderCard({
  order,
}: {
  order: AccountOrderSummary & { deliverySlotLabel?: string | null };
}) {
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

export default async function AccountPage() {
  const customer = await getCurrentCustomer();

  if (customer === null) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-8 sm:py-10">
        <h1 className="font-display text-2xl font-bold text-text-main">আমার অ্যাকাউন্ট</h1>
        <p className="mt-1.5 text-sm leading-6 text-text-muted">
          মোবাইল নম্বর ও পাসওয়ার্ড দিয়ে লগইন করুন, অথবা নতুন অ্যাকাউন্ট তৈরি করুন।
        </p>
        <div className="mt-5">
          <AuthForms />
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

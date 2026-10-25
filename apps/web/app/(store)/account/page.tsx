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
import AuthForms from "@/customer-auth/components/AuthForms";
import AddressManager from "@/customer-auth/components/AddressManager";
import LogoutButton from "@/customer-auth/components/LogoutButton";
import PushSubscribeToggle from "@/pwa/push-subscribe";
import { BdtAmount } from "@/components/ui/numerals";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "আমার অ্যাকাউন্ট — Advance Ecommerce",
  description: "লগইন করুন, আপনার অর্ডার ও সংরক্ষিত ঠিকানা দেখুন।",
  robots: { index: false, follow: false },
};

const ORDER_STATUS_BN: Record<string, string> = {
  PENDING: "অর্ডার পেয়েছি",
  CONFIRMED: "কনফার্ম হয়েছে",
  PROCESSING: "প্রসেসিং চলছে",
  PACKED: "প্যাক করা হয়েছে",
  SHIPPED: "পাঠানো হয়েছে",
  DELIVERED: "ডেলিভারি হয়েছে",
  CANCELLED: "বাতিল হয়েছে",
  FAILED: "ব্যর্থ হয়েছে",
  RETURNED: "রিটার্ন পৌঁছেছে",
  REFUNDED: "রিফান্ড হয়েছে",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("bn-BD", { dateStyle: "medium" }).format(new Date(iso));
}

function OrderRow({ order }: { order: AccountOrderSummary }) {
  return (
    <li className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-main">
            <a href={`/track?orderNo=${encodeURIComponent(order.orderNo)}`} className="hover:text-brand-700 hover:underline">
              {order.orderNo}
            </a>
            <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
              {ORDER_STATUS_BN[order.status] ?? order.status}
            </span>
          </p>
          <p className="mt-1 truncate text-xs leading-5 text-text-muted">
            {formatDate(order.createdAt)} · {order.itemCount}টি পণ্য
            {order.firstItemName ? ` · ${order.firstItemName}` : ""}
          </p>
        </div>
        <p className="shrink-0 text-sm font-bold text-text-main">
          <BdtAmount poisha={order.totalPoisha} />
        </p>
      </div>
      <div className="mt-2.5">
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
          <h2 className="text-base font-bold text-text-main">আমার অর্ডার</h2>
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
              <OrderRow key={o.id} order={o} />
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

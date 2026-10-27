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
 *
 * Language (doc 30): every UI string comes from ACCOUNT_STRINGS via
 * getRequestLocale(); order/payment badges receive lang={locale}.
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
import { isFacebookLoginConfigured } from "@/customer-auth/facebook";
import { isGoogleLoginConfigured } from "@/customer-auth/google";
import AddressManager from "@/customer-auth/components/AddressManager";
import LogoutButton from "@/customer-auth/components/LogoutButton";
import PushSubscribeToggle from "@/pwa/push-subscribe";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { getB2bProfileByPhone } from "@/b2b/portal";
import { coursesEnabled } from "@/courses/flags";
import { listCustomerCourses } from "@/courses/service";
import MembershipTierCard from "./membership-tier-card";
import {
  getOrderWarrantyCards,
  type OrderWarrantyItem,
} from "@/business-modules/electronics-warranty";
import PrivacySection from "./privacy-section";
import ApiTokensSection from "./api-tokens-section";
import { normalizeBdPhone } from "@advance-ecommerce/validators";
import BirthDateField from "./birth-date-field";
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
import { getRequestLocale } from "@/i18n/server";
import { intlLocale, interpolate, pick, type Locale } from "@/i18n/locale";
import { COMMON_STRINGS } from "@/i18n/dictionaries";
import { ACCOUNT_STRINGS, type AccountStrings } from "./strings";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const s = pick(locale, ACCOUNT_STRINGS);
  return {
    title: s.metaTitle,
    description: s.metaDescription,
    robots: { index: false, follow: false },
  };
}

function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" }).format(new Date(iso));
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
function OrderCard({
  order,
  locale,
  s,
  warrantyItems = [],
}: {
  order: AccountOrderSummary;
  locale: Locale;
  s: AccountStrings;
  /** ADV-22 (electronics pack): recorded serials + warranty window
   *  per electronics item of this order; empty unless the pack is on
   *  and the order has electronics items. */
  warrantyItems?: OrderWarrantyItem[];
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
              <OrderStatusBadge status={order.status} lang={locale} />
            ) : (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                {order.status}
              </span>
            )}
            {isPaymentStatus(order.paymentStatus) && order.paymentStatus !== "PAID" ? (
              <OrderPaymentBadge status={order.paymentStatus} lang={locale} />
            ) : null}
            {order.deliverySlotLabel ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted">
                <Icon name="clock" size={12} />
                {interpolate(s.deliverySlot, { label: order.deliverySlotLabel })}
              </span>
            ) : null}
          </div>
          <p className="mt-1 truncate text-xs leading-5 text-text-muted">
            {formatDate(order.createdAt, locale)} · {interpolate(s.itemsCount, { count: order.itemCount })}
            {order.firstItemName ? ` · ${order.firstItemName}` : ""}
          </p>
        </div>
        <p className="shrink-0 text-sm font-bold text-text-main">
          <Money poisha={order.totalPoisha} />
        </p>
      </div>

      <CustomerTrackingStepper status={order.status} />

      {warrantyItems.length > 0 ? (
        <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2.5 text-sm leading-6">
          <p className="font-semibold text-text-main">{s.warrantyCard}</p>
          <ul className="mt-1 space-y-2">
            {warrantyItems.map((item, i) => (
              <li key={i} className="text-text-muted">
                <span className="font-medium text-text-main">{item.productName}</span>
                {" — "}{interpolate(s.warrantyMonths, { months: item.warrantyMonths })}
                {item.warranty ? (
                  <>
                    {" "}· {interpolate(s.warrantyExpires, { date: formatDate(item.warranty.expiresOn, locale) })}
                    {item.warranty.isActive ? ` ${s.warrantyActive}` : ` ${s.warrantyExpired}`}
                  </>
                ) : (
                  <> · {s.warrantyStartsOnDelivery}</>
                )}
                {item.serials.length > 0 ? (
                  <>
                    <br />
                    <span className="text-xs">
                      {s.serialImei}{" "}
                      <span className="font-mono font-medium text-text-main">
                        {item.serials.join(", ")}
                      </span>
                    </span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {codDuePoisha !== null ? (
        <div className="mt-3 flex items-baseline justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm">
          <span className="font-medium text-amber-800">
            {s.codDue}
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
  const locale = await getRequestLocale();
  const s = pick(locale, ACCOUNT_STRINGS);
  const common = pick(locale, COMMON_STRINGS);
  const customer = await getCurrentCustomer();

  if (customer === null) {
    // Server-driven availability: the Google/Facebook buttons exist
    // only when their credentials are configured in Settings
    // (ADV-15) — an unconfigured install shows no dead buttons.
    const [googleEnabled, facebookEnabled] = await Promise.all([
      isGoogleLoginConfigured(),
      isFacebookLoginConfigured(),
    ]);
    return (
      <main className="mx-auto w-full max-w-md px-4 py-8 sm:py-10">
        <h1 className="font-display text-2xl font-bold text-text-main">{common.myAccount}</h1>
        <p className="mt-1.5 text-sm leading-6 text-text-muted">
          {s.loginIntro}
        </p>
        {searchParams.authError === "facebook_no_email" ? (
          <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
            {s.facebookNoEmail}
          </p>
        ) : searchParams.authError ? (
          <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
            {searchParams.authError === "facebook"
              ? s.facebookFailed
              : s.googleFailed}
          </p>
        ) : null}
        <div className="mt-5">
          <AuthForms googleEnabled={googleEnabled} facebookEnabled={facebookEnabled} />
        </div>
        <p className="mt-4 text-sm leading-6 text-text-muted">
          {s.guestTrackBefore}{" "}
          <a href="/track" className="font-semibold text-brand-700 hover:underline">{s.guestTrackLink}</a>{" "}
          {s.guestTrackAfter}
        </p>
      </main>
    );
  }

  const [{ orders, total }, addresses] = await Promise.all([
    listCustomerOrders(customer.id, 1, 10),
    listCustomerAddresses(customer.id),
  ]);

  // ADV-22 (electronics pack): warranty cards for the listed orders —
  // recorded serials + warranty window per electronics item. The
  // service self-gates on module.electronics; empty map when off.
  const warrantyByOrder = await getOrderWarrantyCards(orders.map((o) => o.id));

  // B2B buyer portal entry (ADV-14): shown only when the portal module
  // is on AND this account's phone carries a B2B company profile.
  const b2bProfile = isFeatureEnabled("module.b2b_portal")
    ? await getB2bProfileByPhone(customer.phone)
    : null;

  // Courses entry (ADV-23 vertical 6): shown only while the module
  // is on AND this customer currently has access to at least one
  // course (access is order-derived — see src/courses/service).
  const myCourses = coursesEnabled() ? await listCustomerCourses(customer.id) : [];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-main">{common.myAccount}</h1>
          <p className="mt-1.5 text-sm leading-6 text-text-muted">
            {s.welcome}{" "}
            <span className="font-semibold text-text-main">{customer.name}</span>
          </p>
        </div>
        <LogoutButton />
      </div>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card" aria-label={s.profile}>
        <h2 className="text-base font-bold text-text-main">{s.profile}</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-text-muted">{common.name}</dt>
            <dd className="mt-0.5 font-semibold text-text-main">{customer.name}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{s.mobileNumber}</dt>
            <dd className="mt-0.5 font-semibold text-text-main">{customer.phoneMasked}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{common.email}</dt>
            <dd className="mt-0.5 font-semibold text-text-main">{customer.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{s.memberSince}</dt>
            <dd className="mt-0.5 font-semibold text-text-main">{formatDate(customer.createdAt, locale)}</dd>
          </div>
          <BirthDateField />
        </dl>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card" aria-label={s.loginMethods}>
        <h2 className="text-base font-bold text-text-main">{s.loginMethods}</h2>
        <ul className="mt-3 space-y-3 text-sm">
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-text-muted">{s.mobileOtp}</span>
            <span className="font-semibold text-text-main">{customer.phoneMasked} {s.alwaysOnSuffix}</span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-text-muted">{s.passwordLabel}</span>
            <span className="font-semibold text-text-main">
              {customer.hasPassword ? s.passwordSet : s.passwordNotSet}
            </span>
          </li>
          <li className="flex items-baseline justify-between gap-3">
            <span className="text-text-muted">Google</span>
            <span className="font-semibold text-text-main">
              {customer.email
                ? interpolate(s.googleSignInWith, { email: customer.email })
                : s.noEmailAdded}
            </span>
          </li>
        </ul>
      </section>

      {isFeatureEnabled("module.marketing_mechanics") ? (
        <MembershipTierCard customerId={customer.id} />
      ) : null}

      {b2bProfile ? (
        <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card" aria-label={s.b2bPortal}>
          <h2 className="flex items-center gap-2.5 text-base font-bold text-text-main">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white"
            >
              <Icon name="store" size={18} />
            </span>
            {interpolate(s.b2bPortalHeading, { name: b2bProfile.businessName })}
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            {s.b2bPortalDesc}
          </p>
          <p className="mt-3">
            <a href="/account/b2b" className="font-semibold text-brand-700 hover:underline">
              {s.b2bPortalCta}
            </a>
          </p>
        </section>
      ) : null}

      <section className="mt-6 rounded-2xl border border-border bg-card shadow-card" aria-label={s.myOrders}>
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="flex items-center gap-2.5 text-base font-bold text-text-main">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white"
            >
              <Icon name="package" size={18} />
            </span>
            {s.myOrders}
          </h2>
          <span className="text-xs font-medium text-text-muted">{interpolate(s.totalOrders, { count: total })}</span>
        </div>
        {orders.length === 0 ? (
          <p className="px-5 py-5 text-sm leading-6 text-text-muted">
            {s.noOrdersBefore} <a href="/shop" className="font-semibold text-brand-700 hover:underline">{s.startShopping}</a> {s.noOrdersAfter}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border pb-2">
            {orders.map((o) => (
              <OrderCard key={o.id} order={o} locale={locale} s={s} warrantyItems={warrantyByOrder.get(o.id) ?? []} />
            ))}
          </ul>
        )}
        {total > orders.length ? (
          <p className="px-5 pb-4 text-xs text-text-muted">
            {interpolate(s.recentShownBefore, { count: orders.length })}{" "}
            <a href="/track" className="font-semibold text-brand-700 hover:underline">{s.trackLink}</a> {s.recentShownAfter}
          </p>
        ) : null}
      </section>

      <ReturnsSection
        orders={orders.map((o) => ({ id: o.id, orderNo: o.orderNo, status: o.status }))}
      />

      <DownloadsSection />

      {myCourses.length > 0 ? (
        <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card" aria-label={s.myCourses}>
          <h2 className="flex items-center gap-2.5 text-base font-bold text-text-main">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white text-sm"
            >
              ▶
            </span>
            {s.myCourses}
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            {interpolate(s.myCoursesDesc, { count: myCourses.length })}
          </p>
          <p className="mt-3">
            <a href="/account/courses" className="font-semibold text-brand-700 hover:underline">
              {s.myCoursesCta}
            </a>
          </p>
        </section>
      ) : null}

      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card" aria-label={s.supportTickets}>
        <h2 className="text-base font-bold text-text-main">{s.supportTickets}</h2>
        <p className="mt-1.5 text-sm leading-6 text-text-muted">
          {s.supportTicketsDesc}
        </p>
        <a
          href="/account/tickets"
          className="mt-3 inline-block rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-text-main transition hover:bg-surface-2"
        >
          {s.supportTicketsCta}
        </a>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card" aria-label={s.savedAddresses}>
        <h2 className="text-base font-bold text-text-main">{s.savedAddresses}</h2>
        <div className="mt-3">
          <AddressManager addresses={addresses} />
        </div>
      </section>

      <PrivacySection
        proofKind={
          customer.hasPassword
            ? "password"
            : normalizeBdPhone(customer.phone) !== null
              ? "otp"
              : "email"
        }
        phoneMasked={customer.phoneMasked}
        email={customer.email}
      />

      <ApiTokensSection />

      <section className="mt-6" aria-label={s.pushNotifications}>
        <PushSubscribeToggle />
      </section>
    </main>
  );
}

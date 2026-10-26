/**
 * Customer auth — server-side only.
 *
 * Mirrors the staff auth conventions in src/lib/auth.ts (same scrypt
 * password format via hashPassword/verifyPassword, same in-memory login
 * rate limiter, same failed-attempt lockout: 5 failures → 30-minute lock,
 * same DB-session pattern: random token in the cookie, only its SHA-256
 * hash in the DB). The differences are deliberate and load-bearing:
 *
 * - Customers live in the Customer table (the SAME row guest checkout
 *   find-or-creates by normalized phone in src/orders/repository.ts), so
 *   registering with a phone claims that row and every past guest order
 *   on it becomes the account's order history. No parallel user table.
 * - Sessions live in the separate CustomerSession table and the cookie
 *   is `customer_session` — a customer cookie can never act as an
 *   `admin_session` and vice versa.
 *
 * Never log a password or a session token. Every failure is generic:
 * responses never reveal whether a phone number is registered.
 */
import { randomBytes, createHash } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { normalizeBdPhone } from "@advance-ecommerce/validators";
import {
  hashPassword,
  verifyPassword,
  MAX_FAILED_LOGINS,
  ACCOUNT_LOCK_MINUTES,
  LAST_USED_WRITE_THROTTLE_MS,
} from "@/lib/auth";
import { maskPhone } from "@/checkout/validation";
import { qtyNumber } from "@/lib/quantity";
import { findDeliverySlot, loadDeliverySlots } from "@/checkout/delivery-slots";
import { emitAutomationEvent } from "@/automation/producers";
import { dispatchWebhookEvent } from "@/webhooks/dispatch";

export const CUSTOMER_SESSION_COOKIE = "customer_session";
export const CUSTOMER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Input validation (Zod) — phone is normalized to +8801XXXXXXXXX,    */
/* exactly like checkoutFormSchema does it.                           */
/* ------------------------------------------------------------------ */

const phoneField = z
  .string()
  .refine((v) => normalizeBdPhone(v) !== null, {
    message: "সঠিক বাংলাদেশি মোবাইল নম্বর দিন (01XXXXXXXXX)",
  })
  .transform((v) => normalizeBdPhone(v) as string);

export const customerRegisterSchema = z.object({
  name: z.string().trim().min(2, "নাম দিন").max(100),
  phone: phoneField,
  email: z.string().email("সঠিক ইমেইল দিন").optional().or(z.literal("")),
  password: z.string().min(8, "পাসওয়ার্ড অন্তত ৮ অক্ষরের হতে হবে").max(128),
});

export const customerLoginSchema = z.object({
  phone: phoneField,
  password: z.string().min(1).max(128),
});

export type CustomerRegisterInput = z.infer<typeof customerRegisterSchema>;
export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;

/** The only customer shape that ever leaves the server. */
export interface PublicCustomer {
  id: string;
  name: string;
  phone: string;
  phoneMasked: string;
  email: string | null;
  /** Whether a password credential exists. OTP / Google accounts are
   *  passwordless (ADV-15) — the account page shows sign-in methods
   *  from this flag instead of guessing. */
  hasPassword: boolean;
  createdAt: string;
}

export function toPublicCustomer(c: {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  passwordHash: string | null;
  createdAt: Date;
}): PublicCustomer {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    // A Google-first row carries a non-dialable placeholder phone key
    // (ADV-15, src/customer-auth/google.ts) — masking it would print
    // garbage digits, so it renders as "not added" instead.
    phoneMasked: normalizeBdPhone(c.phone) !== null ? maskPhone(c.phone) : "—",
    email: c.email,
    hasPassword: c.passwordHash !== null,
    createdAt: c.createdAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Registration — claims the guest Customer row for the phone if one  */
/* exists (checkout created it), otherwise creates a fresh row.       */
/* ------------------------------------------------------------------ */

export type RegisterResult =
  | { status: "ok"; customer: PublicCustomer }
  | { status: "failed" };

export async function registerCustomer(input: CustomerRegisterInput): Promise<RegisterResult> {
  const parsed = customerRegisterSchema.safeParse(input);
  if (!parsed.success) return { status: "failed" };
  const { name, phone, password } = parsed.data;
  const email = parsed.data.email ? parsed.data.email.toLowerCase() : null;

  const existing = await prisma.customer.findUnique({ where: { phone } });
  if (existing !== null) {
    // Already has an account, or the row is blocked/soft-deleted: one
    // generic failure — never reveal that the phone is registered.
    if (existing.passwordHash !== null || existing.blocked || existing.deletedAt !== null) {
      return { status: "failed" };
    }
    // Guest row from past checkouts: claim it. Orders stay attached
    // because they reference this row's id.
    const claimed = await prisma.customer.update({
      where: { id: existing.id },
      data: {
        name,
        ...(email !== null ? { email } : {}),
        passwordHash: hashPassword(password),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await fireCustomerRegistered(claimed.id);
    return { status: "ok", customer: toPublicCustomer(claimed) };
  }

  const created = await prisma.customer.create({
    data: { name, phone, email, passwordHash: hashPassword(password), tags: [] },
  });
  await fireCustomerRegistered(created.id);
  return { status: "ok", customer: toPublicCustomer(created) };
}

/**
 * Automation producer (schema wave 2): CUSTOMER_REGISTERED fires
 * exactly once per successful registration — the claim path and the
 * fresh-create path each call this once, after their write commits;
 * failed registrations return earlier and never reach it.
 * emitAutomationEvent never throws by contract; the extra guard
 * keeps a future regression there from ever failing a registration.
 * Awaited (it is one flag read + rule list + queue adds) so a
 * short-lived request process cannot drop the dispatch on exit.
 *
 * EXPORTED for the OTP path (src/customer-auth/otp.ts
 * findOrCreateCustomerForPhone), which calls it on account CREATION
 * only — an OTP login of an existing row is a login, not a
 * registration, and never fires it. One shared seam means both
 * registration paths fan out identically (automation rules +
 * ADV-26 webhooks + connectors via emitAutomationEvent).
 */
export async function fireCustomerRegistered(customerId: string): Promise<void> {
  try {
    await emitAutomationEvent("customer.registered", customerId);
  } catch {
    // Registration already succeeded — automation is downstream.
  }
  // Webhooks (ADV-26): same emit seam; the payload carries the
  // customer id + timestamp only — never phone/email. Never throws.
  await dispatchWebhookEvent("customer.registered", customerId);
}

/* ------------------------------------------------------------------ */
/* Login — mirrors staff lockout (5 failures → 30 min lock).          */
/* ------------------------------------------------------------------ */

export type AuthenticateCustomerResult =
  | { status: "ok"; customer: PublicCustomer }
  | { status: "failed" };

export async function authenticateCustomer(input: CustomerLoginInput): Promise<AuthenticateCustomerResult> {
  const parsed = customerLoginSchema.safeParse(input);
  if (!parsed.success) return { status: "failed" };
  const { phone, password } = parsed.data;

  const customer = await prisma.customer.findUnique({ where: { phone } });
  if (
    customer === null ||
    customer.passwordHash === null || // guest row, no account yet
    customer.blocked ||
    customer.deletedAt !== null
  ) {
    return { status: "failed" };
  }
  if (customer.lockedUntil !== null && customer.lockedUntil > new Date()) {
    return { status: "failed" };
  }
  if (!verifyPassword(password, customer.passwordHash)) {
    const failed = customer.failedLoginAttempts + 1;
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        failedLoginAttempts: failed,
        lockedUntil:
          failed >= MAX_FAILED_LOGINS
            ? new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60 * 1000)
            : null,
      },
    });
    return { status: "failed" };
  }

  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  return { status: "ok", customer: toPublicCustomer(updated) };
}

/* ------------------------------------------------------------------ */
/* Sessions — own table, own cookie. Only the SHA-256 hash of the     */
/* token is stored, exactly like staff sessions.                      */
/* ------------------------------------------------------------------ */

export function createCustomerSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashCustomerSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createCustomerSession(input: {
  customerId: string;
  userAgent?: string;
  ip?: string;
}): Promise<{ token: string }> {
  const token = createCustomerSessionToken();
  await prisma.customerSession.create({
    data: {
      customerId: input.customerId,
      tokenHash: hashCustomerSessionToken(token),
      userAgent: input.userAgent,
      ip: input.ip,
      expiresAt: new Date(Date.now() + CUSTOMER_SESSION_TTL_MS),
    },
  });
  return { token };
}

export async function validateCustomerSessionToken(token: string): Promise<PublicCustomer | null> {
  if (!token) return null;
  const session = await prisma.customerSession.findUnique({
    where: { tokenHash: hashCustomerSessionToken(token) },
    include: { customer: true },
  });
  if (session === null || session.revokedAt !== null || session.expiresAt < new Date()) {
    return null;
  }
  const c = session.customer;
  // NOTE (ADV-15): passwordless customers (phone-OTP / Google
  // sign-in) legitimately hold sessions — a session row is only ever
  // minted after a verified sign-in, so the old `passwordHash ===
  // null` rejection (written when password was the only credential)
  // would lock every OTP/Google customer out of their own session.
  // Blocked / soft-deleted rows stay rejected.
  if (c.blocked || c.deletedAt !== null) return null;
  // lastUsedAt is bookkeeping, not part of validation: refresh it at
  // most once per 5 minutes per session and never make validation
  // wait on (or fail because of) the write — same throttle as staff
  // sessions (src/lib/auth.ts).
  if (Date.now() - session.lastUsedAt.getTime() > LAST_USED_WRITE_THROTTLE_MS) {
    void prisma.customerSession
      .update({
        where: { id: session.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {});
  }
  return toPublicCustomer(c);
}

export async function revokeCustomerSession(token: string): Promise<void> {
  if (!token) return;
  await prisma.customerSession.updateMany({
    where: { tokenHash: hashCustomerSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Current logged-in customer for Route Handlers / Server Components.
 * Wrapped in React cache() so multiple server components in one
 * request share a single session validation instead of each paying
 * the DB lookup (per-request memo only; route-handler callers are
 * unaffected beyond the same dedupe).
 */
export const getCurrentCustomer = cache(
  async (): Promise<PublicCustomer | null> => {
    const store = await cookies();
    const token = store.get(CUSTOMER_SESSION_COOKIE)?.value;
    if (token === undefined || token === "") return null;
    return validateCustomerSessionToken(token);
  },
);

/** Cookie options shared by the login/register/logout routes. */
export function customerSessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    // Path "/": the account API lives under /api/v1/public/account and
    // the page under /account — the cookie must be sent to both.
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSeconds,
  };
}

/* ------------------------------------------------------------------ */
/* Rate limiting — one shared key for the customer auth routes. The   */
/* checks themselves run through the shared Redis-backed limiter      */
/* (src/lib/rate-limit.ts) in the login + register routes, both       */
/* counting against this key's single budget. (The in-memory trio     */
/* from src/lib/auth used to be re-exported here for the register     */
/* route; it was dropped in wave 54 when register migrated too, and   */
/* deleted entirely once the staff-side routes migrated as well.)    */
/* ------------------------------------------------------------------ */

export function customerLoginRateKey(ip: string, phone: string): string {
  return `cust-login:${ip}:${phone}`;
}

/* ------------------------------------------------------------------ */
/* Account data — used by the account API routes and the /account     */
/* server page. Orders are the customer's own (by customerId, which   */
/* is how past guest orders attach after registration). The phone in  */
/* each order row is returned masked, as on the public track route.   */
/* ------------------------------------------------------------------ */

export interface AccountOrderSummary {
  id: string;
  orderNo: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  totalPoisha: number;
  itemCount: number;
  firstItemName: string | null;
  phoneMasked: string;
  createdAt: string;
  /** The persisted delivery-slot id (Order.deliverySlot), or null
   *  when the customer picked none / the id was dropped at create. */
  deliverySlot: string | null;
  /** The slot's CURRENT Bangla label, resolved from the configured
   *  set (labels are presentation; the id is the durable fact) —
   *  null when there is no slot or the id is no longer configured.
   *  Feeds the account order card's slot chip (doc 21 G3-19). */
  deliverySlotLabel: string | null;
}

export async function listCustomerOrders(
  customerId: string,
  page: number,
  pageSize: number,
): Promise<{ orders: AccountOrderSummary[]; total: number }> {
  const [rows, total, slots] = await Promise.all([
    prisma.order.findMany({
      where: { customerId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { items: { select: { productName: true, quantity: true } } },
    }),
    prisma.order.count({ where: { customerId, deletedAt: null } }),
    loadDeliverySlots(),
  ]);
  return {
    total,
    orders: rows.map((o) => ({
      id: o.id,
      orderNo: o.orderNo,
      status: o.status,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      totalPoisha: o.totalPoisha,
      itemCount: o.items.reduce((sum, i) => sum + qtyNumber(i.quantity), 0),
      firstItemName: o.items[0]?.productName ?? null,
      phoneMasked: maskPhone(o.customerPhone),
      createdAt: o.createdAt.toISOString(),
      deliverySlot: o.deliverySlot ?? null,
      deliverySlotLabel: findDeliverySlot(slots, o.deliverySlot)?.labelBn ?? null,
    })),
  };
}

export interface AccountAddress {
  id: string;
  label: string | null;
  division: string;
  district: string;
  upazila: string;
  union: string | null;
  addressLine: string;
  isDefault: boolean;
}

export async function listCustomerAddresses(customerId: string): Promise<AccountAddress[]> {
  const rows = await prisma.address.findMany({
    where: { customerId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return rows.map((a) => ({
    id: a.id,
    label: a.label,
    division: a.division,
    district: a.district,
    upazila: a.upazila,
    union: a.union,
    addressLine: a.addressLine,
    isDefault: a.isDefault,
  }));
}

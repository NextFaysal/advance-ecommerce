/**
 * Customer API tokens — the bearer-token auth seam for the public
 * account API, and the prerequisite the customer-app decision named
 * for any native customer app (apps/customer-app/README.md).
 *
 * Until this module, customer identity on /api/v1/public/* was the
 * HttpOnly `customer_session` cookie ONLY — a native app cannot use
 * an HttpOnly web cookie as its session. Customers now mint their
 * own long-lived API tokens from /account (API টোকেন card) and
 * present them as `Authorization: Bearer ae_cust_…`; the shared
 * requireCustomer() helper in src/customer-auth/http.ts accepts a
 * valid token anywhere the cookie works.
 *
 * STORAGE — a real table (CustomerApiToken), NOT a Setting doc.
 * Precedent: CustomerSession and the partner ApiKey are tables with
 * exactly this shape (hash-only at rest, revokedAt, lastUsedAt).
 * Tokens are per-customer and unbounded across customers (the SMS
 * device tokens could be a doc only because they are install-global
 * and capped at 20). Multiple tokens per customer, each labelled
 * (phone app, personal script, …) and individually revocable.
 *
 * SECRETS DISCIPLINE (mirrors src/bd/devices.ts + ApiKey):
 *  - Plaintext exists exactly twice: in the create response (shown
 *    to the customer ONCE) and on the customer's device. At rest we
 *    keep ONLY the SHA-256 hex (`tokenHash`), which never leaves
 *    this module — list/read APIs return CustomerApiTokenView.
 *  - Lookup is findUnique on the unique tokenHash (the session /
 *    ApiKey pattern), so no timing oracle over stored hashes.
 *  - NO scheduled expiry: revocation is the off-switch, like the
 *    partner API keys. A leaked token is killed from /account.
 *
 * AUTH RULES (the bd-devices precedent, enforced in http.ts):
 *  - A PRESENTED Authorization header decides alone: invalid,
 *    revoked or malformed → 401, NEVER a silent fallback to the
 *    cookie (a fallback would let a revoked token's request through
 *    on any stray browser cookie).
 *  - No header → the cookie path, byte-identical to before.
 *  - Token MANAGEMENT (list/create/revoke) is cookie-session ONLY —
 *    a bearer token can never mint or revoke tokens, so a leaked
 *    token cannot lock the customer out of their own recovery path
 *    or extend itself.
 *
 * lastUsedAt THROTTLING: stamped at most once per hour per token
 * (API_TOKEN_LAST_USED_THROTTLE_MS), best-effort and fire-and-forget
 * like session lastUsedAt — a native app may call the API per screen,
 * and the stamp is bookkeeping, never part of validation.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { toPublicCustomer, type PublicCustomer } from "./auth";

export const CUSTOMER_API_TOKEN_PREFIX = "ae_cust_";

/** Max simultaneously ACTIVE (non-revoked) tokens per customer. */
export const MAX_CUSTOMER_API_TOKENS = 10;

export const API_TOKEN_LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

/** How many rows the management list returns (newest first). */
const LIST_LIMIT = 50;

/** Browser-safe projection — deliberately has NO tokenHash. */
export interface CustomerApiTokenView {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked";
}

interface CustomerApiTokenRow {
  id: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export function toCustomerApiTokenView(row: CustomerApiTokenRow): CustomerApiTokenView {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    status: row.revokedAt ? "revoked" : "active",
  };
}

export function hashCustomerApiToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** `ae_cust_` + 256 bits of entropy, base64url (43 chars) — the
 *  ae_dev_ device-token shape, customer prefix. */
export function generateCustomerApiToken(): string {
  return CUSTOMER_API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/** Extract the bearer token from an Authorization header value.
 *  Returns null for anything that is not `Bearer ae_cust_…`. */
export function parseCustomerBearer(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const token = (match[1] ?? "").trim();
  return token.startsWith(CUSTOMER_API_TOKEN_PREFIX) && token.length > CUSTOMER_API_TOKEN_PREFIX.length
    ? token
    : null;
}

/* ------------------------------------------------------------------ */
/* Authentication — called by requireCustomer() (src/customer-auth/  */
/* http.ts) when an Authorization header is present. Returns the     */
/* customer the token belongs to, or null for unknown / revoked /    */
/* blocked / soft-deleted (ONE generic null — no oracle about which  */
/* check failed, same as session validation).                        */
/* ------------------------------------------------------------------ */

export async function validateCustomerApiToken(token: string): Promise<PublicCustomer | null> {
  if (!token) return null;
  const row = await prisma.customerApiToken.findUnique({
    where: { tokenHash: hashCustomerApiToken(token) },
    include: { customer: true },
  });
  if (row === null || row.revokedAt !== null) return null;
  const c = row.customer;
  // Same account-state gate as customer sessions: a blocked or
  // soft-deleted customer's credentials stop working everywhere.
  if (c.blocked || c.deletedAt !== null) return null;
  // lastUsedAt is bookkeeping, not part of validation: refresh at
  // most once per hour per token, never awaited, never fatal.
  if (
    row.lastUsedAt === null ||
    Date.now() - row.lastUsedAt.getTime() > API_TOKEN_LAST_USED_THROTTLE_MS
  ) {
    void prisma.customerApiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }
  return toPublicCustomer(c);
}

/* ------------------------------------------------------------------ */
/* Management — cookie-session ONLY at the route layer.              */
/* ------------------------------------------------------------------ */

export class CustomerApiTokenLimitError extends Error {
  constructor() {
    super(`At most ${MAX_CUSTOMER_API_TOKENS} active API tokens are allowed per customer.`);
    this.name = "CustomerApiTokenLimitError";
  }
}

export async function listCustomerApiTokens(customerId: string): Promise<CustomerApiTokenView[]> {
  const rows = await prisma.customerApiToken.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
    select: { id: true, label: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
  return rows.map(toCustomerApiTokenView);
}

/**
 * Create a token for the customer. Returns the stored view AND the
 * plaintext token — the ONLY time the plaintext exists server-side.
 * Enforces the active-token cap (revoked tokens do not count).
 */
export async function createCustomerApiToken(
  customerId: string,
  label: string,
): Promise<{ view: CustomerApiTokenView; token: string }> {
  const active = await prisma.customerApiToken.count({
    where: { customerId, revokedAt: null },
  });
  if (active >= MAX_CUSTOMER_API_TOKENS) throw new CustomerApiTokenLimitError();
  const token = generateCustomerApiToken();
  const row = await prisma.customerApiToken.create({
    data: { customerId, label, tokenHash: hashCustomerApiToken(token) },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
  return { view: toCustomerApiTokenView(row), token };
}

export type RevokeCustomerApiTokenResult =
  | { result: "revoked"; view: CustomerApiTokenView }
  | { result: "not_found" }
  | { result: "already_revoked" };

/**
 * Revoke one of the customer's own tokens. Ownership is checked
 * BEFORE the revoked state: an id that belongs to another customer
 * is "not_found" (the route answers 404 — existence is never leaked
 * across customers), an own already-revoked token is
 * "already_revoked" (route answers 409, the bd-devices precedent —
 * no silent no-op success).
 */
export async function revokeCustomerApiToken(
  customerId: string,
  id: string,
): Promise<RevokeCustomerApiTokenResult> {
  const row = await prisma.customerApiToken.findUnique({
    where: { id },
    select: { customerId: true, revokedAt: true },
  });
  if (row === null || row.customerId !== customerId) return { result: "not_found" };
  if (row.revokedAt !== null) return { result: "already_revoked" };
  const updated = await prisma.customerApiToken.update({
    where: { id },
    data: { revokedAt: new Date() },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true, revokedAt: true },
  });
  return { result: "revoked", view: toCustomerApiTokenView(updated) };
}

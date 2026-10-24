/**
 * Staff auth — server-side only.
 *
 * Call these functions only from Route Handlers / Server Actions, never from
 * client components, and never log a password, OTP, TOTP secret, or session
 * token. Route Handlers (not part of this file) are responsible for setting
 * the httpOnly admin session cookie after a successful login / 2FA step.
 *
 * Password storage: Node scrypt (salted, timing-safe verify). If the project
 * later adds argon2, swap only hashPassword/verifyPassword — callers stay
 * the same. Stored hashes are versioned by their `scrypt:` prefix.
 */
import { randomBytes, scryptSync, timingSafeEqual, createHash, createHmac, createCipheriv, createDecipheriv } from "node:crypto";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { normalizeBdPhone } from "@advance-ecommerce/validators";

/* ------------------------------------------------------------------ */
/* Input validation (Zod) — every auth input goes through these.      */
/* ------------------------------------------------------------------ */

export const staffLoginSchema = z.object({
  identifier: z.string().min(3).max(254),
  password: z.string().min(8).max(128),
});

export const totpVerifySchema = z.object({
  // The pending-user reference must come from a server-set httpOnly cookie
  // created by the login Route Handler, never from localStorage / a URL param.
  pendingUserId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "6-digit code required"),
});

export const otpRequestSchema = z.object({
  phone: z.string().min(11).max(15),
  purpose: z.enum(["LOGIN", "PASSWORD_RESET", "PHONE_VERIFY"]),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
}).refine((v) => v.email !== undefined || v.phone !== undefined, {
  message: "email or phone is required",
});

export type StaffLoginInput = z.infer<typeof staffLoginSchema>;

/* ------------------------------------------------------------------ */
/* Password hashing                                                    */
/* ------------------------------------------------------------------ */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, expected] = parts;
  const actual = scryptSync(password, salt as string, 64);
  const expectedBuf = Buffer.from(expected as string, "hex");
  if (actual.length !== expectedBuf.length) return false;
  return timingSafeEqual(actual, expectedBuf);
}

/* ------------------------------------------------------------------ */
/* Session tokens — only the SHA-256 hash is stored in the DB.        */
/* ------------------------------------------------------------------ */

export function createSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const STAFF_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createSession(input: {
  userId: string;
  userAgent?: string;
  ip?: string;
  deviceName?: string;
}) {
  const token = createSessionToken();
  const session = await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashSessionToken(token),
      userAgent: input.userAgent,
      ip: input.ip,
      deviceName: input.deviceName,
      expiresAt: new Date(Date.now() + STAFF_SESSION_TTL_MS),
    },
  });
  return { session, token };
}

export async function validateSessionToken(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
    },
  });
  if (!session || session.revokedAt !== null || session.expiresAt < new Date()) {
    return null;
  }
  if (!session.user || session.user.isActive !== true || session.user.deletedAt !== null) {
    return null;
  }
  await prisma.session.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });
  return {
    sessionId: session.id,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      phone: session.user.phone,
      roleId: session.user.roleId,
      roleName: session.user.role?.name ?? null,
      locale: session.user.locale,
      twoFactorEnabled: session.user.twoFactorEnabled,
      permissions: session.user.role?.permissions.map((rp) => rp.permission.key) ?? [],
    },
  };
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof validateSessionToken>>>["user"];

export async function listSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    select: { id: true, deviceName: true, userAgent: true, ip: true, lastUsedAt: true, createdAt: true },
  });
}

export async function revokeSession(sessionId: string, userId: string) {
  await prisma.session.updateMany({
    where: { id: sessionId, userId },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

/* ------------------------------------------------------------------ */
/* Rate limiting — local-dev in-memory fallback.                       */
/* Production / multi-instance deployments MUST swap this for Redis   */
/* (REDIS_URL), keyed the same way, before Step 34 hardening. The     */
/* interface is deliberately Redis-shaped so the swap is one file.     */
/* ------------------------------------------------------------------ */

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function checkLoginRateLimit(key: string, maxAttempts = 5, windowSeconds = 900): RateLimitResult {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (entry !== undefined && entry.resetAt < now) loginAttempts.delete(key);
  const current = loginAttempts.get(key);
  if (current !== undefined && current.count >= maxAttempts) {
    return { allowed: false, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordLoginAttempt(key: string, windowSeconds = 900): void {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (entry === undefined || entry.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
  } else {
    entry.count += 1;
  }
}

export function resetLoginRateLimit(key: string): void {
  loginAttempts.delete(key);
}

/* ------------------------------------------------------------------ */
/* Staff login                                                         */
/* ------------------------------------------------------------------ */

export const MAX_FAILED_LOGINS = 5;
export const ACCOUNT_LOCK_MINUTES = 30;

export type AuthenticateResult =
  | { status: "ok"; userId: string }
  | { status: "needs_2fa"; userId: string }
  | { status: "failed" };

export async function authenticateStaff(
  input: StaffLoginInput,
  meta: { ip?: string; userAgent?: string },
): Promise<AuthenticateResult> {
  const parsed = staffLoginSchema.safeParse(input);
  if (!parsed.success) return { status: "failed" };
  const { identifier, password } = parsed.data;

  // Generic failure everywhere: never reveal whether the identifier exists.
  const normalizedPhone = normalizeBdPhone(identifier);
  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      isActive: true,
      ...(normalizedPhone !== null
        ? { phone: normalizedPhone }
        : { email: identifier.toLowerCase() }),
    },
  });

  const logAttempt = async (success: boolean, reason?: string) => {
    await prisma.loginHistory.create({
      data: {
        userId: user?.id ?? null,
        email: normalizedPhone === null ? identifier.toLowerCase() : null,
        phone: normalizedPhone,
        ip: meta.ip,
        userAgent: meta.userAgent,
        success,
        reason,
      },
    });
  };

  if (user === null) {
    await logAttempt(false, "identifier_not_found");
    return { status: "failed" };
  }
  if (user.lockedUntil !== null && user.lockedUntil > new Date()) {
    await logAttempt(false, "account_locked");
    return { status: "failed" };
  }
  if (!verifyPassword(password, user.passwordHash)) {
    const failed = user.failedLoginAttempts + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60 * 1000) : null,
      },
    });
    await logAttempt(false, "wrong_password");
    return { status: "failed" };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await logAttempt(true);
  return user.twoFactorEnabled ? { status: "needs_2fa", userId: user.id } : { status: "ok", userId: user.id };
}

/* ------------------------------------------------------------------ */
/* Auth-secret encryption — AES-256-GCM, same envelope format as      */
/* settings.ts (`v1:<iv-hex>:<tag-hex>:<cipher-hex>`), but a DEDICATED */
/* key: AUTH_ENCRYPTION_KEY (64 hex chars / 32 bytes, server env       */
/* only, never committed). A dedicated key keeps credential material   */
/* in its own blast radius: rotating or leaking the settings key      */
/* does not touch TOTP secrets or cookie signing, and vice versa.     */
/* Missing/invalid key THROWS — a secret is never stored plaintext    */
/* because the key was absent. See SECURITY-NOTES.md.                 */
/* ------------------------------------------------------------------ */

function authEncryptionKey(): Buffer {
  const raw = process.env.AUTH_ENCRYPTION_KEY;
  if (raw === undefined || raw === "") {
    throw new Error("AUTH_ENCRYPTION_KEY is not set — refusing to encrypt or decrypt an auth secret. Set it in .env.local (64 hex chars).");
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) throw new Error("AUTH_ENCRYPTION_KEY must be 32 bytes (64 hex chars).");
  return key;
}

export const TOTP_SECRET_ENVELOPE_PREFIX = "v1:";

export function isEncryptedTotpSecret(stored: string): boolean {
  return stored.startsWith(TOTP_SECRET_ENVELOPE_PREFIX);
}

/** Encrypt a base32 TOTP secret for storage in User.twoFactorSecret. */
export function encryptTotpSecret(secretBase32: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", authEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt an envelope produced by encryptTotpSecret(). Throws on a
 * malformed envelope, a tampered ciphertext/tag (GCM auth failure), or
 * a missing/invalid AUTH_ENCRYPTION_KEY — callers on the verify path
 * must catch and fail closed.
 */
export function decryptTotpSecret(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unsupported encrypted TOTP secret format.");
  const [, ivHex, tagHex, cipherHex] = parts;
  const decipher = createDecipheriv("aes-256-gcm", authEncryptionKey(), Buffer.from(ivHex as string, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex as string, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(cipherHex as string, "hex")), decipher.final()]).toString("utf8");
}

/**
 * Resolve a stored User.twoFactorSecret to the base32 secret.
 * - Envelope (`v1:` prefix) → decrypted; any failure returns null
 *   (fail closed — verifyTotp then rejects the code).
 * - Anything else is a LEGACY plaintext secret enrolled before
 *   encryption landed. A base32 secret can never contain ":" or
 *   lowercase, so prefix detection cannot misfire. Legacy values keep
 *   working until the user re-enrols (enrolment always stores the
 *   envelope); see SECURITY-NOTES.md for the migration note.
 * The secret itself is never logged, including via error messages.
 */
function resolveTotpSecret(stored: string): string | null {
  if (!isEncryptedTotpSecret(stored)) return stored;
  try {
    return decryptTotpSecret(stored);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* TOTP (RFC 6238) — HMAC-SHA1, 30s step, ±1 window.                    */
/* Secrets are generated base32, stored ENCRYPTED (envelope above)    */
/* via enrollTotpSecret(), and decrypted only in-memory on verify.    */
/* ------------------------------------------------------------------ */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[^A-Z2-7]/gi, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value < 0) continue;
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotp(secretBase32: string, atMs = Date.now()): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(atMs / 30000);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = (hmac[hmac.length - 1] as number) & 0x0f;
  const code =
    (((hmac[offset] as number) & 0x7f) << 24) |
    (((hmac[offset + 1] as number) & 0xff) << 16) |
    (((hmac[offset + 2] as number) & 0xff) << 8) |
    ((hmac[offset + 3] as number) & 0xff);
  return String(code % 1000000).padStart(6, "0");
}

/** Pure code check against a resolved base32 secret (±1 step window). */
export function verifyTotpCode(secretBase32: string, code: string, atMs = Date.now()): boolean {
  for (const step of [-1, 0, 1]) {
    if (generateTotp(secretBase32, atMs + step * 30000) === code) return true;
  }
  return false;
}

export async function verifyTotp(userId: string, code: string): Promise<boolean> {
  const parsed = totpVerifySchema.safeParse({ pendingUserId: userId, code });
  if (!parsed.success) return false;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user === null || !user.twoFactorEnabled || user.twoFactorSecret === null) return false;
  // Stored value may be an encrypted envelope (current) or a legacy
  // plaintext secret — resolveTotpSecret handles both, and an envelope
  // that cannot be decrypted fails closed (null → reject the code).
  const secret = resolveTotpSecret(user.twoFactorSecret);
  if (secret === null) return false;
  return verifyTotpCode(secret, code);
}

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)] as string;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* TOTP enrolment — the ONLY write path for User.twoFactorSecret.     */
/* The generated secret is returned to the caller exactly once (so it  */
/* can be shown as a QR / manual key to the staff member) and stored   */
/* ONLY as an encrypted envelope. Never write the plain secret to the  */
/* DB, a log, or an audit record. Any enrolment UI/route must call    */
/* these helpers — see SECURITY-NOTES.md.                             */
/* ------------------------------------------------------------------ */

export async function enrollTotpSecret(userId: string): Promise<{ secretBase32: string }> {
  const secretBase32 = generateTotpSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: encryptTotpSecret(secretBase32) },
  });
  return { secretBase32 };
}

/**
 * Confirm a pending enrolment with the user's first code; only then is
 * twoFactorEnabled set. Returns false for a wrong code, a missing or
 * undecryptable secret — the caller shows the generic 2FA error.
 */
export async function confirmTotpEnrollment(userId: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user === null || user.twoFactorSecret === null) return false;
  const secret = resolveTotpSecret(user.twoFactorSecret);
  if (secret === null) return false;
  if (!verifyTotpCode(secret, code)) return false;
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });
  return true;
}

/* ------------------------------------------------------------------ */
/* Pending-2FA cookie — the login handler parks the pending user id   */
/* in a short-lived httpOnly cookie between the password step and     */
/* the TOTP step. The value is SIGNED (HMAC-SHA256), never trusted    */
/* unsigned: format `v1.<base64url payload>.<base64url signature>`,  */
/* payload = { uid, exp } with a 10-minute expiry matching the        */
/* cookie maxAge. The signing key is a domain-separated subkey        */
/* derived from AUTH_ENCRYPTION_KEY, so the raw encryption key is     */
/* never used directly as a MAC key. signPending2fa THROWS when the   */
/* key is missing/invalid (login must fail, not issue an unsigned     */
/* cookie); verifyPending2fa fails closed (null) on a tampered,       */
/* expired, or unverifiable value — including every cookie issued     */
/* before this signing landed, which simply sends the user back to    */
/* the password step. See SECURITY-NOTES.md.                          */
/* ------------------------------------------------------------------ */

export const PENDING_2FA_TTL_SECONDS = 600;

function pending2faSigningKey(): Buffer {
  return createHmac("sha256", authEncryptionKey())
    .update("advance-ecommerce:pending-2fa-cookie:v1")
    .digest();
}

export function signPending2fa(userId: string, nowMs = Date.now()): string {
  const payloadJson = JSON.stringify({
    uid: userId,
    exp: Math.floor(nowMs / 1000) + PENDING_2FA_TTL_SECONDS,
  });
  const payload = Buffer.from(payloadJson, "utf8").toString("base64url");
  const signature = createHmac("sha256", pending2faSigningKey())
    .update(`v1.${payload}`)
    .digest("base64url");
  return `v1.${payload}.${signature}`;
}

export function verifyPending2fa(cookieValue: string | undefined, nowMs = Date.now()): string | null {
  if (cookieValue === undefined || cookieValue === "") return null;
  const parts = cookieValue.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const payloadPart = parts[1] as string;
  const signaturePart = parts[2] as string;
  let expected: Buffer;
  try {
    expected = createHmac("sha256", pending2faSigningKey()).update(`v1.${payloadPart}`).digest();
  } catch {
    return null; // key missing/invalid — fail closed
  }
  const actual = Buffer.from(signaturePart, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;
  const { uid, exp } = payload as { uid?: unknown; exp?: unknown };
  if (typeof uid !== "string" || uid === "") return null;
  if (typeof exp !== "number" || exp <= Math.floor(nowMs / 1000)) return null;
  return uid;
}

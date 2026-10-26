/**
 * Staff passkeys (WebAuthn) — doc 23 wave 55, staff-first.
 *
 * Passkey sign-in sits ALONGSIDE password login for staff accounts; it
 * never replaces it (a staff member with no passkey, or on a browser
 * without WebAuthn, uses the password flow exactly as before). Like
 * TOTP enrolment, passkeys are always available to staff — no feature
 * flag — because they are a per-account credential, not a module.
 *
 * Ceremony rules implemented here (SimpleWebAuthn v14):
 *  - Registration requires an authenticated staff session (the routes
 *    guard with requireSelfSession) and user verification, so every
 *    stored credential is a multi-factor credential (possession of the
 *    authenticator + biometric/PIN at use time).
 *  - A verified passkey assertion therefore completes login in one
 *    step: the ceremony itself is two-factor, so accounts with TOTP
 *    enabled are NOT sent through the extra TOTP step after a passkey
 *    login. This mirrors how the password path treats a verified
 *    second factor as completing the login (verify-2fa creates the
 *    session directly).
 *  - Challenges are single-use, 5-minute, and stored through
 *    src/lib/redis (Redis when configured, in-process fallback like
 *    the rest of the codebase) under `webauthn:challenge:*` keys.
 *  - On success the routes create the session via the SAME
 *    createSession() the password + verify-2fa routes use — there is
 *    no second session kind. The ADV-28 login-alert hooks fire here
 *    with the same semantics as authenticateStaff: new-IP success
 *    alerts on success, failure-burst tracking on failure, and a
 *    LoginHistory row either way. Account lockout (lockedUntil, set
 *    by repeated PASSWORD failures) also blocks passkey login — a
 *    locked account is locked, whichever door it knocks on. Passkey
 *    failures themselves do NOT increment failedLoginAttempts: that
 *    counter exists to slow password guessing, and a failed assertion
 *    almost always means "wrong device / cancelled prompt", not an
 *    attack — the burst alert still records the attempt.
 *  - RP config comes from NEXT_PUBLIC_APP_URL (rpID = its hostname,
 *    expected origin = its origin) and the store name setting. When
 *    the app URL is unset in production the module fails CLOSED:
 *    builders return "not_configured" and the routes answer 503
 *    PASSKEY_NOT_CONFIGURED rather than guessing an RP ID (a wrong
 *    RP ID silently breaks every ceremony or, worse, binds
 *    credentials to the wrong origin).
 *
 * The credential id and public key stored in StaffWebAuthnCredential
 * are public material — the private key never leaves the
 * authenticator — so neither is ever redacted or treated as a secret;
 * challenges, by contrast, are never logged or returned twice.
 */
import { prisma } from "@advance-ecommerce/db";
import { normalizeBdPhone } from "@advance-ecommerce/validators";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getSetting } from "@/lib/settings";
import {
  getCachedValue,
  invalidateCacheKey,
  setCachedValue,
} from "@/lib/redis";
import {
  recordFailedAttempt,
  recordNewIpSuccessIfUnseen,
} from "@/security/login-alerts";

export const PASSKEY_CHALLENGE_TTL_SECONDS = 300;

const challengeKey = (kind: "register" | "login", userId: string) =>
  `webauthn:challenge:${kind}:${userId}`;

/* ------------------------------------------------------------------ */
/* RP configuration                                                    */
/* ------------------------------------------------------------------ */

export interface RpConfig {
  rpID: string;
  origin: string;
  rpName: string;
}

/**
 * Resolve the relying-party config, or null when passkeys are not
 * configured on this deployment (production without
 * NEXT_PUBLIC_APP_URL, or an unparseable value). Non-production
 * falls back to the usual local dev origin so the ceremony can be
 * exercised on localhost.
 */
export async function getRpConfig(): Promise<RpConfig | null> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  let url: URL;
  if (appUrl !== undefined && appUrl !== "") {
    try {
      url = new URL(appUrl);
    } catch {
      return null;
    }
  } else if (process.env.NODE_ENV !== "production") {
    url = new URL("http://localhost:3000");
  } else {
    return null;
  }
  const storeName = (await getSetting("general.store_name").catch(() => null))?.trim();
  return {
    rpID: url.hostname,
    origin: url.origin,
    rpName: storeName !== undefined && storeName !== null && storeName !== "" ? storeName : "Advance Ecommerce",
  };
}

/* ------------------------------------------------------------------ */
/* Stored-credential helpers                                          */
/* ------------------------------------------------------------------ */

function parseTransports(stored: string | null): string[] | undefined {
  if (stored === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (Array.isArray(parsed) && parsed.every((t) => typeof t === "string")) {
      return parsed as string[];
    }
  } catch {
    // Corrupt transports degrade to "unspecified" — the ceremony
    // still works, the browser just gets no transport hints.
  }
  return undefined;
}

export interface PasskeySummary {
  id: string;
  credentialId: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** The signed-in staff member's own passkeys (management list). */
export async function listPasskeys(userId: string): Promise<PasskeySummary[]> {
  const rows = await prisma.staffWebAuthnCredential.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true, credentialId: true, deviceLabel: true, createdAt: true, lastUsedAt: true },
  });
  return rows.map((row) => ({
    id: row.id,
    credentialId: row.credentialId,
    deviceLabel: row.deviceLabel,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));
}

/** Delete one of the caller's OWN passkeys. Returns false when the
 * row does not exist or belongs to someone else (same answer either
 * way — no cross-account existence leak). */
export async function deletePasskey(userId: string, credentialRowId: string): Promise<boolean> {
  const result = await prisma.staffWebAuthnCredential.deleteMany({
    where: { id: credentialRowId, userId },
  });
  return result.count > 0;
}

/* ------------------------------------------------------------------ */
/* Registration ceremony                                               */
/* ------------------------------------------------------------------ */

export type RegistrationOptionsResult =
  | { status: "ok"; options: Awaited<ReturnType<typeof generateRegistrationOptions>> }
  | { status: "not_configured" }
  | { status: "no_user" };

export async function buildRegistrationOptions(userId: string): Promise<RegistrationOptionsResult> {
  const rp = await getRpConfig();
  if (rp === null) return { status: "not_configured" };
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, phone: true, name: true },
  });
  if (user === null) return { status: "no_user" };
  const existing = await prisma.staffWebAuthnCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });
  const options = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: user.email ?? user.phone ?? user.id,
    userDisplayName: user.name ?? undefined,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((cred) => ({
      id: cred.credentialId,
      transports: parseTransports(cred.transports),
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "required",
    },
  });
  await setCachedValue(challengeKey("register", userId), options.challenge, PASSKEY_CHALLENGE_TTL_SECONDS);
  return { status: "ok", options };
}

export type RegistrationVerifyResult =
  | { status: "ok"; credentialRowId: string; credentialId: string }
  | { status: "not_configured" }
  | { status: "failed" };

export async function verifyAndStoreRegistration(input: {
  userId: string;
  response: RegistrationResponseJSON;
  deviceLabel: string;
}): Promise<RegistrationVerifyResult> {
  const rp = await getRpConfig();
  if (rp === null) return { status: "not_configured" };
  const key = challengeKey("register", input.userId);
  const expectedChallenge = await getCachedValue(key);
  // One attempt per challenge, whatever the outcome — replaying a
  // captured ceremony response must never get a second chance.
  await invalidateCacheKey(key);
  if (expectedChallenge === null) return { status: "failed" };
  let verified = false;
  let credential: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] } | undefined;
  try {
    const result = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
    verified = result.verified;
    credential = result.registrationInfo?.credential;
  } catch {
    verified = false;
  }
  if (!verified || credential === undefined) return { status: "failed" };
  const transports = credential.transports ?? input.response.response.transports;
  const row = await prisma.staffWebAuthnCredential.create({
    data: {
      userId: input.userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64"),
      counter: credential.counter,
      transports: transports !== undefined && transports.length > 0 ? JSON.stringify(transports) : null,
      deviceLabel: input.deviceLabel,
    },
    select: { id: true, credentialId: true },
  });
  return { status: "ok", credentialRowId: row.id, credentialId: row.credentialId };
}

/* ------------------------------------------------------------------ */
/* Authentication (login) ceremony                                      */
/* ------------------------------------------------------------------ */

/**
 * Resolve a staff account by login identifier with EXACTLY the
 * semantics of authenticateStaff: a BD-phone-shaped identifier looks
 * up by normalised phone, anything else by lowercased email; only
 * live (not deleted, active) accounts match.
 */
async function findStaffByIdentifier(identifier: string) {
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
  return { user, normalizedPhone };
}

/** Canonical alert-bucket identifier, same form authenticateStaff uses. */
function alertIdentifierFor(identifier: string, normalizedPhone: string | null): string {
  return normalizedPhone ?? identifier.toLowerCase();
}

export type AuthenticationOptionsResult =
  | { status: "ok"; options: Awaited<ReturnType<typeof generateAuthenticationOptions>> }
  | { status: "not_configured" };

/**
 * Build authentication options for an identifier. Unknown
 * identifiers and accounts without passkeys get indistinguishable
 * options (empty allowCredentials, challenge parked under a
 * throwaway key their verify can never consume) — the response never
 * reveals whether the account or any passkey exists.
 */
export async function buildAuthenticationOptions(identifier: string): Promise<AuthenticationOptionsResult> {
  const rp = await getRpConfig();
  if (rp === null) return { status: "not_configured" };
  const { user } = await findStaffByIdentifier(identifier);
  const credentials =
    user === null
      ? []
      : await prisma.staffWebAuthnCredential.findMany({
          where: { userId: user.id },
          select: { credentialId: true, transports: true },
        });
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: credentials.map((cred) => ({
      id: cred.credentialId,
      transports: parseTransports(cred.transports),
    })),
    userVerification: "required",
  });
  await setCachedValue(
    challengeKey("login", user?.id ?? `anon:${identifier.toLowerCase()}`),
    options.challenge,
    PASSKEY_CHALLENGE_TTL_SECONDS,
  );
  return { status: "ok", options };
}

export type AuthenticationVerifyResult =
  | { status: "ok"; userId: string }
  | { status: "failed" };

export async function verifyAuthentication(input: {
  response: AuthenticationResponseJSON;
  ip?: string;
  userAgent?: string;
}): Promise<AuthenticationVerifyResult> {
  const rp = await getRpConfig();
  if (rp === null) return { status: "failed" };
  const row = await prisma.staffWebAuthnCredential.findUnique({
    where: { credentialId: input.response.id },
    include: { user: true },
  });
  if (row === null) return { status: "failed" };
  const user = row.user;
  const identifierForAlerts = user.email ?? user.phone ?? user.id;

  const logAttempt = async (success: boolean, reason?: string) => {
    await prisma.loginHistory.create({
      data: {
        userId: user.id,
        email: user.email,
        phone: user.phone,
        ip: input.ip,
        userAgent: input.userAgent,
        success,
        reason,
      },
    });
  };

  if (user.deletedAt !== null || !user.isActive) {
    await logAttempt(false, "account_inactive");
    return { status: "failed" };
  }
  if (user.lockedUntil !== null && user.lockedUntil > new Date()) {
    await logAttempt(false, "account_locked");
    return { status: "failed" };
  }

  const key = challengeKey("login", user.id);
  const expectedChallenge = await getCachedValue(key);
  await invalidateCacheKey(key);
  if (expectedChallenge === null) {
    await logAttempt(false, "passkey_challenge_missing");
    return { status: "failed" };
  }

  let verified = false;
  let newCounter = row.counter;
  try {
    const result = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      credential: {
        id: row.credentialId,
        publicKey: new Uint8Array(Buffer.from(row.publicKey, "base64")),
        counter: row.counter,
        transports: parseTransports(row.transports),
      },
      requireUserVerification: true,
    });
    verified = result.verified;
    newCounter = result.authenticationInfo.newCounter;
  } catch {
    verified = false;
  }
  if (!verified) {
    await logAttempt(false, "passkey_failed");
    void recordFailedAttempt(identifierForAlerts, input.ip ?? null).catch(() => {});
    return { status: "failed" };
  }

  await prisma.staffWebAuthnCredential.update({
    where: { id: row.id },
    data: { counter: newCounter, lastUsedAt: new Date() },
  });
  // Same success bookkeeping as a verified password (authenticateStaff):
  // failure counter cleared, lock cleared, last-login stamped.
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await logAttempt(true);
  // ADV-28 new-IP alert — fired BEFORE the route creates the session,
  // exactly as in the password path, so prior-session semantics match.
  void recordNewIpSuccessIfUnseen({
    userId: user.id,
    identifier: identifierForAlerts,
    ip: input.ip ?? null,
  }).catch(() => {});
  return { status: "ok", userId: user.id };
}

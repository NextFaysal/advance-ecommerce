# Security Notes — Auth Secrets & Pending-2FA Cookie

Scope: how staff TOTP secrets are stored and how the `admin_pending_2fa`
cookie is protected. Implemented in `src/lib/auth.ts`; consumed by
`app/api/v1/admin/auth/login/route.ts` and
`app/api/v1/admin/auth/verify-2fa/route.ts`.

**No key material appears in this document or in any committed file.**
Keys live only in server environment (`.env.local` locally, server env
in production).

---

## 1. Key: `AUTH_ENCRYPTION_KEY`

- Format: 64 hex chars = 32 bytes, same handling as
  `SETTINGS_ENCRYPTION_KEY` in `settings.ts`.
- Generate once per install, e.g. `openssl rand -hex 32`, and set it in
  `.env.local` / the production server env. Never commit it, never send
  it in chat, never log it.
- **Dedicated key, deliberately not the settings key.** TOTP secrets and
  cookie signing are credential material; settings hold provider
  credentials. Separate keys = separate blast radius and independent
  rotation. The envelope *format* mirrors `settings.ts` so operations
  treat both keys the same way.
- Missing or wrong-length key:
  - `encryptTotpSecret()` / `signPending2fa()` **throw** — the operation
    fails; a secret is never stored plaintext and a cookie is never
    issued unsigned because the key was absent.
  - The verify paths **fail closed**: `verifyTotp()` rejects the code,
    `verifyPending2fa()` returns `null`, and the user sees the same
    generic error as for a bad code.
- Rotation warning: rotating `AUTH_ENCRYPTION_KEY` makes every stored
  TOTP envelope undecryptable — all staff with 2FA must re-enrol.
  In-flight pending-2FA cookies are also invalidated (users just log in
  again). Plan rotation accordingly; there is no dual-key grace period.

## 2. TOTP secret encryption (AES-256-GCM)

- Envelope format (mirrors `settings.ts`):
  `v1:<iv-hex>:<tag-hex>:<cipher-hex>` — AES-256-GCM, random 12-byte IV
  per secret, GCM auth tag verified on decrypt. A tampered envelope
  throws inside `decryptTotpSecret()` and fails closed on verify.
- Functions (`src/lib/auth.ts`):
  - `encryptTotpSecret(secretBase32)` — line 305
  - `decryptTotpSecret(stored)` — line 319 (throws on malformed/tampered)
  - `resolveTotpSecret(stored)` — line 339 (verify-path resolver)
  - `verifyTotpCode(secret, code)` — line 387 (pure ±1-step check)
  - `verifyTotp(userId, code)` — line 394 (DB fetch + resolve + check)
- **Enrolment is the only write path.** `enrollTotpSecret(userId)`
  (line 427) generates the secret with `generateTotpSecret()` (line 407),
  stores ONLY the envelope in `User.twoFactorSecret`, and returns the
  plain base32 secret exactly once so it can be shown to the staff
  member (QR / manual key). `confirmTotpEnrollment(userId, code)`
  (line 441) sets `twoFactorEnabled` only after the first code checks
  out. Any future enrolment UI/route MUST call these helpers — never
  write `twoFactorSecret` directly, and never put the plain secret in a
  log, audit record, or API response beyond the one-time enrolment
  display.
- **Legacy plaintext migration.** Secrets enrolled before this change
  are stored as raw base32. `resolveTotpSecret()` detects the envelope
  by the `v1:` prefix (a base32 secret can never contain `:` or
  lowercase, so detection cannot misfire) and accepts legacy values
  as-is, so existing staff are not locked out. Legacy values are
  upgraded the moment the user re-enrols (enrolment always writes the
  envelope). The one-off backfill now exists:
  `packages/db/scripts/backfill-totp-secrets.ts` (idempotent, `--dry-run`
  supported) re-encrypts remaining plaintext rows in place and repairs
  the two lockout states (flag on with no secret; corrupt or
  undecryptable secret) by resetting 2FA so the user can re-enrol. It
  needs DB access and `AUTH_ENCRYPTION_KEY`; until it runs, plaintext
  rows remain exactly as exposed as before this change — no worse, no
  better. Belt-and-braces in the runtime: `authenticateStaff()` gates
  the TOTP step on `hasUsableTotp()` (flag AND secret), and staff
  reporting shows the same usable state, so a legacy flag-without-
  secret row can neither trap a login nor misreport as protected.
  Self-service enrolment is wired end-to-end: Admin > Security (2FA)
  (`/admin/security`) over `POST /api/v1/admin/auth/2fa/enroll` +
  `/confirm` (session-guarded, own account only).

## 3. Pending-2FA cookie signing (HMAC-SHA256)

- Cookie: `admin_pending_2fa`, httpOnly, path-scoped to the verify-2fa
  route, `maxAge` 600 s — set by the login route only when the password
  step returns `needs_2fa`.
- Value format: `v1.<base64url payload>.<base64url signature>` where
  payload is JSON `{ "uid": <userId>, "exp": <unix seconds> }` with
  `exp` = issue time + 600 s (`PENDING_2FA_TTL_SECONDS`, matching the
  cookie `maxAge`), and the signature is HMAC-SHA256 over `v1.<payload>`.
- Signing key is a **domain-separated subkey**:
  `HMAC-SHA256(AUTH_ENCRYPTION_KEY, "advance-ecommerce:pending-2fa-cookie:v1")`
  — the raw encryption key is never used directly as a MAC key.
- Functions (`src/lib/auth.ts`): `signPending2fa(userId)` — line 479
  (throws on missing/invalid key; the login route catches and returns a
  generic 500 rather than issuing an unsigned cookie),
  `verifyPending2fa(value)` — line 491 (timing-safe signature compare,
  then payload shape + expiry check; returns the user id or `null`).
- The verify-2fa route trusts ONLY the user id returned by
  `verifyPending2fa()`. Tampered, expired, malformed, and pre-signing
  legacy cookies (a bare user id) all return `null` and produce the
  same generic `401 INVALID_CODE` response as a wrong TOTP code — no
  oracle for which check failed. A user holding an old unsigned cookie
  simply restarts at the password step.

## 4. Invariants that must not regress

- Passwords: scrypt hashes only (`hashPassword`/`verifyPassword`),
  unchanged by this work. Session tokens: only SHA-256 hashes stored.
- Nothing in this layer logs a password, OTP/TOTP code, TOTP secret
  (plain or envelope), session token, cookie value, or key — including
  in error messages.
- Rate limiting (5 attempts / 15 min per IP+identifier) and account
  lockout (5 failures → 30 min) behaviour is unchanged.
- The in-memory rate limiter is still the local-dev fallback; the
  Redis swap remains a separate Step 34 item.

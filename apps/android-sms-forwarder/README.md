# Android SMS Forwarder — bKash / Nagad payment-SMS auto-verify

A small Kotlin Android app that runs on the **merchant's own phone** (the
phone that receives bKash/Nagad payment-confirmation SMS). It forwards
each payment SMS to the store server, where it is matched against orders
awaiting manual payment and proposed to staff for verification.

This is the device half of the platform's "merchant SMS auto-verify"
differentiator. The server half already exists in `apps/web`; this app
implements exactly the contract that code defines — nothing here invents
an endpoint.

## ⚠️ Read this first: what forwarding does and does not do

- Forwarding **never marks an order paid**. The server records each SMS
  as a verification *proposal*; staff confirm the payment in the admin
  panel (Admin → BD Tools → SMS যাচাই, `app/admin/bd-tools/page.tsx`),
  through the existing manual-TrxID review flow.
  *(Source: `apps/web/app/api/v1/admin/bd/sms-ingest/route.ts` header and
  `apps/web/src/bd/sms-ingestion.ts` — every record carries
  `marksPaid: false`.)*
- Only SMS that parse as bKash/Nagad payment confirmations are
  forwarded. OTPs, bank alerts and personal messages are dropped on the
  phone and never transmitted (the on-device filter mirrors the server
  parser, see below).
- The server **never stores the raw SMS body** — only a SHA-256 hash,
  the parsed fields (sender phone masked) and, for parsed payment SMS, a
  truncated preview with phone numbers masked.
  *(Source: `apps/web/src/bd/sms-ingestion.ts` module header.)*

## The server contract (as implemented, with sources)

### Ingest endpoint

```
POST {STORE_BASE_URL}/api/v1/admin/bd/sms-ingest
Authorization: Bearer ae_dev_<device token>     ← recommended (per-device token)
 — or, legacy fallback —
Cookie: admin_session=<session token>
Content-Type: application/json

{ "items": [
    { "smsText": "<raw SMS body>",
      "source": "android_forwarder",
      "receivedAt": "2026-10-27T08:15:30.000Z",   // optional, ISO-8601
      "providerHint": "bkash" }                    // optional: "bkash" | "nagad"
] }
```

- Body schema (single item or `{ items: [...] }`, batch max **50**):
  `ingestSmsItemSchema` / `ingestSmsRequestSchema` in
  `apps/web/src/bd/sms-ingestion.ts`; route:
  `apps/web/app/api/v1/admin/bd/sms-ingest/route.ts`.
- Success: **HTTP 201**, `{ data: { results, counts }, meta }` for a
  batch (single item: `{ data: { record, duplicate } }`). With a
  device token, `meta.auth` echoes `{ kind: "device", deviceId,
  deviceLabel }`, and the created record carries
  `device: { id, label }` provenance (visible in the admin ingest
  list while the server process is warm — the persisted table has
  no device column; the device card's last-seen time is the durable
  liveness record).
- Errors: **400** `INVALID_INPUT` (bad body); on the token path
  **401** `DEVICE_TOKEN_INVALID` (token unknown or revoked — the
  route never falls back to a session when an `Authorization`
  header is present); on the legacy session path **401**
  `UNAUTHENTICATED` (no/expired session), **403** `FORBIDDEN`
  (account lacks the `payments.verify_manual` permission).
- **Dedupe is server-side and authoritative**: records are keyed by
  `(provider, TrxID)` parsed from the body, backed by the
  `sms_ingestions` table's `UNIQUE(provider, trxId)` constraint. A
  re-sent TrxID returns the original record with `duplicate: true` and
  creates nothing — a forwarder retry can never double-count money.
  *(Source: `apps/web/src/bd/sms-ingestion.ts`.)* The app additionally
  dedupes locally by SHA-256(body + SMS timestamp) so the same
  broadcast is never queued twice.
- Matching: an order is proposed only when its expected amount equals
  the SMS amount **exactly** (integer poisha) and either the sender
  phone matches the customer phone or the order awaits a manual
  bKash/Nagad payment. Multiple candidates → `AMBIGUOUS`, never
  auto-picked. *(Source: same file.)*

### Authentication — per-device token (recommended)

The ingest route accepts a **per-device token** provisioned by staff
in **Admin → BD Tools → ডিভাইস টোকেন** (server:
`apps/web/src/bd/devices.ts`; management API:
`/api/v1/admin/bd/devices`, guarded by `payments.verify_manual`).
How it works:

- Staff create a device with a label (e.g. "দোকানের bKash ফোন") and
  a reason. The server generates `ae_dev_<43 url-safe chars>` (256
  bits of entropy), shows the plaintext **exactly once** in that
  create response, and stores only its **SHA-256 hash** in the
  `bd.sms_devices` Setting document. No read API ever returns the
  token or the hash.
- The phone sends `Authorization: Bearer ae_dev_…` on every ingest
  call — no cookie, no sign-in. The route checks the hash
  (constant-time compare) against non-revoked devices; each accepted
  call stamps the device's `lastSeenAt` (throttled to once an hour).
- **Revocation is immediate**: staff revoke the device on the same
  BD Tools card (reason + audit), and the very next request with
  that token gets **401 `DEVICE_TOKEN_INVALID`**. Device auth reads
  the database directly — no session cache in the way.
- A request that carries an `Authorization` header is authenticated
  as a device **only** — it never falls back to a session. A device
  token can **submit** SMS but can never read the ingestion list or
  call any other admin API.
- Up to **20 active devices** per install; creating and revoking
  are audited (`bd.sms_device.create` / `bd.sms_device.revoke`).

Why this is the recommended path: no 7-day expiry and no weekly
re-sign-in on the phone; no staff password ever touches the phone;
TOTP on staff accounts is irrelevant; a lost phone is fixed by
revoking one token instead of changing a staff password.

> **App-side status:** the app source in this repository implements
> this token flow. `Prefs.kt` stores the device token alongside (and
> ahead of) the legacy session token; `ApiClient.post(...)` sends it
> as the `Authorization: Bearer` header — exactly one credential per
> call, never both — and no login call is made on the token path.
> A **401** on the token path is treated as terminal: forwarding
> pauses in a "টোকেন বাতিল/ভুল — আবার পেয়ার করুন" (token revoked or
> invalid — re-pair) state instead of retrying, until a person pairs
> a fresh token. The legacy session sign-in below remains in the app
> as a fallback for installs not yet using device tokens.

### Authentication — staff session (legacy fallback)

The route still accepts the **staff session cookie**
(`requireAdmin("payments.verify_manual")` in
`apps/web/src/reports/guard.ts`) for requests with **no**
`Authorization` header — that is what the admin UI itself uses. The
app keeps this sign-in as a legacy fallback (used only when no
device token is paired):

1. Sign in with a staff account:
   `POST /api/v1/admin/auth/login` with `{ identifier, password }`
   (`apps/web/app/api/v1/admin/auth/login/route.ts`). The session token
   comes back **only** as the `admin_session` Set-Cookie (HttpOnly,
   `Path=/`, 7-day maxAge — `STAFF_SESSION_TTL_MS` in
   `apps/web/src/lib/auth.ts`); the app extracts and stores the token,
   never the password.
2. Send that token as the `admin_session` cookie on every ingest call.
3. On **401**, clear the token, pause forwarding, and ask for a fresh
   sign-in in the app. Sessions last **7 days**, so expect a weekly
   re-sign-in on the forwarder phone.

Caveats that apply to this legacy path only:

- The forwarder phone holds a staff session — use a **dedicated staff
  account** for it, with only the permissions it needs
  (`payments.verify_manual`), so it can be disabled/revoked on its own.
- **TOTP 2FA accounts cannot sign in from the app.** When the account
  has TOTP enabled, login answers `{ data: { status: "needs_2fa" } }`
  and expects a second step the app does not implement. The dedicated
  forwarder account should therefore not have TOTP enabled (protect it
  with a strong password and the account's own revocation instead).
- **Login is rate-limited** (5 attempts / 15 min per IP + identifier,
  `apps/web/app/api/v1/admin/auth/login/route.ts`) and accounts lock
  after repeated failures — the app never auto-retries a login; only a
  person signs in.
- Staff-login IP rules (`security.ip_rules`, ADV-28) also apply to the
  app's sign-in; if the store uses them, allow the phone's network.

### SMS parsing rules (mirrored on-device)

`MerchantSmsParser.kt` is a line-for-line mirror of the server parser
`parseMerchantSms` in `apps/web/src/bd/sms-autoverify.ts`:

- Bangla digits (০–৯) are folded to Latin digits first.
- Provider: body contains `bkash`/`বিকাশ` → bKash; `nagad`/`নগদ` →
  Nagad; otherwise the label `TrxID` implies bKash and `Txn ID` implies
  Nagad.
- TrxID: `(trxid|txn id|transaction id)[:.]? ([A-Za-z0-9-]{6,32})`,
  normalised to uppercase with spaces/dashes stripped.
- Amount: the **first** `Tk`/`Taka`/`৳` amount in the body
  (`1,250.00` style commas/decimals supported), converted to integer
  poisha.
- Sender phone: first match of `(\+?88)?01[3-9]\d{8}`.

The server re-parses the raw body itself; the mirror only decides what
is worth sending. Provider can also be hinted from the SMS sender ID
(e.g. the `bKash` alphanumeric sender) and is sent as `providerHint`.

## App behaviour

- `SmsReceiver` handles `SMS_RECEIVED`, reassembles multi-part SMS,
  applies the parser filter, and enqueues matches.
- The queue lives in (encrypted) app preferences as JSON — deliberately
  no database for a handful of pending messages.
- `ForwardWorker` (WorkManager, network-connected constraint) POSTs the
  queue in batches of ≤ 50 with exponential-backoff retries on network
  errors / server 5xx. Auth failures stop it, and say why in the app —
  auth problems need a person, not a retry loop. On the token path a
  401 additionally sets a needs-repair flag: later runs fail fast
  without touching the network until a fresh token is paired, and the
  queue is kept (re-pairing forwards the waiting SMS; nothing is
  resent to a dead token in the meantime).
- The device token, the legacy session token and queued SMS bodies are
  stored with `EncryptedSharedPreferences` (AES-256, Android
  Keystore). If the keystore is unavailable the app falls back to
  plain preferences (documented in `Prefs.kt`) — on such a device the
  tokens are only as safe as the device.
- No production URL or credential is hardcoded anywhere: the store
  address and the token (or sign-in) are entered on the phone. Pairing
  and sign-in both refuse non-`https://` addresses so no credential
  ever travels over plain HTTP.

## Build & install

> **Honest status: this source has NOT been compiled.** The development
> VM used to write it has no Android SDK, so no APK was built or tested
> there. The code is written against the AndroidX APIs listed in
> `app/build.gradle.kts`; expect the first build to be the real check.

Requirements: JDK 17, Android SDK 34 (platform + build-tools).

```bash
cd apps/android-sms-forwarder
# Android Studio: open this folder and let it sync, or from a terminal
# with the SDK installed (generates the wrapper jar on first run):
gradle wrapper --gradle-version 8.7   # once, if ./gradlew is absent
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Install on the merchant phone (sideload — see the permission note):

```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
# or copy the APK to the phone and open it (allow "install unknown apps"
# for your file manager/browser when Android asks).
```

For a release build, sign with the merchant's own keystore
(`assembleRelease` + `signingConfig`) — no signing material ships with
this source.

## Pairing the phone (merchant steps)

**Recommended — device token:**

1. **In the admin panel** (Admin → BD Tools → **ডিভাইস টোকেন**),
   create a device token: give the phone a label and a reason. The
   token (`ae_dev_…`) is shown **once** — copy it right away; only
   its hash stays on the server, so a lost token means creating a
   new one, not recovering the old one.
2. Install the app on the phone that receives the bKash/Nagad merchant
   SMS (the SIM must be in this phone).
3. In the app: enter the **store address** (e.g.
   `https://your-store.example.com`, no trailing path), paste the
   **device token** and tap **Pair with token**. Grant SMS permission
   when asked, and leave the **Forwarding** switch on. (The token
   field clears after pairing — the app keeps the token in encrypted
   storage and shows only "Paired" state.)
4. Send a test payment to the merchant number. The SMS should appear
   in the app queue, forward within moments, and show up in
   Admin → BD Tools → SMS যাচাই as a proposed match for staff to
   confirm. The device's "সর্বশেষ দেখা" (last seen) time on the
   ডিভাইস টোকেন card confirms the phone is checking in.
5. No calendar note: tokens do not expire. If the phone is lost or
   replaced, revoke its token on the same card (effective
   immediately) and create a fresh one for the new phone. If a token
   is revoked while the phone still uses it, the app stops
   forwarding and shows "টোকেন বাতিল/ভুল — আবার পেয়ার করুন" until
   the new token is paired — it does not keep retrying the dead one.

**Legacy — staff session (fallback, kept in the app):**

1. **In the admin panel**, create (or pick) a dedicated staff account
   for the forwarder phone and make sure it has the
   `payments.verify_manual` permission. Leave TOTP **off** for this
   account (see the 2FA caveat above).
2. Install the app (same as above).
3. Open the app:
   - **Store address**: your store's URL (no trailing path).
   - **Identifier / password**: the dedicated staff account's login.
     Tap **Sign in** — the app keeps only the 7-day session token.
   - **Grant SMS permission** when asked (button in the app, or
     Settings → Apps → SMS Forwarder → Permissions → SMS → Allow).
   - Leave the **Forwarding** switch on.
4. Test as in step 4 above.
5. Calendar note: **re-sign-in roughly every 7 days** (session length).
   If forwarding stops, the app's status line says why.

## Permissions & distribution note

- `RECEIVE_SMS` is a **restricted permission**: on Google Play it is
  reserved for apps whose core function is SMS (default SMS handlers).
  A merchant-side forwarder like this is normally **not Play-eligible**,
  which is why it is distributed by **sideloading** the APK. On a
  sideloaded install the user grants SMS access in system settings
  (Android may label it a "restricted setting" on newer versions:
  Settings → Apps → SMS Forwarder → ⋮ → Allow restricted settings).
- The app never reads the SMS inbox/content provider, never sends SMS,
  and drops non-payment SMS on-device without transmitting them.
- Battery optimisers on some phones (Xiaomi/Samsung) can delay
  broadcasts/work — if forwards arrive late, exempt the app from battery
  optimisation in system settings.

## What remains unverified

- **Compilation** — no Android SDK on the authoring VM (see above).
  The device-token pairing flow is implemented in the app source
  (see the app-side status note under Authentication) but, like the
  rest of the app, has not been compiled or run yet.
- **On-device receive/forward** — needs a real phone + SIM receiving
  genuine bKash/Nagad SMS, and a live store to pair against.
- Real-world SMS wording variants beyond the server parser's documented
  examples (`apps/web/src/bd/sms-autoverify.ts` header) — the mirror
  matches the server exactly, so any format the server cannot parse is
  (deliberately) not forwarded either.

## Files

| File | Purpose |
| --- | --- |
| `app/src/main/java/com/advanceecommerce/smsforwarder/SmsReceiver.kt` | SMS broadcast → filter → queue |
| `.../MerchantSmsParser.kt` | Mirror of the server parser (filter + extraction) |
| `.../QueueStore.kt` | Local retry queue + dedupe set (JSON in encrypted prefs) |
| `.../ForwardWorker.kt` | WorkManager drain with backoff; auth-failure stop; revoked-token needs-repair state |
| `.../ApiClient.kt` | Device-token (Bearer) + legacy login ingest calls implementing the contract above |
| `.../Prefs.kt` | Encrypted settings/token storage (device token primary, session legacy) |
| `.../MainActivity.kt` + `res/layout/activity_main.xml` | Pairing + legacy sign-in + status screen |

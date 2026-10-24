# Sandbox — Payment & Courier (Agent 9, Steps 20/22)

Simulated only. No real API call, no real key, no money, no real booking.

## Adapters
- Payment: `createSandboxPaymentGateway("bkash" | "nagad" | "sslcommerz")`
  in `payment-gateway.ts`. `initiate()` is idempotent per
  `idempotencyKey` and returns a simulated path `/sandbox/checkout/<method>`,
  never a real gateway URL. `verify()` with the issued transaction id
  returns `PAID` for the attempted integer-poisha amount, otherwise
  `FAILED`. `refund()` refuses to refund more than was paid in total.
- Courier: `createSandboxCourierProvider("steadfast" | "pathao" | "redx")`
  in `courier-provider.ts`. Tracking ids are `SBX-SF-…` / `SBX-PT-…` /
  `SBX-RX-…`. Zone charges (integer poisha): Inside Dhaka 6000,
  Outside Dhaka 12000, district 10000, +2000 per extra 500g above 1kg.
  Cancel is only allowed from `CREATED` and maps to `FAILED` (the
  `ShipmentStatus` enum has no `CANCELLED`).

## Webhooks (routes)
- `POST /api/v1/public/payments/webhook?provider=bkash|nagad|sslcommerz`
- `POST /api/v1/public/couriers/webhook?provider=steadfast|pathao|redx`

Headers: `x-webhook-signature` (hex HMAC-SHA256 of the raw body,
optionally `sha256=`-prefixed), `x-webhook-timestamp` (optional),
`x-idempotency-key` (optional if the body carries `idempotencyKey`).

Body (payment): `{ paymentAttemptId, gatewayTransactionId, rawStatus,
idempotencyKey }` — `rawStatus` is mapped in `status-mapping.ts`
(e.g. bKash `completed` → `PAID`, SSLCommerz `VALID` → `PAID`).
Body (courier): `{ trackingId, rawStatus, idempotencyKey }` — raw
statuses are mapped per provider in `status-mapping.ts`, then the
shipment → order move is checked with the order state machine
(`canTransition`); an illegal order move is logged and not applied.

Secret: taken server-side from Admin Settings (encrypted) if configured,
otherwise from the local env var `SANDBOX_WEBHOOK_TEST_SECRET` for sandbox
testing only. If neither exists, the webhook is rejected (401) and logged.
There is deliberately no hardcoded test secret. Every webhook attempt is
logged in the sandbox store (`sandboxStore.webhookLog`) with a reason
only — never the signature or raw body. In production this log must be
the `webhook_logs` DB table.

Idempotency: a replayed `idempotencyKey` returns the first result with
`duplicate: true` and never applies twice.

## Manual TrxID (admin)
- `GET /api/v1/admin/payments/manual-trx` — list (permission `payments.view`), `?status=pending|approved|rejected`
- `POST /api/v1/admin/payments/manual-trx` — approve/reject
  (permission `payments.verify_manual`), body
  `{ submissionId, action: "approve" | "reject", reason }`. Reason is
  required and the review is audited (submission id + statuses only,
  never the full TrxID). A submission can be reviewed once only, and the
  same `(method, TrxID)` can never be approved twice.
- Customer submissions are created through `createManualTrxSubmission()`
  in `manual-trx.ts` by the checkout-side endpoint (not an admin route);
  duplicate `(method, TrxID)` is refused at creation.

## Admin shipment / payment routes (sandbox)
- `POST /api/v1/admin/shipments` — book (`shipments.book`)
- `GET /api/v1/admin/shipments/track?trackingId=…` (`shipments.view`)
- `POST /api/v1/admin/shipments/cancel` — `{ shipmentId }` (`shipments.cancel`)
- `GET /api/v1/admin/payments/sandbox` — sandbox payment attempts (`payments.view`)
- `GET /api/v1/admin/payments/cod-settlement?provider=…` — COD settlement
  report from sandbox shipments (`payments.view`); rows are
  `collected − charge = payable`, all integer poisha, `sandbox: true`.

## Live-mode guard
Sandbox adapters throw `LiveModeBlockedError` if their config mode is
not `sandbox`. Enabling live in Settings additionally requires
`canEnableLive(configured, credentialRef)` in `live-guard.ts` — a
credential row must exist (`configured` boolean only, never the value),
and a real test-connection with the real adapter must pass before live
is used. The Settings pages call the Settings API contract in
`SETTINGS-API-CONTRACT.md`; that API route does not exist yet (see report).

## Remaining for real provider integration
1. DB tables from `../SCHEMA-ADDITIONS.md` + UNIQUE `(method, trxId)` on
   manual Trx submissions; replace the in-memory store.
2. Real adapters per provider: auth/token flow, initiate/verify/refund
   calls, provider signature schemes, error mapping, rate/area lookups,
   label fetch — keeping the interfaces in `../payment.ts` / `../courier.ts`.
3. Webhook routes must read provider secrets from Settings (encrypted)
   and persist to `webhook_logs`; add provider IP allow-list if offered.
4. Settings API route (contract in `SETTINGS-API-CONTRACT.md`) + wiring
   the test-connection button to the real adapters.
5. BullMQ jobs for booking/callback retry with backoff + manual fallback
   in admin; COD settlement must reconcile against the courier invoice.

# Settings API contract (proposed — route not yet implemented)

The two Settings pages edited by Agent 9 (`app/admin/settings/payments`,
`app/admin/settings/shipping`) are wired to this contract. The route
itself is outside Agent 9's owned files and does not exist yet — the
settings/service owner must implement it, otherwise Save/Test on those
pages will show an error (the pages never fake success).

All routes require the `settings.edit` permission (test: `settings.view`
is enough to view, `settings.integrations` for test-connection) and must
enforce the live-mode guard server-side.

## Save
`POST /api/v1/admin/settings`
Body: `{ "key": "payment.bkash.enabled", "value": "true", "reason": "Enable bKash sandbox" }`
- Validate `key` with `isKnownSettingKey()` (lib/settings.ts).
- If `value` is a credential field (key suffix in `isSecretSettingKey`),
  store encrypted via `setSetting()`; never echo the value back.
- Live guard: a save that sets `*.mode` to `"live"` must be rejected
  with 422 unless `getIntegrationStatus()` reports `configured: true`
  for that provider and a credential reference exists.
- Response: `{ "data": { "key": "...", "saved": true } }`
  Errors: `{ "error": { "code": "...", "message": "..." } }`

## Test connection
`POST /api/v1/admin/settings/test`
Body: `{ "category": "payment" | "courier", "provider": "bkash" }`
- Sandbox providers: test succeeds without any credential and must be
  reported as sandbox, e.g.
  `{ "data": { "ok": true, "status": "configured", "message": "Sandbox test passed (simulated, no real provider call)." } }`
- Live providers: run the real adapter's test using the credential from
  Settings (server-side only) and return status only, never the credential.

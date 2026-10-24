# MODULES.md — Extensibility, Business Packs & ERP-lite

Agent 17 · Execution Plan Step 49 (A13–A16 + Part C) · Local only

This document covers three slices built as **pure logic + types** with
in-memory demo stores (every API response is labelled
`persistence: "in-memory-demo"` until the DB swap):

| Slice | Code | What it is |
|---|---|---|
| Extensibility | `apps/web/src/extensibility/` | Plugin/hook registry, adapter registry, custom fields, outbound webhooks, API keys |
| Business packs | `apps/web/src/business-modules/` | Config + validation packs per business type, feature-flag gated |
| ERP-lite | `apps/web/src/erp/` | Chart of accounts, double-entry journal, expenses, supplier payments, VAT, period locks |

Admin API: `GET|POST /api/v1/admin/modules` (catalog + pack-config
validation, permission `settings.integrations`) and
`GET|POST /api/v1/admin/modules/erp-journal` (permission
`reports.accounting`).

---

## 1. Extensibility (`src/extensibility/`)

### Hooks (`types.ts`, `registry.ts`)
- Plugins declare a manifest (`pluginManifestSchema`): kebab-case id,
  semver, the domain events they subscribe to, adapter kinds they provide,
  and API scopes they request (least privilege).
- Domain events are the core's own events (`order.created`,
  `order.status_changed`, `payment.succeeded`, `stock.low`, …) — plugins
  subscribe; they never invent core events.
- `InMemoryHookRegistry.dispatch()` runs handlers sequentially by
  priority (core 0–99, plugins 100+). A failing hook is recorded in the
  dispatch result and **never blocks the core operation or other hooks** —
  hooks run after the operation has already succeeded, like the
  automation engine's effects (Agent 13).

### Adapter registry (`registry.ts`)
Payment/courier/SMS/email/storage adapters themselves live in
`src/integrations/` (Agents 5/9). The registry is only the contract that
lets core boot code and plugins register providers by
`(kind, providerKey)` without core edits. Duplicate registration throws.

### Custom fields (`custom-fields.ts`)
Merchant-defined extra fields on `product | order | customer | variant`.
- Definitions are data (`customFieldDefinitionSchema`): snake_case key,
  bn/en labels, type, required, options, bounds, `adminOnly`.
- Every write goes through `validateCustomFieldValues()`: unknown keys
  rejected, required enforced, **money fields must be integer poisha — a
  float is rejected, never rounded**, select values must be in options.
- `buildCustomFieldZodSchema()` produces the equivalent Zod schema for
  routes; `publicFieldDefinitions()` strips `adminOnly` fields so they
  never leak to the storefront.

### Webhooks (`webhooks.ts`)
- Subscriptions are data (`webhookSubscriptionSchema`, https only). The
  signing secret is **not** in the subscription record — it lives
  encrypted in Admin Settings (`src/lib/settings.ts`); records carry only
  `hasSecret: boolean`.
- Delivery reuses the jobs contract: the publisher enqueues
  `WebhookJob { event, payloadId }` on the `webhook-delivery` queue
  (`src/jobs/queues.ts`). Retry = `DEFAULT_RETRY` (3 attempts / 30 s).
  2xx delivered · 408/429/5xx/network retry · other 4xx failed · retries
  exhausted → `dead` (staff action; never silently dropped).
- Signing: HMAC-SHA256 over `` `${timestamp}.${body}` ``, sent as
  `x-ae-signature: sha256=<hex>` with `x-ae-event` / `x-ae-timestamp`.
  Signatures are never logged or stored; delivery logs keep only a short
  error reason, never the response body.

### API keys (`api-keys.ts`) — HASH-ONLY
- Plain key format `ak_live_<32 hex>` / `ak_test_<32 hex>`, generated
  with `randomBytes`, returned **once** at creation.
- Only `sha256(plainKey)` is stored (`keyHash`); lists return
  `ApiKeyPublicView` (prefix `ak_live_` + 4 hex chars, scopes, expiry) —
  the hash never leaves the server either.
- `verifyApiKey()` is timing-safe and refuses revoked/expired keys.
  Scopes are `module.action` strings; `hasScope()` enforces them — a key
  can never exceed its issued scopes.

---

## 2. Business packs (`src/business-modules/`)

Each pack = `{ id, flagKey, nameBn/nameEn, defaultConfig, configSchema }`
plus pure rule functions. Packs are **paid add-ons**: flag keys
`module.fashion`, `module.electronics`, `module.grocery`,
`module.pharmacy`, `module.digital_goods` — **these rows have been
added to the seed flag catalogue** (`packages/db/prisma/seed.ts`,
OFF by default) by integration. Until the DB flag reader lands, routes read the in-memory
demo store (`demoPackFlags`, also OFF), so a locked pack can never run
open. `validatePackConfig()` validates raw JSON against a pack's schema
(allowed while locked, so staff can prepare config before purchase);
activation is the flag step.

| Pack | Logic |
|---|---|
| **Fashion** | Size list + size chart (cm), `validateFashionSelection`, `buildSizeGuide`, `suggestSize` (nearest chart size; suggestion only, never auto-selects) |
| **Electronics** | Warranty window (`warrantyInfo`), EMI calculator: surcharge in bps, instalments split by integer division with the remainder over the first months — instalments always sum **exactly** to the financed total; `validateEmiEligibility` (min total + offered tenures) |
| **Grocery** | Weight pricing `floor(pricePerKgPoisha × grams / 1000)` (integers only), delivery slots (capacity + order cutoff), step/max weight validation |
| **Pharmacy** | Rx gate: any prescription-required item ⇒ a prescription upload ref is mandatory at checkout, **no bypass flag**; batch expiry `ok / warning / blocked / expired` from `expiryWarningDays` / `expiryBlockDays`; no medical data stored, only an image ref id |
| **Digital goods** | License pool allocation (one key per sale, pool exhaustion blocks fulfilment), download grants with max-downloads + link-expiry checks |

---

## 3. ERP-lite (`src/erp/`)

Double-entry, deliberately small. **All amounts integer poisha.**

- **Chart of accounts** (`accounts.ts`): BD SME default (cash, bank,
  bKash/Nagad wallets, receivables, inventory, payables, **VAT payable
  2100**, courier COD payable, capital, sales/delivery income, COGS and
  common expense accounts), bn + en names, parent codes for roll-up.
- **Journal** (`ledger.ts`): entries are created **only** via
  `buildJournalEntry()`, which throws `UnbalancedEntryError` on a
  both-sides line, a zero line, < 2 lines, non-integer amounts, or
  total debits ≠ total credits. There is no plug-line "fix". Posted
  entries are immutable; corrections are reversal entries
  (`buildReversalEntry`).
- **Period lock**: `postEntry()` throws `PeriodLockedError` when the
  entry date falls in a locked `YYYY-MM` period.
- **Expenses / supplier payments** are typed builders over the same
  rules (expense: Dr expense + Dr input-VAT 2100 when VAT > 0, Cr
  paid-from; supplier payment: Dr payables, Cr paid-from) — they cannot
  bypass balancing or the lock.
- **VAT report** (`vat.ts`): output − input VAT by rate band over a date
  range; negative net = credit carried forward. Reconciles against
  account 2100.
- **Balances**: `accountBalances()` aggregates posted entries only
  (trial-balance shape).

---

## 4. What remains

### DB persistence (schema additions needed — DB owner)
- `plugins` (manifest JSON, status), `hook_subscriptions`,
  `custom_field_definitions` (+ values as entity JSON, validated by
  `custom-fields.ts`), `webhook_subscriptions`, `webhook_delivery_logs`,
  `api_keys` (hash column only), `business_pack_configs` (pack id +
  validated config JSON), ERP tables `accounts`, `journal_entries`,
  `journal_lines`, `accounting_periods`. Seed owner: add the five
  `module.*` pack flags + `module.erp_lite` if ERP is sold separately.
- Swap points are the demo stores: `demoHookRegistry`,
  `demoAdapterRegistry`, `demoPackFlags`, `InMemoryLicensePool`, and the
  route-level `demoEntries`/`demoPeriods` arrays.

### Plugin runtime sandboxing (not built, by design)
This slice defines plugins as **declarations** (manifests, subscriptions,
adapter registrations). Executing third-party plugin *code* is out of
scope until there is: (1) an isolated worker/VM runtime with CPU/memory
limits and no direct DB/env access — plugins may only call the scoped
API with their issued API key; (2) manifest review + signature checks at
install; (3) per-plugin rate limits and a kill switch (status →
`disabled` stops dispatch, which the registry already honours via
`isEnabled`). No plugin code should ever run inside the Next.js request
process.

### Wiring still open
- Domain-event publishers must call `dispatch()` after commit (same
  integration point as the automation engine).
- The webhook worker must implement the HTTP send + delivery-log writes
  behind `webhooks.ts`'s classification helpers.
- ERP auto-posting from orders/payments/expenses (sourceKind/sourceId
  fields are ready) and the admin UI for packs/ERP (API + logic only in
  this slice).

# Agent 14 Slices — Review Pass (Reseller / Call Center / Inbox / POS base)

- **Reviewer:** Agent 52, 2026-10-24. Read-only review; **no code was edited.**
- **Why this review exists:** Agent 14 (spawned 2026-10-24 ~14:27 +06) built
  `src/reseller`, `src/callcenter`, `src/inbox`, `src/pos` plus the reseller /
  call-center API routes and pages, but its completion report never arrived,
  so its stubs and limits were never stated in a handoff. Agent 38 later built
  the POS page + POS API over Agent 14's `src/pos` service, and Agent 40 built
  the inbox page over `src/inbox`. Agent 48's Final Audit v2 verified the
  files exist and pass the shared typecheck and recommended this dedicated
  review.
- **Method:** full read of all 21 `src/**` files, all 10 API route files, and
  all 6 admin page files in scope; flag keys diffed against the seed
  `FEATURE_FLAGS` block; permission strings diffed against the `PERMISSIONS`
  catalogue in `src/lib/rbac.ts`; Prisma schema grepped for module models;
  **29 tsx smoke assertions run against the pure logic — 29 PASS, 0 FAIL**
  (numbers in §6).

---

## 1. Defects found (for the main agent to assign as fixes — none fixed here)

### D1 — PRIVACY (medium): full customer phone numbers are serialized to the browser by the inbox page
- `apps/web/app/admin/inbox/page.tsx:54` passes the **raw** `demoConversations`
  array — the server-side `Conversation` shape, whose `customerPhone` is the
  full normalized number (`+8801912345678` in the demo data) — as a prop to
  the client component `InboxClient`. In the Next.js App Router, props of a
  client component are serialized into the RSC payload delivered to the
  browser, so the full number leaves the server for **any** staff user who
  opens `/admin/inbox`, with no `customers.view_full_phone` check anywhere.
- `page.tsx:43` + `:56` do the same with `detectedPhones`: full normalized
  numbers extracted from chat, passed as client props.
- `app/admin/inbox/inbox-client.tsx` only ever **renders** masked numbers
  (lines 279, 301, 413–415, 435), so nothing full is visible on screen — but
  it is present in the page payload and in client state, and line 199 uses
  the full number client-side as the draft's `phoneRaw`. This breaks the
  project rule the rest of the codebase follows (full phone is server-side
  only, released only with `customers.view_full_phone` — compare the
  call-center API, §3).
- **Fix shape:** page should pass `ConversationView[]` (masked) + messages to
  the client, and the draft should be built via the existing
  `POST /api/v1/admin/inbox/draft` route (which resolves the phone
  server-side) instead of calling `buildOrderDraft()` in the browser.

### D2 — PRIVACY (low–medium): inbox conversation API returns a full phone number under `customers.view` only
- `apps/web/app/api/v1/admin/inbox/route.ts:39`: the conversation-detail GET
  returns `detectedPhone` — the full normalized phone extracted from the
  thread — to any caller passing `requireAdmin("customers.view")`. Every
  other surface in these slices gates a full number behind
  `customers.view_full_phone` (call-center queue does exactly this). The
  list response is clean (views only); only the detail field leaks.
- **Fix shape:** return `detectedPhone` only when
  `guard.permissions.includes("customers.view_full_phone")`, else a masked
  value or a boolean `phoneDetected`.

### D3 — CORRECTNESS (low): POS receipt mislabels NAGAD and CARD sales as bKash, and hides discounts
- `apps/web/src/pos/register.ts:159` (`buildPosReceipt`):
  `paymentMethod: sale.paymentMethod === "CASH" ? "cod" : "bkash"` — the
  shared `Order` shape has no better enum value in this slice, so a POS sale
  paid by **NAGAD or CARD prints "bkash"** on the receipt. CASH → "cod" is
  also approximate.
- Same function: the synthetic order carries the sale's line items at full
  price and `totalPoisha` **after** discount, and `src/orders/print.ts`
  renders per-line amounts plus one total with **no discount line** — on a
  discounted sale the receipt's line amounts sum to more than the printed
  total, with nothing explaining the difference.
- **Fix shape:** extend the print pipeline / synthetic order with the real
  POS payment method label and a discount row (or set the receipt total text
  from subtotal − discount with an explicit discount line) when the POS
  persistence slice lands.

### D4 — NAMING / latent privacy trap (low): `phoneMasked` field contains the full number when the caller is privileged
- `apps/web/src/callcenter/queue.ts:158` (`toQueueItemView`):
  `phoneMasked: canViewFullPhone ? task.phone : maskPhone(task.phone)`.
  The behaviour is intentional and permission-gated (documented in the
  type), but the field is **named** `phoneMasked` while sometimes holding
  the full number. Any future consumer that renders `phoneMasked` trusting
  the name will leak. **Fix shape:** rename to `phoneDisplay`, or return
  `phoneMasked` always-masked plus a separate optional `phone` field set
  only when privileged.

### Minor gaps (not defects in the pure logic; record for the persistence slice)
- **G1 — Reseller status is never enforced.** Nothing checks
  `Reseller.status`: a `SUSPENDED` or `PENDING_APPROVAL` reseller can be
  credited and can withdraw through `wallet.ts` / the routes exactly like an
  `ACTIVE` one. The withdrawal POST route also never verifies the reseller
  exists (an unknown id fails safe — empty ledger → "insufficient balance" —
  but returns 422 WITHDRAWAL_REJECTED, not 404).
- **G2 — Money-out routes are guarded by a view permission.** Both reseller
  withdrawal routes (create + review) use `payments.view`. The review route's
  own header comment already flags that a dedicated
  `resellers.withdrawal` / `payments.manage` permission is a follow-up.
  Every other write route in these slices uses a write permission
  (`orders.create`, `orders.update_status`).
- **G3 — Call-center assignment is not enforced.** The outcome POST lets any
  `orders.update_status` holder record an outcome on any task; a QUEUED task
  is auto-claimed to the caller. The queue GET also accepts `?agentId=` to
  preview another agent's next task. Acceptable for a demo store; must be
  tightened before real agents share a queue.
- **G4 — Reseller price entries are not per-reseller.** `ResellerPriceEntry`
  has no `resellerId`; `buildDashboard()` receives one shared entries array
  and reports its length as `priceEntryCount` for every reseller (the demo
  page shows the same 2 entries for all). Per-reseller pricing is not yet
  modelled — the DB design must add the ownership column.
- **G5 — Documentation drift in `src/pos/flags.ts`.** Its header still says
  "there are no /pos API routes in this slice's owned files" — stale since
  Agent 38 added `app/api/v1/admin/pos/*`. Comment-only; no behaviour impact.

---

## 2. Reseller (`src/reseller`, Step 46 / A5)

### What exists
| File | Contents |
|---|---|
| `types.ts` (129) | `Reseller` (status ACTIVE/SUSPENDED/PENDING_APPROVAL), tiers BRONZE/SILVER/GOLD with thresholds 0 / 10,000,000 / 50,000,000 poisha and commission 500 / 750 / 1000 bps, `ResellerPriceEntry`, append-only `WalletEntry` (6 types), `WithdrawalRequest` (PENDING→APPROVED→PAID / REJECTED), `MIN_WITHDRAWAL_POISHA = 50_000` (৳500), Zod schemas (`.int()` rejects float poisha), `ResellerDashboard` — **masked phone only** |
| `pricing.ts` (91) | `computeMargin` (below-base price is an **error, never clamped**; marginBps floored), `buildPriceEntry`, `tierForLifetimeSales` (inclusive thresholds), `nextTierProgress`, `commissionForSale` = floor(sales × bps / 10000) |
| `wallet.ts` (199) | Append-only ledger over an entries array: `walletBalance`, `pendingWithdrawalTotal`, `creditDeliveredOrder` (commission + margin as separate entries, zero parts skipped, negatives rejected), `requestWithdrawal` (min + free-balance enforced via the HOLD entry itself), `reviewWithdrawal` (PAID requires APPROVED first; REJECTED releases the hold; terminal states immutable) |
| `service.ts` (119) | In-memory demo store: 2 sample resellers, 2 price entries, 2 wallet entries, empty withdrawals; `buildDashboard()` re-derives tier from lifetime sales (stored tier is not trusted) and masks via `maskPhone()` |
| `flags.ts` (42) | Demo flag store for `module.reseller`, default OFF |
| `index.ts` | Barrel export |

### Routes & page
- `GET /api/v1/admin/resellers` — `reports.view`; returns dashboards +
  withdrawals, `meta.persistence: "in-memory-demo"`.
- `POST /api/v1/admin/resellers` — `payments.view` (see G2); creates a
  withdrawal request + HOLD entry (201).
- `POST /api/v1/admin/resellers/withdrawals` — `payments.view` (see G2);
  review flow APPROVED / PAID / REJECTED with release entry on reject.
- `app/admin/resellers/page.tsx` (65) — lock panel while OFF; when ON,
  demo-labelled table using masked dashboards + margin list. English-only,
  inline styles (predates the design-system polish the inbox/POS pages got).

### Flags & permissions
- Flag `module.reseller` — **exists in seed** FEATURE_FLAGS (all 19 keys
  checked, §5), seeded OFF. Routes/pages check the **demo** store, not the
  DB — same interim pattern as all v2 slices.
- Permissions used: `reports.view`, `payments.view` — both **exist** in the
  rbac catalogue. The nav item also uses `reports.view` — consistent with
  the nav note in the brief. No dedicated reseller permission exists.

### Honesty
- Demo limits labelled in code headers, API `meta`, and on the page
  ("Demo data (in-memory)"). Account numbers are never stored — only a
  masked ref (`accountRefMasked`, schema requires 4–32 chars). Marking a
  withdrawal PAID is a **status in the demo store only**; nothing in code or
  UI claims money was actually sent to a bKash/Nagad/bank account. No full
  phone in any outward shape (dashboard smoke-verified, §6).

### Schema coverage
- **No Prisma models exist** for this module (grep: none). Proposed
  additions for the main agent (do not add without the persistence slice):
  `Reseller` (phone, status, tier cache), `ResellerPriceEntry`
  (**with `resellerId`** — see G4), `ResellerWalletEntry` (append-only,
  unique id, index on resellerId+createdAt), `ResellerWithdrawal`
  (accountRefMasked only).

### Remaining to production
1. Prisma models above + store swap behind the existing pure functions.
2. Credit trigger: `creditDeliveredOrder` must be called from the order
   DELIVERED transition for reseller-attributed orders (attribution itself —
   how an order knows its reseller — is not modelled yet).
3. Status enforcement (G1) + dedicated withdrawal permission (G2).
4. Real payout execution is an ops/payment step; PAID must only be settable
   after an actual payout reference exists.
5. Reseller-facing panel (this slice is admin-side only) and DB flag reader.

---

## 3. Call Center (`src/callcenter`, Step 46 / A10)

### What exists
| File | Contents |
|---|---|
| `types.ts` (161) | `CallTask` (sources PENDING_ORDER / FAILED_DELIVERY / ABANDONED_CHECKOUT / MANUAL; statuses QUEUED/IN_CALL/DONE/SKIPPED), 5 outcomes, `CallLogEntry`, `AgentPerformance` (rates in bps), Zod schemas, and the bn-first `CONFIRMATION_SCRIPT` (5 steps, en gloss) |
| `queue.ts` (167) | Pure logic: `priorityForSource` (FAILED_DELIVERY 40 > PENDING_ORDER 30 > ABANDONED_CHECKOUT 20 > MANUAL 10), `nextTaskForAgent` (QUEUED + assigned-to-me-or-unassigned + callback due; priority desc, then oldest), `claimTask`, `recordOutcome`, `dueCallbacks`, `agentPerformance`, `toQueueItemView` |
| `service.ts` (42) | Demo store: 2 tasks (one PENDING_ORDER, one FAILED_DELIVERY with 1 NO_ANSWER attempt), empty log |
| `flags.ts` (35) | Demo flag store for `module.call_center`, default OFF |

### Routes & page
- `GET /api/v1/admin/call-center` — `orders.view`; returns queue views,
  caller's next task, due callbacks, and the script. Full phone inside a
  view **only** when the caller has `customers.view_full_phone` (see D4).
- `POST /api/v1/admin/call-center` — `orders.create`; MANUAL task creation,
  phone normalized server-side (invalid → 400 INVALID_PHONE).
- `GET /api/v1/admin/call-center/outcome` — `orders.view`; caller's
  performance rollup.
- `POST /api/v1/admin/call-center/outcome` — `orders.update_status`;
  records the outcome and returns the agent's **next task in the same
  response** (auto-next flow).
- `app/admin/call-center/page.tsx` (62) — lock panel while OFF; queue table
  always rendered masked (`toQueueItemView(t, false)`), script list.

### Flags & permissions
- Flag `module.call_center` — **exists in seed**, OFF. Demo store interim.
- Permissions: `orders.view`, `orders.create`, `orders.update_status`,
  `customers.view_full_phone` — **all exist** in the rbac catalogue. The nav
  item uses `orders.view`, matching the brief's note (there is no dedicated
  call-center permission).

### Correctness notes (all smoke-verified, §6)
- CALLBACK requires a **future** `callbackAt` (missing or past → error), the
  task stays QUEUED with the callback set, and `nextTaskForAgent` does not
  offer it before it is due.
- NO_ANSWER re-queues while attempts < `MAX_ATTEMPTS` (3): attempt 1, 2
  re-queue; the 3rd closes the task DONE — a dead number cannot loop forever.
- CONFIRMED / CANCELLED / WRONG_NUMBER close the task; outcomes on DONE /
  SKIPPED tasks are rejected.

### Honesty
- Labelled demo in headers, `meta`, and on the page. No telephony exists or
  is claimed — "calls" are queue records and logged outcomes only; the
  confirmation script's closing line tells the customer an SMS will arrive,
  but that is script text for a human agent, not a system claim.

### Schema coverage
- **No Prisma models exist.** Proposed: `CallTask` (index on
  status+priority+createdAt, callbackAt), `CallLogEntry` (agentId, taskId).

### Remaining to production
1. Prisma models + store swap; queue generation from real events
   (order PENDING, delivery FAILED, abandoned checkout) — today tasks are
   demo rows or manually added only.
2. Assignment enforcement (G3); remove the `?agentId=` preview.
3. CONFIRMED/CANCELLED outcomes should drive the linked order's state
   machine via the orders API (today the log is standalone), and the
   confirmation SMS goes through the real SMS provider path.
4. D4 rename so a future consumer cannot leak a full number by trusting a
   field name.

---

## 4. F-commerce Inbox (`src/inbox`, Step 46 / A6 + Part G)

### What exists
| File | Contents |
|---|---|
| `types.ts` (85) | Channels MESSENGER / INSTAGRAM / WHATSAPP **as types only**, `InboxMessage` (with `externalMessageId` for webhook dedupe), `Conversation` (identity = (channel, externalThreadId); customer linked only after a phone is captured in chat), `ConversationView` (masked), inbound Zod schema |
| `conversion.ts` (133) | `extractPhoneFromMessages` (loose scan of inbound text → strict `normalizeBdPhone`), `buildOrderDraft` — reuses checkout's own `bdAddressSchema` / `checkoutItemSchema` and the Bangla address parser (`src/bd`); parser confidence is surfaced, `needsStaffConfirmation` when confidence < 0.8 or an override was used; **a draft is explicitly not an order**, `unreadInbound` |
| `service.ts` (82) | Demo store: 2 conversations (one with phone, one without), 2 messages; `toConversationView` masks; `messagesForConversation` sorts by sentAt |
| `flags.ts` (35) | Demo flag store for `module.f_commerce`, default OFF |

### Routes & page
- `GET /api/v1/admin/inbox` — `customers.view`; list = masked views only.
  Detail (`?conversationId=`) = view + messages + `detectedPhone` (see D2).
  Meta honestly carries `channelsLive: false`.
- `POST /api/v1/admin/inbox/draft` — `orders.create`; phone resolution
  order: explicit → conversation's captured phone → extracted from messages
  → draft fails (phone-first rule). Meta: `persistence: "none-pure-logic"`,
  `isOrder: false`.
- `app/admin/inbox/page.tsx` + `inbox-client.tsx` (Agent 40, 60 + 500) —
  lock panel while OFF; unified thread UI. The reply composer is an honest
  demo: queued replies are badged "কিউ করা — পাঠানো হয়নি" (queued — not
  sent); nothing is ever sent. See **D1** for the page's phone-payload
  problem — the one real privacy defect in these slices.

### Flags & permissions
- Flag `module.f_commerce` — **exists in seed**, OFF. Demo store interim.
- Permissions: `customers.view` (read), `orders.create` (draft) — both
  **exist** in the catalogue. ⚠️ Nav mismatch: the admin-nav item for
  `/admin/inbox` is gated on `orders.view` while the API requires
  `customers.view` — a staff user can see the nav entry yet get 403 from
  the API, or hold `customers.view` without seeing the entry. Nav display
  is UX only, but the two should be aligned.

### Honesty
- The strongest labelling of the four modules: type header states no
  channel API is called and no token is read/stored/logged anywhere;
  `channelsLive: false` in API meta; the page header says in Bangla that
  no channel is connected, replies cannot be sent, and a draft is not an
  order. Message bodies are chat content by design (the demo message
  contains the customer's own typed phone number — that is the chat text
  staff must read, not a structured field leak; the structured leaks are
  D1/D2).

### Schema coverage
- **No Prisma models exist.** Proposed: `InboxConversation`
  (unique (channel, externalThreadId)), `InboxMessage`
  (unique (channel, externalMessageId) for webhook dedupe).

### Remaining to production
1. Fix D1 + D2 before any real data touches this page.
2. Prisma models + webhook ingestion behind a `ChannelAdapter` per
   platform; credentials only in encrypted Admin Settings (as the type
   header prescribes). No adapter exists yet.
3. Outbound sending (today: queued-intent demo only), read/unread sync,
   assignment workflow, and draft → manual-order-form hand-off (the draft
   route returns the draft; nothing pre-fills the Step 17 form yet).
4. DB flag reader; align nav permission with the API (above).

---

## 5. POS base (`src/pos`, Step 46 / A6) — src layer by Agent 14, routes/page by Agent 38

### What exists
| File | Contents |
|---|---|
| `types.ts` (128) | `PosRegister`, `PosShift` (float, counted/expected/variance at close), `PosSale` (lines, discount, tendered, client `idempotencyKey`, status QUEUED_OFFLINE/SYNCED/VOIDED, `offline` flag), scan payload + resolution types, Zod schemas; receipt = the shared orders `PrintData` shape, deliberately not a new format |
| `register.ts` (169) | `assertPosEnabled` gate, `resolveScan` (SKU match), `saleTotal` (discount > subtotal is an **error, not a clamp**), `changeDue` (tendered < total is an error), `createSale` (CASH requires tendered; non-cash drops tendered), `expectedCashPoisha` (float + CASH sales, VOIDED excluded), `closeShift` (variance computed and stored; **non-zero variance without a note is rejected**), `openShiftForRegister` (one-open-shift check), `buildPosReceipt` (see D3) |
| `service.ts` (23) | Demo store: 1 register, 1 OPEN shift (float 100,000 poisha = ৳1,000), no sales |
| `flags.ts` (37) | Demo flag store for `module.pos`, default OFF (header comment stale — G5) |

### Routes & page (Agent 38, reviewed here because they are this module's surface)
- `app/api/v1/admin/pos/guard.ts` — dedicated guard: flag first (403
  FEATURE_LOCKED), cookie 401, session validation fail-closed **503
  PRISMA_PENDING**, then permission.
- `GET /pos` — `orders.view`; register state + expected cash + catalog;
  meta labels `in-memory-demo` / `TEMPORARY_MOCK` catalog.
- `POST /pos/sale` — `orders.create`; idempotency-key replay returns the
  first sale with `duplicate: true` (never a second record); shift must
  exist, be OPEN, and belong to the register. Meta states plainly:
  `createsOrder: false` — a POS sale here is a demo record, **not** an Order.
- `POST /pos/shift` — `orders.create`; open (409 if one is already open) /
  close (variance reported with `hasVariance`, `varianceAdjusted: false`).
- `POST /pos/scan` — `orders.view`; unmatched code is a normal 200 with
  `matched: false` for manual-entry fallback.
- `app/admin/pos/page.tsx` + `register-client.tsx` (Agent 38, 60 + 486) —
  lock panel while OFF; the register UI runs the **same pure functions in
  page state** (it does not call the API above — page and API are parallel
  demo paths over one logic layer). Labelling is explicit throughout:
  "ডেমো রেকর্ড, আসল Order তৈরি হয়নি" after each sale, offline sync
  described as a design note with "এই ডেমোতে আসল কোনো sync হয় না".

### Flags & permissions
- Flag `module.pos` — **exists in seed**, OFF. Demo store interim.
- Permissions: `orders.view`, `orders.create` — both **exist**. Nav item
  uses `orders.view` + `module.pos` — consistent.

### Schema coverage
- **The only one of the four modules with Prisma models:**
  `PosRegister` (schema.prisma:1342), `PosShift` (:1351), `PosSale`
  (:1368) — Int poisha, `PosSale.idempotencyKey @unique`. Nothing reads or
  writes them yet (Prisma blocker + demo store).
- ⚠️ **Type/schema drift to reconcile at the persistence swap:**
  TS `PosShift.closedBy` has no schema column (only `openedById`);
  TS `PosRegister.warehouseId/isActive` vs schema `location/status`;
  TS `PosSale` carries `registerId`, `status`, `offline` while the schema
  carries `receiptNo`, `itemsJson`, `syncedOrderId` instead. Neither side
  is wrong alone, but the swap must map them deliberately (status ↔
  syncedOrderId, varianceNote ↔ close note).

### Remaining to production
1. Fix D3 (receipt payment-method label + discount line).
2. Prisma swap for registers/shifts/sales + drift reconciliation above.
3. The offline sync itself: queued sales → orders API by idempotency key,
   stock ledger movements per sale, and a real Order per sale (today
   `createsOrder: false` by design).
4. Barcode field distinct from SKU (resolveScan's "barcode" is the SKU
   today — documented in its own comment), refunds/voids workflow (VOIDED
   exists as a status; nothing sets it), DB flag reader.

---

## 6. Cross-cutting: flags & permissions verification

**Feature flags** — the seed `FEATURE_FLAGS` block
(`packages/db/prisma/seed.ts:122-141`) contains **19 keys**, all seeded
`enabled: false`. All four of Agent 14's keys are present:
`module.reseller`, `module.call_center`, `module.f_commerce`,
`module.pos`. ✔ No key used by these slices is missing from the seed.
Caveat (all v2 slices, not Agent 14-specific): routes and pages read the
per-module **in-memory demo flag stores**, not the DB — flipping the DB
flag alone will not unlock these modules until the DB-backed flag reader
lands; conversely nothing in the codebase calls `setEnabled` on these
four stores, so they cannot be accidentally on.

**Permissions** — every permission string used by these slices' routes
was checked against the `PERMISSIONS` catalogue in `src/lib/rbac.ts`:

| Permission | Used by | In catalogue |
|---|---|---|
| `reports.view` | resellers GET (+ nav) | ✔ |
| `payments.view` | reseller withdrawal create + review (see G2) | ✔ |
| `orders.view` | call-center GET, POS GET/scan (+ nav) | ✔ |
| `orders.create` | call-center manual task, inbox draft, POS sale/shift | ✔ |
| `orders.update_status` | call-center outcome POST | ✔ |
| `customers.view` | inbox GET | ✔ |
| `customers.view_full_phone` | call-center full-phone gate | ✔ |

No dedicated reseller / call-center / inbox / POS permissions exist — the
brief's nav notes are confirmed accurate against the route code
(reseller reads guard on `reports.view`, money on `payments.view`;
call-center on `orders.*`). The one inconsistency is the **inbox nav
item** (`orders.view`) vs its API (`customers.view`) — §4.

**Guard behaviour** — reseller/call-center/inbox routes use the shared
`requireAdmin` (fail-closed 503 PRISMA_PENDING while the Prisma client is
ungenerated); POS routes use Agent 38's equivalent local guard. Flag
checks run before any data is returned in every route. ✔

---

## 7. Smoke results (tsx, run by Agent 52 — 29 PASS / 0 FAIL)

**Reseller (13)** — margin 380,000→450,000 = **70,000 poisha, 1555 bps**;
below-base price rejected (not clamped); commission floor: 92,500 × 750 bps
= **6,937** (0.5 floored away); tier boundaries inclusive at 9,999,999 /
10,000,000 / 50,000,000; next-tier from 12,500,000 → GOLD in 37,500,000;
wallet credit 62,500 + 70,000 → balance **132,500** (matches demo seed);
withdrawal below ৳500 minimum rejected; 100,000 hold → free balance
**32,500**; second withdrawal of 60,000 (≥ minimum, > free balance)
rejected with "Insufficient wallet balance" (re-run separately to confirm
the rejection reason, since a first attempt at 40,000 was rejected by the
minimum rule instead); PAID before APPROVED rejected; APPROVED → REJECTED
releases the hold, balance restored to **132,500**; demo dashboard: res-1
SILVER, balance 132,500, phone masked (`+8801******78`).

**Call center (6)** — next task for an unassigned-pool agent is the
FAILED_DELIVERY task (priority 40) over older PENDING_ORDER/MANUAL tasks;
an agent's own assigned task wins for that agent; a callback set for
12:00 is **not** offered and not in `dueCallbacks` at 08:00, and is due at
12:00; CALLBACK with no time and with a past time both rejected, future
time accepted and task stays QUEUED with `callbackAt`; NO_ANSWER attempts
1→2 re-queue, 2→3 closes DONE (MAX_ATTEMPTS = 3); performance rollup:
2 confirmed / 4 calls = **5000 bps**, talk time summed as integer seconds.

**Inbox (4, re-verifying Agent 40's case)** — conversation view masks the
phone; phone extraction from the demo thread returns `+8801912345678`
normalized; `buildOrderDraft` on the demo conversation succeeds with
parser confidence **0.75** → `needsStaffConfirmation: true` (correctly
below the 0.8 threshold); a draft with an invalid phone fails with errors
instead of producing a draft.

**POS (6, re-verifying Agent 38's variance case)** — CASH sale 2 × 45,000
= **90,000**, status QUEUED_OFFLINE; expected cash with float 100,000 +
CASH 90,000 + a 50,000 bKash sale = **190,000** (non-cash correctly
excluded); closing counted at 188,500 without a note is **rejected**;
with a note it closes with `variancePoisha` **−1,500** recorded, expected
and counted stored exactly as counted (never adjusted); discount >
subtotal rejected; tendered < total rejected; a VOIDED cash sale is
excluded from expected cash (float only, 100,000).

---

## 8. Overall assessment

Agent 14's four slices are **better than their missing report suggested**:
the pure logic is disciplined (integer poisha everywhere, floors not
rounding, append-only wallet, negative margins / over-free-balance
withdrawals / unexplained variances all rejected rather than coerced),
the honesty labelling is consistent (demo stores named as such in code,
API meta, and UI; nothing claims a message was sent, a payout was made,
or an order was created), and all flags/permissions check out against
the seed and the RBAC catalogue. The real findings are concentrated in
the inbox's phone handling (**D1** page payload, **D2** API field) —
both should be fixed before real customer data reaches that page — plus
the POS receipt mislabel (**D3**) and the `phoneMasked` naming trap
(**D4**). Everything else is the known, shared blocker set: demo
persistence awaiting the Prisma swap (POS models exist; reseller,
call-center, and inbox models are proposed in §§2–4), the DB-backed flag
reader, and the live integrations (channel APIs, POS order sync,
reseller credit triggers) that were always follow-up slices.

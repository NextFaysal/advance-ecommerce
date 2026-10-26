# @advance-ecommerce/partner-sdk

A small, typed, **zero-dependency** TypeScript client for the Advance
Ecommerce partner API, plus the webhook signature-verification helper
(the one piece integrators genuinely get wrong).

> **Honest distribution note:** this SDK lives in the platform repo
> (`packages/partner-sdk/`) and is handed to each client's integration
> developer as source. It is **not published to npm**. Inside this
> monorepo it is a normal workspace package
> (`"@advance-ecommerce/partner-sdk": "workspace:*"`); outside the
> repo, copy the `src/` folder — it has no runtime dependencies and
> needs only TypeScript + a runtime with global `fetch` (and Web
> Crypto, for webhook verification): Node.js 18+, Bun, Deno, or an
> edge runtime.

## Getting a key

1. In the store admin, open **Webhooks → API keys** and create a key
   with exactly the scopes your integration needs.
2. The plaintext key (`ae_live_…`) is shown **once** — at rest only
   its SHA-256 hash exists, so a lost key is revoked and re-created,
   never recovered.
3. Pass the **store origin** as `baseUrl` (e.g.
   `https://store.example.com`, no trailing path).

Keys are revocable and can carry an expiry; revocation and expiry
take effect on the next request.

## Usage

```ts
import { AdvancePartnerClient, PartnerApiError } from "@advance-ecommerce/partner-sdk";

const client = new AdvancePartnerClient({
  baseUrl: "https://store.example.com",
  apiKey: process.env.PARTNER_API_KEY!, // ae_live_…
});

try {
  const orders = await client.listOrders({ limit: 20 });
  for (const order of orders) {
    // Money is integer poisha (100 poisha = ৳1). Item quantities are
    // strings ("1.5") — Decimal server-side, never floats.
    console.log(order.orderNo, order.status, order.totalPoisha, order.customerPhoneMasked);
  }

  const products = await client.listProducts(); // default limit 50
  const customers = await client.listCustomers({ limit: 100 });
} catch (error) {
  if (error instanceof PartnerApiError) {
    // error.code is the server's code; error.status the HTTP status.
    if (error.code === "RATE_LIMITED") {
      await sleep((error.retryAfterSeconds ?? 60) * 1000);
    }
  }
  throw error;
}
```

The list endpoints return the most recent rows first and have no
cursor or offset — `limit` (server default 50, clamped to 1–200) is
the only paging control.

## Receiving webhooks

Verify **before** you parse or act. The platform signs the exact raw
body with HMAC-SHA256 (hex) using your endpoint's signing secret and
sends it in the `X-AE-Signature` header, alongside `X-AE-Event` and
`X-AE-Delivery`.

```ts
import {
  parseWebhookEvent,
  verifyWebhookSignature,
  type WebhookOrderData,
} from "@advance-ecommerce/partner-sdk";

// Framework-agnostic: `rawBody` must be the unparsed request body.
async function handleWebhook(rawBody: string, signatureHeader: string | null) {
  const ok = await verifyWebhookSignature(rawBody, signatureHeader ?? "", process.env.WEBHOOK_SECRET!);
  if (!ok) return { status: 401 }; // not from the store — drop it

  const event = parseWebhookEvent(rawBody); // throws WebhookParseError on bad shape
  switch (event.event) {
    case "order.created": {
      const order = event.data as unknown as WebhookOrderData;
      console.log("new order", order.orderNo, order.totalPoisha);
      break;
    }
    case "stock.low":
    case "order.status_changed":
    case "payment.succeeded":
    case "checkout.abandoned":
    case "customer.registered":
    case "webhook.test":
      break;
  }
  return { status: 200 }; // any 2xx marks the delivery SENT
}
```

Delivery rules that affect your handler:

- A delivery counts as sent **only on a 2xx**; failures retry after
  1m / 10m / 1h / 6h and stop after 5 attempts — so handlers must be
  idempotent. **Dedupe on `event.id`** (the delivery id, same as the
  `X-AE-Delivery` header).
- Payloads are privacy-minimal by design: ids, statuses, totals —
  never a full phone, address, email, or customer name. Use the
  partner API (with the matching scope) if you need more, and note
  phones stay masked there too.
- Subscribable events: `order.created`, `order.status_changed`,
  `payment.succeeded`, `checkout.abandoned`, `stock.low`,
  `customer.registered`, `webhook.test` (admin test ping only).

## API surface

| Method | Endpoint | Required scope | Returns |
| --- | --- | --- | --- |
| `listProducts({ limit? })` | `GET /api/v1/partner/products` | `products:read` | `PartnerProduct[]` |
| `listOrders({ limit? })` | `GET /api/v1/partner/orders` | `orders:read` | `PartnerOrder[]` |
| `listCustomers({ limit? })` | `GET /api/v1/partner/customers` | `customers:read` | `PartnerCustomer[]` |

Field notes (mirroring the server projections):

- **Products** never include cost fields. Variants carry `sku`,
  `pricePoisha`, `compareAtPoisha`, `stock`, `isActive`.
- **Orders** include `customerPhoneMasked` only — names, addresses,
  and emails are not part of this surface at all. Item `quantity` is
  a string; `itemCount` is the summed quantity (may be fractional).
- **Customers** include `phoneMasked` and `email`, plus lifetime
  order count/total (every recorded order counts, any status).
- Rows that have merchant custom-field values carry them additively
  as `customFields`; the key is absent otherwise.

## Errors

All failures throw `PartnerApiError` with the server's `code`,
`message`, and HTTP `status`:

| Status | Code | Meaning |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | Key missing, unknown, revoked, or expired |
| 403 | `FORBIDDEN` | Key lacks the endpoint's scope |
| 429 | `RATE_LIMITED` | Over 120 requests/minute for this key; `retryAfterSeconds` is set from `Retry-After` |
| 0 | `NETWORK_ERROR` | The request never reached the server |

## Development

```bash
pnpm --filter @advance-ecommerce/partner-sdk typecheck
```

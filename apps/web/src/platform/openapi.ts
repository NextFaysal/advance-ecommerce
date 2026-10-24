/**
 * OpenAPI 3.1 document builder — Agent 37.
 *
 * The document is built programmatically from API_ROUTE_REGISTRY below:
 * one entry per (method, path) operation that actually exists as a
 * route.ts handler under app/api. The registry is the single source for
 * this spec — a checker can derive each entry's route file from its path
 * (`/api/v1/admin/orders/{id}` -> `app/api/v1/admin/orders/[id]/route.ts`)
 * and compare methods against the filesystem.
 *
 * Excluded from the published document (entries carry
 * `includeInSpec: false` + a reason): the two third-party webhook
 * callbacks (signature-verified machine endpoints, not a client contract)
 * and the internal system health probe. They stay in the registry so the
 * filesystem check accounts for every route file.
 *
 * Auth model: admin operations use the `admin_session` httpOnly cookie
 * plus a server-side permission check (fail-closed). Public operations
 * need no session; /pay/{token} is capability-based (the token IS the
 * credential, looked up by hash only).
 *
 * No secrets, tokens, or internal notes are emitted — summaries only.
 */

export type ApiAuth = "admin" | "public";

export interface ApiRouteEntry {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** OpenAPI-style path, e.g. /api/v1/admin/orders/{id} */
  path: string;
  auth: ApiAuth;
  summary: string;
  includeInSpec: boolean;
  exclusionReason?: string;
}

function r(
  method: ApiRouteEntry["method"],
  path: string,
  auth: ApiAuth,
  summary: string,
): ApiRouteEntry {
  return { method, path, auth, summary, includeInSpec: true };
}

function x(
  method: ApiRouteEntry["method"],
  path: string,
  auth: ApiAuth,
  summary: string,
  exclusionReason: string,
): ApiRouteEntry {
  return { method, path, auth, summary, includeInSpec: false, exclusionReason };
}

export const API_ROUTE_REGISTRY: readonly ApiRouteEntry[] = [
  // ---- The spec endpoint itself -------------------------------------
  r("GET", "/api/openapi.json", "public", "This OpenAPI document"),

  // ---- Admin: auth ---------------------------------------------------
  r("POST", "/api/v1/admin/auth/login", "public", "Staff login (identifier + password, rate limited); may require a 2FA step"),
  r("POST", "/api/v1/admin/auth/verify-2fa", "public", "Verify the TOTP code from the pending-login cookie and create the admin session"),

  // ---- Admin: orders / customers ------------------------------------
  r("GET", "/api/v1/admin/orders", "admin", "List orders with filters"),
  r("POST", "/api/v1/admin/orders", "admin", "Bulk order action (validated + audited; enqueues a bulk-actions job processed in-process by processBulkJob)"),
  r("GET", "/api/v1/admin/orders/{id}", "admin", "Order detail"),
  r("PATCH", "/api/v1/admin/orders/{id}", "admin", "Transition order status through the state machine (reason required for cancel/refund)"),
  r("GET", "/api/v1/admin/orders/feed", "admin", "Order feed stream (SSE contract; live flag in payload)"),
  r("GET", "/api/v1/admin/jobs/{id}", "admin", "Bulk job status with per-order results (in-process demo processor; the BullMQ worker will run the same processBulkJob)"),
  r("GET", "/api/v1/admin/customers", "admin", "List customers (phones masked by default)"),
  r("GET", "/api/v1/admin/customers/{id}", "admin", "Customer profile with order summary"),

  // ---- Admin: catalog ------------------------------------------------
  r("GET", "/api/v1/admin/products", "admin", "List products (admin view)"),
  r("POST", "/api/v1/admin/products", "admin", "Create a product with variants"),
  r("GET", "/api/v1/admin/products/{id}", "admin", "Product detail (admin view, includes cost)"),
  r("PATCH", "/api/v1/admin/products/{id}", "admin", "Update a product (price change requires a reason)"),
  r("POST", "/api/v1/admin/products/import", "admin", "Preview a CSV product import (per-row validation, nothing saved)"),

  // ---- Admin: payments / shipments ----------------------------------
  r("GET", "/api/v1/admin/payments/manual-trx", "admin", "List manual TrxID submissions awaiting review"),
  r("POST", "/api/v1/admin/payments/manual-trx", "admin", "Create or review a manual TrxID submission (duplicate method+TrxID refused)"),
  r("GET", "/api/v1/admin/payments/cod-settlement", "admin", "COD settlement summary (collected minus courier charge, poisha)"),
  r("GET", "/api/v1/admin/payments/sandbox", "admin", "List sandbox payment attempts"),
  r("POST", "/api/v1/admin/shipments", "admin", "Book a courier shipment (sandbox providers)"),
  r("POST", "/api/v1/admin/shipments/cancel", "admin", "Cancel a booked shipment"),
  r("GET", "/api/v1/admin/shipments/track", "admin", "Track a shipment by tracking id"),
  r("GET", "/api/v1/admin/pos", "admin", "POS register state, current shift and catalog (demo store)"),
  r("POST", "/api/v1/admin/pos/shift", "admin", "Open or close a POS shift (cash variance flagged, never adjusted)"),
  r("POST", "/api/v1/admin/pos/sale", "admin", "Record a POS sale (demo store, idempotency key; creates no Order)"),
  r("POST", "/api/v1/admin/pos/scan", "admin", "Resolve a barcode/SKU scan against the POS catalog"),

  // ---- Admin: inventory / marketing / reports / CMS ------------------
  r("GET", "/api/v1/admin/inventory", "admin", "Inventory levels and low-stock list"),
  r("POST", "/api/v1/admin/inventory", "admin", "Record a stock movement (ledger only, reason required)"),
  r("GET", "/api/v1/admin/inventory/purchase-orders", "admin", "List purchase orders"),
  r("POST", "/api/v1/admin/inventory/purchase-orders", "admin", "Create a purchase order"),
  r("GET", "/api/v1/admin/coupons", "admin", "List coupons"),
  r("POST", "/api/v1/admin/coupons", "admin", "Create a coupon"),
  r("POST", "/api/v1/admin/coupons/apply", "admin", "Evaluate a coupon against a cart (no redemption recorded)"),
  r("GET", "/api/v1/admin/campaigns", "admin", "List campaigns"),
  r("POST", "/api/v1/admin/campaigns", "admin", "Estimate a campaign cost (no message is sent)"),
  r("GET", "/api/v1/admin/loyalty", "admin", "Loyalty / referral / affiliate overview (demo store)"),
  r("POST", "/api/v1/admin/loyalty", "admin", "Append a loyalty points adjustment entry (append-only ledger, reason required)"),
  r("GET", "/api/v1/admin/reports", "admin", "Sales / product / customer / courier report aggregates"),
  r("GET", "/api/v1/admin/reports/export", "admin", "Export a report as CSV"),
  r("GET", "/api/v1/admin/landing", "admin", "List campaign landing pages (demo store)"),
  r("POST", "/api/v1/admin/landing", "admin", "Create a campaign landing page (validated against the catalog; slug unique kebab)"),
  r("PATCH", "/api/v1/admin/landing/{id}", "admin", "Transition a landing page status (DRAFT/PUBLISHED/ARCHIVED; publishing re-validates)"),
  r("GET", "/api/v1/admin/pages", "admin", "List CMS pages and posts"),
  r("POST", "/api/v1/admin/pages", "admin", "Create a CMS page or post"),
  r("GET", "/api/v1/admin/pages/{id}", "admin", "CMS page/post detail"),
  r("PUT", "/api/v1/admin/pages/{id}", "admin", "Replace a CMS page or post (slug rename records a redirect)"),
  r("DELETE", "/api/v1/admin/pages/{id}", "admin", "Delete a CMS page or post"),

  // ---- Admin: settings / system / setup ------------------------------
  r("GET", "/api/v1/admin/settings", "admin", "Public settings + per-provider enabled/configured booleans"),
  r("POST", "/api/v1/admin/settings", "admin", "Save one setting (secrets are encrypted at rest, reason required)"),
  r("POST", "/api/v1/admin/settings/test", "admin", "Test an integration connection (sandbox-simulated in this build)"),
  r("POST", "/api/v1/admin/setup", "admin", "Submit the first-run setup wizard payload (demo store, persisted: false)"),
  r("GET", "/api/v1/admin/staff", "admin", "List staff members with role catalogue (demo store)"),
  r("POST", "/api/v1/admin/staff", "admin", "Invite a staff member (invite queued, no email sent; an Owner can never be created via the API)"),
  r("GET", "/api/v1/admin/audit-log", "admin", "List audit log entries with actor/action/entity/date filters (demo store)"),
  r("POST", "/api/v1/admin/audit-log/export", "admin", "Export the audit log as a watermarked CSV string (reason required; the export itself is audited)"),
  r("GET", "/api/v1/admin/feature-flags", "admin", "List feature flags with enabled state (demo store; all default OFF)"),
  r("PATCH", "/api/v1/admin/feature-flags", "admin", "Toggle a feature flag (reason required, audited; demo store, persisted: false)"),
  r("GET", "/api/v1/admin/tracking", "admin", "Tracking configuration status (booleans + public ids only)"),
  x("GET", "/api/v1/admin/system/health", "admin", "Internal health probe (booleans + status word only)", "Internal operations probe; not part of the client API contract."),
  r("GET", "/api/v1/admin/queues", "admin", "Queue monitor: configured queue catalogue (names, retry policies, concurrency, handlers from the jobs contracts) + worker status; liveCounts is null until the BullMQ daemon runs"),

  // ---- Admin: BD tools ------------------------------------------------
  r("POST", "/api/v1/admin/bd/address-parse", "admin", "Parse free-text Bangla/Banglish address into division/district/upazila"),
  r("POST", "/api/v1/admin/bd/sms-verify", "admin", "Parse a bKash/Nagad merchant SMS and match it for payment verification"),
  r("POST", "/api/v1/admin/bd/sms-ingest", "admin", "Ingest a merchant SMS (single or batch of 50) and propose an order match for staff review — never marks paid"),
  r("GET", "/api/v1/admin/bd/sms-ingest", "admin", "List SMS ingestion records (masked phones only; raw body never stored)"),
  r("GET", "/api/v1/admin/bd/payment-links", "admin", "List payment links (no token or hash is returned)"),
  r("POST", "/api/v1/admin/bd/payment-links", "admin", "Create a payment link (plain URL returned once, hash stored)"),
  r("GET", "/api/v1/admin/bd/cash-closing", "admin", "List daily cash closings"),
  r("POST", "/api/v1/admin/bd/cash-closing", "admin", "Record a daily cash closing (mismatches flagged, never auto-corrected)"),
  r("POST", "/api/v1/admin/bd/courier-reconciliation", "admin", "Reconcile expected courier settlements against an invoice"),
  r("POST", "/api/v1/admin/bd/courier-assignment", "admin", "Rank couriers for an order and recommend an assignment (hard filters then weighted scoring with a per-rule trace; pure engine over caller-supplied stats or the labelled sample stats table)"),
  r("POST", "/api/v1/admin/bd/courier-invoice/import", "admin", "Import a courier invoice CSV (taka strings converted to integer poisha by string parsing), validate per row with no silent drops, and reconcile it against expected shipments"),
  r("GET", "/api/v1/admin/bd/courier-invoice", "admin", "List courier invoice import runs, disputes and dispute adjustments (demo store)"),
  r("POST", "/api/v1/admin/bd/courier-invoice/disputes", "admin", "Create a dispute from a disputed reconciliation row (reason required; amounts are never edited)"),
  r("PATCH", "/api/v1/admin/bd/courier-invoice/disputes/{id}", "admin", "Transition a courier invoice dispute (evidence/submit/accept/reject/close); an accepted dispute may record a separate adjustment"),

  // ---- Admin: automation / fraud --------------------------------------
  r("GET", "/api/v1/admin/automation", "admin", "List automation rules"),
  r("POST", "/api/v1/admin/automation", "admin", "Create an automation rule"),
  r("GET", "/api/v1/admin/automation/{id}", "admin", "Automation rule detail"),
  r("PATCH", "/api/v1/admin/automation/{id}", "admin", "Update or enable/disable an automation rule"),
  r("DELETE", "/api/v1/admin/automation/{id}", "admin", "Delete an automation rule"),
  r("POST", "/api/v1/admin/automation/dry-run", "admin", "Evaluate a rule against a sample event (nothing applied or persisted)"),
  r("GET", "/api/v1/admin/automation/runs", "admin", "List automation run logs"),
  r("POST", "/api/v1/admin/automation/runs", "admin", "Dispatch an event to all stored rules and log the runs"),
  r("GET", "/api/v1/admin/fraud-rules", "admin", "List fraud list entries (blacklist/whitelist, phones masked)"),
  r("POST", "/api/v1/admin/fraud-rules", "admin", "Add a fraud list entry"),
  r("DELETE", "/api/v1/admin/fraud-rules/{id}", "admin", "Remove a fraud list entry"),
  r("POST", "/api/v1/admin/fraud-rules/score", "admin", "Score an order input for fraud risk (0-100, no order is blocked by this call)"),

  // ---- Admin: AI / analytics ------------------------------------------
  r("POST", "/api/v1/admin/ai/describe", "admin", "Generate product description + SEO + image alt (template fallback, labelled)"),
  r("POST", "/api/v1/admin/ai/classify", "admin", "Classify text sentiment/spam (keyword fallback, labelled)"),
  r("POST", "/api/v1/admin/ai/search", "admin", "Parse a natural-language command-bar query and answer from report aggregates"),
  r("GET", "/api/v1/admin/analytics", "admin", "Advanced analytics: RFM, unit economics, courier scores"),

  // ---- Admin: add-on modules ------------------------------------------
  r("GET", "/api/v1/admin/advanced-orders", "admin", "Advanced orders overview (pre-orders, transfers)"),
  r("POST", "/api/v1/admin/advanced-orders", "admin", "Preview a warehouse split allocation (persists nothing)"),
  r("GET", "/api/v1/admin/advanced-orders/preorders", "admin", "List pre-orders with totals and dues"),
  r("POST", "/api/v1/admin/advanced-orders/preorders", "admin", "Create a pre-order with deposit validation"),
  r("GET", "/api/v1/admin/b2b", "admin", "B2B overview (phones masked)"),
  r("GET", "/api/v1/admin/b2b/customers", "admin", "B2B approval queue and credit state"),
  r("PATCH", "/api/v1/admin/b2b/customers", "admin", "Transition a B2B customer approval state"),
  r("POST", "/api/v1/admin/b2b/customers", "admin", "Run a B2B credit check"),
  r("GET", "/api/v1/admin/b2b/quotations", "admin", "List quotations"),
  r("POST", "/api/v1/admin/b2b/quotations", "admin", "Create a quotation"),
  r("PATCH", "/api/v1/admin/b2b/quotations", "admin", "Transition a quotation (convert requires an order id)"),
  r("GET", "/api/v1/admin/vendors", "admin", "List vendors (phones masked)"),
  r("POST", "/api/v1/admin/vendors", "admin", "Create a vendor (starts PENDING)"),
  r("GET", "/api/v1/admin/vendors/{id}", "admin", "Vendor detail with products"),
  r("PATCH", "/api/v1/admin/vendors/{id}", "admin", "Update vendor status or decide a product approval"),
  r("GET", "/api/v1/admin/vendors/{id}/payout", "admin", "Vendor payout summary (commission net of refunds)"),
  r("GET", "/api/v1/admin/riders", "admin", "List own riders with load and performance"),
  r("POST", "/api/v1/admin/riders", "admin", "Create a rider"),
  r("GET", "/api/v1/admin/riders/{id}", "admin", "Rider detail with COD lines"),
  r("PATCH", "/api/v1/admin/riders/{id}", "admin", "Update rider status"),
  r("POST", "/api/v1/admin/riders/assign", "admin", "Auto-assign a delivery to the best available rider"),
  r("GET", "/api/v1/admin/riders/deliveries", "admin", "List rider deliveries"),
  r("PATCH", "/api/v1/admin/riders/deliveries", "admin", "Transition a delivery (proof required; OTP hashed immediately) or record a COD handover"),
  r("GET", "/api/v1/admin/resellers", "admin", "List resellers"),
  r("POST", "/api/v1/admin/resellers", "admin", "Create a reseller"),
  r("POST", "/api/v1/admin/resellers/withdrawals", "admin", "Request or review a reseller wallet withdrawal"),
  r("GET", "/api/v1/admin/call-center", "admin", "Call-center queue"),
  r("POST", "/api/v1/admin/call-center", "admin", "Enqueue a call task"),
  r("POST", "/api/v1/admin/call-center/claim", "admin", "Claim the next call task (or a specific task) for the session agent"),
  r("GET", "/api/v1/admin/call-center/outcome", "admin", "List call outcomes"),
  r("POST", "/api/v1/admin/call-center/outcome", "admin", "Record a call outcome / schedule a callback"),
  r("GET", "/api/v1/admin/inbox", "admin", "Unified F-commerce inbox conversations"),
  r("POST", "/api/v1/admin/inbox/draft", "admin", "Convert an inbox conversation into an order draft"),
  r("GET", "/api/v1/admin/modules", "admin", "Module catalogue with per-pack enabled state"),
  r("POST", "/api/v1/admin/modules", "admin", "Validate and save a business-pack configuration"),
  r("GET", "/api/v1/admin/modules/erp-journal", "admin", "List ERP journal entries"),
  r("POST", "/api/v1/admin/modules/erp-journal", "admin", "Post an ERP journal entry (unbalanced entries rejected)"),

  // ---- Public ----------------------------------------------------------
  r("GET", "/api/v1/public/products", "public", "List published products (cost fields stripped)"),
  r("GET", "/api/v1/public/products/{slug}", "public", "Product detail by slug"),
  r("GET", "/api/v1/public/categories", "public", "List categories"),
  r("GET", "/api/v1/public/carts", "public", "Read a guest or customer cart"),
  r("POST", "/api/v1/public/carts", "public", "Create or update a cart"),
  r("POST", "/api/v1/public/carts/merge", "public", "Merge a guest cart into the customer cart on login"),
  r("POST", "/api/v1/public/orders", "public", "Create an order (server re-validates price and stock; idempotency key required)"),
  r("GET", "/api/v1/public/pay/{token}", "public", "Resolve a payment link by its plain token (hash lookup; view never contains the hash)"),
  r("POST", "/api/v1/public/pay/{token}", "public", "Start a sandbox payment for a payment link"),
  r("POST", "/api/v1/public/track", "public", "Track an order by order number + matching phone (generic error otherwise)"),
  r("POST", "/api/v1/public/track-events", "public", "Ingest a storefront tracking event (consent-gated, deduplicated by eventId)"),
  r("POST", "/api/v1/public/contact", "public", "Submit a contact-form message into the support inbox (rate limited 3/hour per phone+IP; status 'received' only — no email/SMS is sent)"),
  x("POST", "/api/v1/public/payments/webhook", "public", "Payment gateway webhook callback", "Third-party callback: signature-verified machine endpoint, not a client contract. Kept in the registry for the filesystem check only."),
  x("POST", "/api/v1/public/couriers/webhook", "public", "Courier webhook callback", "Third-party callback: signature-verified machine endpoint, not a client contract. Kept in the registry for the filesystem check only."),
];

/** Derive the route file for a registry path (used by the FS checker). */
export function routeFileForPath(path: string): string {
  const segments = path
    .replace(/^\//, "")
    .split("/")
    .map((seg) => (seg.startsWith("{") && seg.endsWith("}") ? `[${seg.slice(1, -1)}]` : seg));
  return `app/${segments.join("/")}/route.ts`;
}

function tagForPath(path: string): string {
  if (path === "/api/openapi.json") return "Meta";
  const parts = path.split("/").filter(Boolean); // [api, v1, admin|public, group, ...]
  const scope = parts[2] ?? "public";
  const group = parts[3] ?? scope;
  const pretty = group.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return scope === "admin" ? `Admin · ${pretty}` : `Public · ${pretty}`;
}

interface OpenApiOperation {
  summary: string;
  tags: string[];
  security?: Array<Record<string, string[]>>;
  responses: Record<string, { description: string; content?: Record<string, { schema: { $ref: string } }> }>;
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  tags: Array<{ name: string }>;
  paths: Record<string, Partial<Record<string, OpenApiOperation>>>;
  components: {
    securitySchemes: Record<string, { type: string; description: string }>;
    schemas: Record<string, unknown>;
  };
}

export function buildOpenApiDocument(): OpenApiDocument {
  const paths: Record<string, Record<string, OpenApiOperation>> = {};
  const tags = new Set<string>();

  for (const entry of API_ROUTE_REGISTRY) {
    if (!entry.includeInSpec) continue;
    const tag = tagForPath(entry.path);
    tags.add(tag);
    const operation: OpenApiOperation = {
      summary: entry.summary,
      tags: [tag],
      responses: {
        "200": {
          description: "Success envelope",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ApiSuccess" } } },
        },
        default: {
          description: "Error envelope",
          content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
        },
      },
    };
    if (entry.auth === "admin") operation.security = [{ adminSessionCookie: [] }];
    (paths[entry.path] ??= {})[entry.method.toLowerCase()] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Advance Ecommerce API",
      version: "1.0.0",
      description:
        "Versioned API for the Bangladesh-first single-tenant ecommerce platform. Success responses use { data, meta }; errors use { error: { code, message, details } }. Money is integer poisha in request/response bodies unless a summary says otherwise.",
    },
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        adminSessionCookie: {
          type: "apiKey",
          description: "HttpOnly admin session cookie issued by POST /api/v1/admin/auth/login (plus the 2FA step when enabled). Every admin operation also enforces a per-route permission server-side.",
        },
      },
      schemas: {
        ApiSuccess: {
          type: "object",
          required: ["data"],
          properties: {
            data: { description: "Operation payload (shape varies by operation)" },
            meta: { type: "object", description: "Pagination / provenance metadata" },
          },
        },
        ApiError: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                details: { description: "Optional structured details (e.g. Zod issues)" },
              },
            },
          },
        },
      },
    },
  };
}

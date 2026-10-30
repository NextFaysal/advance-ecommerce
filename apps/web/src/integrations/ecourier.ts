/**
 * eCourier LIVE adapter — ADV-5 completion (doc 22).
 *
 * Implements the CourierProvider interface (src/integrations/courier.ts)
 * against the eCourier merchant API, mirroring the Steadfast / RedX
 * live adapters (src/integrations/steadfast.ts, redx.ts)
 * contract-for-contract:
 *
 *   Base:     https://backoffice.ecourier.com.bd/api
 *   Auth:     THREE headers on every call — `API-KEY`, `API-SECRET`
 *             and `USER-ID` (the merchant's API credentials, issued
 *             by eCourier on request). They come from encrypted
 *             Settings — see ecourier-resolver.ts (Settings keys
 *             courier.ecourier.api_key / .api_secret / .user_id).
 *   Create:   POST /order-place { product_id, recipient_name,
 *             recipient_mobile, recipient_city, recipient_area,
 *             recipient_thana, recipient_address, recipient_zip,
 *             package_code, product_price, actual_product_price,
 *             payment_method, number_of_item, comments } — the v5.5
 *             General place-order parameter set (no `weight`, no
 *             `recipient_division`: weight rides on the package).
 *             `product_id` is the merchant-unique reference (v5.5
 *             caps it at 20 characters) — eCourier itself rejects a
 *             duplicate (product_id, mobile) pair — derived
 *             deterministically from (orderRef, idempotencyKey)
 *             exactly like the sibling adapters' invoice ids.
 *             `product_price` / `actual_product_price` are Integer
 *             (whole taka) in v5.5. `recipient_zip` is listed
 *             Mandatory with "Default null"; this platform carries
 *             no postcode, so null is sent explicitly. `package_code`
 *             is a merchant-assigned package from the eCourier panel
 *             (Settings courier.ecourier.package_code, part of the
 *             configured test): eCourier rejects a booking whose
 *             package code is not assigned to the merchant. The
 *             documented success response is ONLY
 *             { errors, response_code, message, ID } — no charge
 *             field (see the CHARGE note under HONESTY RULES).
 *   Status:   POST /track { ecr } — eCourier's API is POST-shaped
 *             even for reads. The v5.5 response carries the parcel
 *             records under `query_data` (the string "No Data Found"
 *             when the ECR is unknown); each record's `status` is an
 *             array of [label, comment, timestamp] triples, NEWEST
 *             FIRST — the current status is the FIRST triple's label.
 *   Cancel:   POST /cancel-order { tracking, comment } (v5.5 §2.4) —
 *             keyed by the ECR id this adapter persists as the
 *             Shipment trackingId; the response reports
 *             { success: "true" / "false", message } (string booleans).
 *   Packages: POST /packages — the merchant's assigned packages
 *             (the probe; also how an admin discovers package codes).
 *             The v5.5 response is a TOP-LEVEL JSON ARRAY of
 *             { package_name, package_code, shipping_charge, weight,
 *             delivery_time, coverage_id, coverage }.
 *
 * UNVERIFIED-API NOTE (honesty): no live eCourier account exists on
 * this install yet, so no call below has been exercised against the
 * real API from this codebase. The base URL, the three auth header
 * names, the endpoint paths and the request/response shapes are the
 * eCourier merchant API as published in eCourier's own "Merchant API
 * Document — General" v5.5 (this adapter was re-aligned to v5.5 after
 * an earlier v5.2 reading proved wrong on the track envelope, the
 * create-response charge and the cancel shape); response parsing
 * stays deliberately TOLERANT where the doc leaves room (error
 * bodies read in the documented `{ errors: [...], response_code }`
 * shape), and the first live booking MUST still be checked against
 * the merchant panel. Nothing in this module pretends a call
 * succeeded when the provider did not clearly accept it.
 *
 * HONESTY RULES (platform-wide, do not weaken — same as Steadfast):
 *  - A create the provider did not clearly accept THROWS
 *    EcourierProviderError (an HTTP-200 body carrying eCourier's
 *    `errors` array is a REJECTION and throws). Callers treat a
 *    resolved promise as a real booking, so returning a fabricated
 *    shipment would be a phantom booking — the throw is what gives
 *    BullMQ retry / dead-letter.
 *  - CANCEL: v5.5 §2.4 documents POST /cancel-order keyed by
 *    `tracking` — the ECR id, which this adapter persists as the
 *    Shipment trackingId — with a Mandatory `comment` (≤255 chars).
 *    cancelShipment calls it for real and only reports the cancel
 *    once eCourier answers success "true"; a provider refusal (or an
 *    unreadable answer) throws, and nothing is marked cancelled
 *    locally on the provider's behalf. (An earlier reading of the
 *    docs claimed the cancel was keyed by product_id with an
 *    unverified shape — v5.5 contradicts that; the ECR-keyed call
 *    above is the documented one.)
 *  - successRate: no per-phone delivery-history endpoint is known,
 *    so the adapter returns zero counts + successRatePercent null
 *    ("no data") — never simulated numbers.
 *  - CHARGE: the v5.5 create response carries NO charge field, so a
 *    booking's persisted charge resolves from the assigned package's
 *    `shipping_charge` (the /packages list) and falls back to 0 when
 *    even that cannot be read — the booking is real the moment the
 *    ID is in hand and must never throw over a missing charge; the
 *    parcel's true charge reconciles later from /track's
 *    `shipping_price`. getRates stays the platform rate-card
 *    ESTIMATE (courierChargePoisha, the same function the sandbox
 *    uses).
 *  - Money: eCourier amounts are BDT; they are converted to integer
 *    poisha exactly once, at this boundary. The two price fields on
 *    create are whole-taka Integers in v5.5, so they round at this
 *    boundary (the only place a fractional taka is dropped; the COD
 *    amount of record stays integer poisha on our side).
 *  - The API key / secret are constructor inputs only — never
 *    logged, never in an error message, never in a URL this module
 *    builds. (Provider error STRINGS from eCourier's `errors` array
 *    are surfaced: they describe the request, never the credentials.)
 *
 * Persistence: bookings persist through the shared shipment store
 * (src/integrations/sandbox/db-store.ts — the DB layer every courier
 * booking uses; the "sandbox" in its path is historical). The store
 * is injected for smoke-testability and the default store loads
 * LAZILY (dynamic import) so this module never pulls Prisma in at
 * import time — the worker-deps landmine rule. Shipment row id =
 * `EC-<ecr>`; trackingId = eCourier's ECR id (the `ID` the create
 * response returns).
 */
import { z } from "zod";
import { normalizeBdPhone } from "../checkout/validation";
import type {
  CourierProvider,
  CourierRate,
  CourierRateInput,
  CourierSuccessRate,
  CreateShipmentInput,
  CreateShipmentResult,
  ShipmentAddress,
  ShipmentStatus,
} from "./courier";
import { courierChargePoisha } from "./sandbox/courier-rates";
import type { ProviderConfig, WebhookVerification } from "./types";

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class EcourierProviderError extends Error {
  readonly provider = "ecourier" as const;
  /** Machine code: NOT_CONFIGURED | NOT_SUPPORTED | INVALID_INPUT |
   *  INVALID_PHONE | NETWORK | HTTP_<status> | ECOURIER_<response_code> |
   *  NOT_FOUND | UNRECOGNIZED_RESPONSE. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EcourierProviderError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Status mapping — the single source for the live adapter + webhook   */
/* ------------------------------------------------------------------ */

/** Normalise a raw eCourier status for map lookup: case/space/hyphen
 *  differences ("in-transit", "In Transit") must not matter. */
export function normalizeEcourierStatus(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export const ECOURIER_DELIVERY_STATUS_MAP: Record<string, ShipmentStatus> = {
  pending: "CREATED",
  // v5.5 doc label "Initiated" — the parcel's first documented state.
  initiated: "CREATED",
  order_placed: "CREATED",
  order_created: "CREATED",
  created: "CREATED",
  booked: "CREATED",
  picked: "PICKED_UP",
  picked_up: "PICKED_UP",
  pickup_done: "PICKED_UP",
  pickup_completed: "PICKED_UP",
  collected: "PICKED_UP",
  in_transit: "IN_TRANSIT",
  in_progress: "IN_TRANSIT",
  transit: "IN_TRANSIT",
  at_hub: "IN_TRANSIT",
  at_sorting_hub: "IN_TRANSIT",
  // v5.5 doc labels "In Source Branch" / "In Destination Branch".
  in_source_branch: "IN_TRANSIT",
  in_destination_branch: "IN_TRANSIT",
  hold: "IN_TRANSIT",
  on_hold: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY",
  on_the_way: "OUT_FOR_DELIVERY",
  // v5.5 doc label "On the way to Delivery".
  on_the_way_to_delivery: "OUT_FOR_DELIVERY",
  delivering: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
  partial_delivered: "DELIVERED",
  partially_delivered: "DELIVERED",
  delivery_failed: "FAILED",
  failed: "FAILED",
  attempt_failed: "FAILED",
  undelivered: "FAILED",
  // ShipmentStatus has no CANCELLED value; a provider-side cancel is a
  // terminal failure of the shipment (same convention as Steadfast).
  cancelled: "FAILED",
  canceled: "FAILED",
  returning: "RETURNING",
  return_in_transit: "RETURNING",
  return_pending: "RETURNING",
  returned: "RETURNED",
  return_delivered: "RETURNED",
};

/** Map a raw eCourier status to the internal ShipmentStatus. Unknown
 *  raw values return null (rejected, never coerced). */
export function mapEcourierDeliveryStatus(rawStatus: string): ShipmentStatus | null {
  return ECOURIER_DELIVERY_STATUS_MAP[normalizeEcourierStatus(rawStatus)] ?? null;
}

/* ------------------------------------------------------------------ */
/* Money — BDT decimal <-> integer poisha, converted exactly once      */
/* ------------------------------------------------------------------ */

/** BDT decimal (number or numeric string, as eCourier returns) ->
 *  integer poisha. Throws on a non-numeric value: a charge we cannot
 *  read is never persisted as a guessed number. */
export function ecourierBdtToPoisha(value: unknown): number {
  const num =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(num)) {
    throw new EcourierProviderError(
      "UNRECOGNIZED_RESPONSE",
      "eCourier returned a non-numeric BDT amount.",
    );
  }
  return Math.round(num * 100);
}

/** Integer poisha -> the BDT decimal number eCourier expects
 *  (product_price). Rounded to 2dp so no float dust reaches the
 *  wire. */
export function poishaToEcourierBdt(poisha: number): number {
  return Number((poisha / 100).toFixed(2));
}

/** Integer poisha -> the WHOLE-TAKA Integer eCourier v5.5 types
 *  `product_price` / `actual_product_price` as. Rounds at this
 *  boundary only (see the Money note in the file header). */
export function poishaToEcourierIntegerTaka(poisha: number): number {
  return Math.round(poisha / 100);
}

/* ------------------------------------------------------------------ */
/* Pure request shaping (exported for smoke tests)                     */
/* ------------------------------------------------------------------ */

function stableHash36(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/** eCourier `product_id` is the merchant-unique reference: eCourier
 *  rejects a duplicate (product_id, recipient mobile) pair instead
 *  of booking a second parcel. Deriving it deterministically from
 *  (orderRef, idempotencyKey) means a BullMQ retry of the same
 *  booking job reuses the same reference — and our own store replay
 *  check returns the original booking before any network call.
 *  v5.5 caps `product_id` at 20 characters, so the id is a short
 *  readable order-ref prefix plus an 8-char hash widened from the
 *  same (orderRef, idempotencyKey) seed (11 + 1 + 8 = 20 max). */
export function buildEcourierProductId(orderRef: string, idempotencyKey: string): string {
  const base = orderRef.replace(/[^A-Za-z0-9-]/g, "").slice(0, 11) || "ORDER";
  const seed = `${orderRef}:${idempotencyKey}`;
  let hash = "";
  let salt = 0;
  while (hash.length < 8) {
    hash += stableHash36(salt === 0 ? seed : `${seed}#${salt}`);
    salt += 1;
  }
  return `${base}-${hash.slice(0, 8)}`;
}

/** eCourier's recipient_address is the free-text detail address;
 *  compose it from the structured BD address (line first, then
 *  union/upazila/district/division), skipping empty parts. The
 *  structured parts ALSO ride separately (city/area/thana), which
 *  is how eCourier routes the parcel. */
export function composeEcourierAddress(address: ShipmentAddress): string {
  return [address.addressLine, address.union, address.upazila, address.district, address.division]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(", ");
}

/** Normalised BD mobile in eCourier's local form (01XXXXXXXXX —
 *  exactly 11 digits, as its API requires). Throws INVALID_PHONE
 *  before any network call on a bad number. */
export function ecourierRecipientPhone(raw: string): string {
  const normalized = normalizeBdPhone(raw);
  if (normalized === null) {
    throw new EcourierProviderError("INVALID_PHONE", "Recipient is not a valid BD mobile number.");
  }
  return `0${normalized.slice(4)}`; // "+880" + 10 digits -> "0" + 10 digits
}

/** Grams -> kg decimal. The v5.5 place-order call sends no weight
 *  (weight rides on the package), so the create body no longer uses
 *  this; kept as the module's grams->kg converter of record. */
export function gramsToEcourierKg(weightGrams: number): number {
  return Number((weightGrams / 1000).toFixed(2));
}

export interface EcourierCreateOrderBody {
  /** Merchant-unique reference (see buildEcourierProductId). */
  product_id: string;
  recipient_name: string;
  recipient_mobile: string;
  /** eCourier routes by NAME: city = district, area/thana = upazila. */
  recipient_city: string;
  recipient_area: string;
  recipient_thana: string;
  recipient_address: string;
  /** v5.5 lists recipient_zip Mandatory with "Default null"; this
   *  platform carries no postcode, so the documented default is
   *  sent explicitly. */
  recipient_zip: null;
  /** Merchant-assigned package code (Settings courier.ecourier.package_code). */
  package_code: string;
  /** Whole-taka Integer (v5.5 types both price fields as Integer —
   *  converted from poisha once, at this boundary). */
  product_price: number;
  actual_product_price: number;
  /** "COD" — this platform books cash-on-delivery parcels; a prepaid
   *  order rides with product_price 0 (see the header note). */
  payment_method: "COD";
  number_of_item: number;
  comments: string;
}

export function buildEcourierCreateOrderBody(
  input: CreateShipmentInput,
  productId: string,
  packageCode: string,
): EcourierCreateOrderBody {
  return {
    product_id: productId,
    recipient_name: input.address.recipientName,
    recipient_mobile: ecourierRecipientPhone(input.address.recipientPhone),
    recipient_city: input.address.district,
    recipient_area: input.address.upazila,
    recipient_thana: input.address.upazila,
    recipient_address: composeEcourierAddress(input.address),
    recipient_zip: null,
    package_code: packageCode,
    product_price: poishaToEcourierIntegerTaka(input.codAmountPoisha),
    actual_product_price: poishaToEcourierIntegerTaka(input.codAmountPoisha),
    payment_method: "COD",
    number_of_item: input.itemCount,
    comments: input.note ?? "",
  };
}

/* ------------------------------------------------------------------ */
/* Webhook payload normaliser (pure; the route owns verification)      */
/* ------------------------------------------------------------------ */

export interface EcourierWebhookEvent {
  trackingId: string;
  rawStatus: string;
  productId: string | null;
  /** COD the payload reports (poisha), converted from a BDT field at
   *  this boundary; the order-sync funnel only applies it on a
   *  DELIVERED event. */
  codCollectedPoisha: number | null;
  /** Deterministic per (ecr, status, updated_at) so an eCourier
   *  retry of the same event dedupes against the ShipmentEvent
   *  UNIQUE key and the webhook result cache. NOTE: eCourier
   *  publishes no signed webhook in anything this codebase can
   *  verify — this parser exists so the platform's
   *  LIVE_WEBHOOK_SPECS contract has an eCourier entry ready if the
   *  merchant panel offers one; status polling (getStatus) is the
   *  working path today. */
  idempotencyKey: string;
}

/** Parse an eCourier webhook body — provider spellings (ecr /
 *  product_id / status) and sandbox spellings (trackingId /
 *  rawStatus) are both accepted. Returns null when the event cannot
 *  be identified (no ECR id or no status): the route rejects it,
 *  nothing is applied. */
export function parseEcourierWebhookBody(body: unknown): EcourierWebhookEvent | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const str = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return null;
  };
  const trackingId = str("ecr", "tracking_id", "trackingId", "tracking_number");
  const rawStatus = str("status", "delivery_status", "parcel_status", "rawStatus");
  if (trackingId === null || rawStatus === null) return null;
  const productId = str("product_id", "productId");
  const updatedAt = str("updated_at", "updatedAt");
  let codCollectedPoisha: number | null = null;
  const poishaField = record.codCollectedPoisha ?? record.codAmountPoisha;
  if (typeof poishaField === "number" && Number.isInteger(poishaField) && poishaField >= 0) {
    codCollectedPoisha = poishaField;
  } else {
    const bdtField = record.collected_amount ?? record.cash_collection_amount ?? record.cod_amount;
    if (bdtField !== undefined && bdtField !== null) {
      try {
        codCollectedPoisha = ecourierBdtToPoisha(bdtField);
      } catch {
        codCollectedPoisha = null;
      }
    }
  }
  return {
    trackingId,
    rawStatus,
    productId,
    codCollectedPoisha,
    idempotencyKey: `ecourier:${trackingId}:${normalizeEcourierStatus(rawStatus)}:${updatedAt ?? "na"}`,
  };
}

/* ------------------------------------------------------------------ */
/* Shipment persistence (injected; default = the shared DB store)      */
/* ------------------------------------------------------------------ */

export interface EcourierShipmentRecord {
  shipmentId: string;
  trackingId: string;
  status: ShipmentStatus;
  statusHistory: ShipmentStatus[];
}

export interface EcourierShipmentStore {
  /** The shipment a previous booking with this idempotency key made. */
  findByBookingKey(idempotencyKey: string): Promise<EcourierShipmentRecord | null>;
  findById(shipmentId: string): Promise<EcourierShipmentRecord | null>;
  findByTracking(trackingId: string): Promise<EcourierShipmentRecord | null>;
  create(input: {
    shipmentId: string;
    trackingId: string;
    provider: string;
    orderRef: string;
    codAmountPoisha: number;
    weightGrams: number;
    chargePoisha: number;
    idempotencyKey: string;
  }): Promise<EcourierShipmentRecord>;
}

async function defaultStore(): Promise<EcourierShipmentStore> {
  // Lazy: the DB store imports Prisma at module top level; loading it
  // only inside a booking keeps this module import-safe everywhere
  // (routes, smokes, client-adjacent graphs) — worker-deps rule.
  const db = await import("./sandbox/db-store");
  return {
    async findByBookingKey(idempotencyKey) {
      const event = await db.findShipmentEventByIdempotencyKey(`booking:${idempotencyKey}`);
      if (event === null) return null;
      return db.findShipmentById(event.shipmentId);
    },
    findById: (shipmentId) => db.findShipmentById(shipmentId),
    findByTracking: (trackingId) => db.findShipmentByTracking(trackingId, "ecourier"),
    create: (input) => db.createShipmentRow(input),
  };
}

/* ------------------------------------------------------------------ */
/* The adapter                                                         */
/* ------------------------------------------------------------------ */

export interface EcourierCredentials {
  apiKey: string;
  apiSecret: string;
  userId: string;
  /** Merchant-assigned package code (Settings
   *  courier.ecourier.package_code) — required to book. */
  packageCode: string;
}

export type EcourierFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface EcourierAdapterOptions {
  fetchFn?: EcourierFetch;
  timeoutMs?: number;
  store?: EcourierShipmentStore;
  baseUrl?: string;
}

export interface EcourierPackage {
  code: string;
  name: string | null;
  /** The package's `shipping_charge` (BDT on the wire -> integer
   *  poisha here); null when the list item carries no readable
   *  charge. This is the create-charge fallback: the v5.5
   *  order-place response itself carries no charge field. */
  chargePoisha: number | null;
}

/** The live eCourier provider: the CourierProvider contract plus the
 *  assigned-package list the merchant API offers (the probe). */
export interface EcourierCourierProvider extends CourierProvider {
  listPackages(): Promise<EcourierPackage[]>;
}

export const ECOURIER_API_BASE = "https://backoffice.ecourier.com.bd/api";

/** Our Shipment row id for an eCourier parcel. */
export function ecourierShipmentId(ecr: string): string {
  return `EC-${ecr}`;
}

const DEFAULT_TIMEOUT_MS = 20_000;

const createSchema = z.object({
  orderId: z.string().min(1),
  codAmountPoisha: z.number().int().nonnegative(),
  weightGrams: z.number().int().positive(),
  itemCount: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
});

function liveConfig(): ProviderConfig {
  return {
    provider: "ecourier",
    enabled: true,
    mode: "live",
    status: "configured",
    // A reference to where the credentials live — never the values.
    credentialRef: "settings:courier.ecourier",
    lastTestedAt: null,
    lastError: null,
  };
}

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** eCourier reports application-level failures in the BODY —
 *  `{ errors: [...], response_code: 400 }` — sometimes under an
 *  HTTP 200. Returns the provider's error detail when the body is
 *  such a rejection, else null. The error strings describe the
 *  request (never the credentials), so surfacing the first one is
 *  safe and actionable. */
function providerRejection(json: Record<string, unknown>): { code: string; message: string } | null {
  const errors = Array.isArray(json.errors)
    ? json.errors.filter((e): e is string => typeof e === "string" && e.trim() !== "")
    : [];
  const responseCode =
    typeof json.response_code === "number"
      ? json.response_code
      : typeof json.response_code === "string" && Number.isFinite(Number(json.response_code))
        ? Number(json.response_code)
        : null;
  if (errors.length > 0) {
    return {
      code: `ECOURIER_${responseCode ?? "ERROR"}`,
      message: `eCourier rejected the request: ${errors.join("; ")}`,
    };
  }
  if (responseCode !== null && responseCode >= 400) {
    return {
      code: `ECOURIER_${responseCode}`,
      message: `eCourier rejected the request (response_code ${responseCode}).`,
    };
  }
  if (json.success === false) {
    return {
      code: "ECOURIER_REJECTED",
      message: `eCourier rejected the request: ${stringField(json, "message") ?? "provider reported failure"}`,
    };
  }
  return null;
}

export function createEcourierProvider(
  creds: EcourierCredentials,
  opts: EcourierAdapterOptions = {},
): EcourierCourierProvider {
  if (creds.apiKey.trim() === "" || creds.apiSecret.trim() === "" || creds.userId.trim() === "") {
    throw new EcourierProviderError(
      "NOT_CONFIGURED",
      "eCourier api_key, api_secret and user_id are all required.",
    );
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = (opts.baseUrl ?? ECOURIER_API_BASE).replace(/\/+$/, "");
  const injectedStore = opts.store ?? null;

  async function store(): Promise<EcourierShipmentStore> {
    return injectedStore ?? defaultStore();
  }

  /** One POST against the merchant API, returning the parsed JSON
   *  AS-IS (object, array or scalar): /packages answers with a
   *  TOP-LEVEL ARRAY in v5.5, so the record-shape requirement lives
   *  in callApi below, not here. A record-shaped body is still run
   *  through the documented rejection check (`errors` /
   *  `response_code`) before it is handed back. */
  async function callApiJson(path: string, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          // eCourier merchant API auth (see the UNVERIFIED note in
          // the file header — re-verify at first live use).
          "API-KEY": creds.apiKey,
          "API-SECRET": creds.apiSecret,
          "USER-ID": creds.userId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // No URL/headers in the message: nothing here may carry a secret.
      throw new EcourierProviderError("NETWORK", "eCourier request failed (network error or timeout).");
    }
    const text = await res.text().catch(() => "");
    if (res.status < 200 || res.status >= 300) {
      throw new EcourierProviderError(`HTTP_${res.status}`, `eCourier returned HTTP ${res.status}.`);
    }
    const json = parseJsonLoose(text);
    if (json === null) {
      throw new EcourierProviderError("UNRECOGNIZED_RESPONSE", "eCourier returned a non-JSON response.");
    }
    const record = asRecord(json);
    if (record !== null) {
      const rejection = providerRejection(record);
      if (rejection !== null) {
        throw new EcourierProviderError(rejection.code, rejection.message);
      }
    }
    return json;
  }

  /** callApiJson for the endpoints whose documented response is a
   *  JSON object (order-place, track, cancel-order). */
  async function callApi(path: string, body: unknown): Promise<Record<string, unknown>> {
    const json = asRecord(await callApiJson(path, body));
    if (json === null) {
      throw new EcourierProviderError(
        "UNRECOGNIZED_RESPONSE",
        "eCourier returned an unexpected (non-object) response.",
      );
    }
    return json;
  }

  async function listPackages(): Promise<EcourierPackage[]> {
    const json = await callApiJson("/packages", {});
    let list: unknown = null;
    // v5.5: the response IS the array. The data/packages envelopes
    // stay as tolerance for older response shapes.
    if (Array.isArray(json)) list = json;
    else {
      const record = asRecord(json);
      if (record !== null) {
        if (Array.isArray(record.data)) list = record.data;
        else if (Array.isArray(record.packages)) list = record.packages;
      }
    }
    if (!Array.isArray(list)) return [];
    const out: EcourierPackage[] = [];
    for (const item of list) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      const code = stringField(record, "package_code", "code", "package_id");
      if (code !== null) {
        let chargePoisha: number | null = null;
        const chargeField = record.shipping_charge;
        if (chargeField !== undefined && chargeField !== null) {
          try {
            chargePoisha = ecourierBdtToPoisha(chargeField);
          } catch {
            chargePoisha = null;
          }
        }
        out.push({
          code,
          name: stringField(record, "package_name", "name", "title"),
          chargePoisha,
        });
      }
    }
    return out;
  }

  /** The charge eCourier recorded for a parcel (BDT field ->
   *  poisha); null when the record carries none. `shipping_price`
   *  is the field the v5.5 /track record carries. */
  function chargeFromRecord(record: Record<string, unknown>): number | null {
    const field =
      record.delivery_charge ??
      record.shipping_price ??
      record.shipping_charge ??
      record.charge ??
      record.delivery_fee ??
      record.total_charge;
    if (field === undefined || field === null) return null;
    try {
      return ecourierBdtToPoisha(field);
    } catch {
      return null;
    }
  }

  /** One tracking read, reduced to its status-bearing record.
   *  v5.5 shape: the parcel records ride under `query_data` — an
   *  ARRAY of records (one for an ECR lookup), or the STRING
   *  "No Data Found" when the ECR is unknown. Each record's `status`
   *  is an array of [label, comment, timestamp] triples listed
   *  NEWEST FIRST, so the current status is the FIRST triple's
   *  label. The returned record keeps the whole parcel record
   *  (including `shipping_price`, the charge of record) with
   *  `status` reduced to that current label string. */
  async function fetchTrackingRecord(ecr: string): Promise<Record<string, unknown>> {
    const json = await callApi("/track", { ecr });
    const nested = asRecord(json.data);
    const queryData = json.query_data ?? nested?.query_data;
    if (typeof queryData === "string") {
      // Documented order-missing shape: query_data: "No Data Found".
      throw new EcourierProviderError(
        "NOT_FOUND",
        `eCourier has no parcel for ECR ${ecr} (${queryData}).`,
      );
    }
    if (Array.isArray(queryData)) {
      if (queryData.length === 0) {
        throw new EcourierProviderError("NOT_FOUND", `eCourier has no parcel for ECR ${ecr}.`);
      }
      const record = asRecord(queryData[0]);
      if (record === null) {
        throw new EcourierProviderError(
          "UNRECOGNIZED_RESPONSE",
          "eCourier tracking response had no status record.",
        );
      }
      let label: string | null = null;
      const triples = record.status;
      if (Array.isArray(triples) && triples.length > 0) {
        const first = triples[0];
        if (Array.isArray(first)) {
          if (typeof first[0] === "string" && first[0].trim() !== "") label = first[0];
        } else if (typeof first === "string" && first.trim() !== "") {
          label = first;
        }
      }
      if (label === null && typeof record.status === "string" && record.status.trim() !== "") {
        label = record.status;
      }
      if (label === null) {
        throw new EcourierProviderError(
          "UNRECOGNIZED_RESPONSE",
          "eCourier tracking record had no readable status.",
        );
      }
      return { ...record, status: label };
    }
    // Tolerance fallback: a plain record (or `data` record) carrying
    // a string status, for response shapes outside the v5.5 doc.
    const data = json.data ?? json.tracking ?? json;
    const record = asRecord(data);
    if (record === null || typeof record.status !== "string") {
      throw new EcourierProviderError(
        "UNRECOGNIZED_RESPONSE",
        "eCourier tracking response had no status record.",
      );
    }
    return record;
  }

  return {
    name: "ecourier",
    config: liveConfig(),

    async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
      const parsed = createSchema.safeParse(input);
      if (!parsed.success) {
        throw new EcourierProviderError("INVALID_INPUT", "Invalid shipment input.");
      }
      if (input.provider !== "ecourier") {
        throw new EcourierProviderError(
          "INVALID_INPUT",
          `eCourier adapter cannot book provider "${input.provider}".`,
        );
      }
      if (creds.packageCode.trim() === "") {
        // eCourier rejects a booking whose package code is not one
        // it assigned to this merchant — fail before the network
        // with the exact Settings key to fill.
        throw new EcourierProviderError(
          "INVALID_INPUT",
          "courier.ecourier.package_code is not set — eCourier requires a merchant-assigned package code to book.",
        );
      }
      const shipments = await store();
      // Replay first (same contract as the sandbox + Steadfast
      // providers): a retry of an already-booked job returns the
      // stored booking and never touches the network.
      const existing = await shipments.findByBookingKey(parsed.data.idempotencyKey);
      if (existing !== null) {
        return {
          shipmentId: existing.shipmentId,
          trackingId: existing.trackingId,
          status: existing.status,
          labelUrl: null,
        };
      }
      const productId = buildEcourierProductId(parsed.data.orderId, parsed.data.idempotencyKey);
      const body = buildEcourierCreateOrderBody(input, productId, creds.packageCode.trim());
      const json = await callApi("/order-place", body);
      const data = asRecord(json.data) ?? json;
      // The ECR id is the parcel's identity (the response's `ID`).
      const ecr = stringField(data, "ID", "id", "ecr", "tracking_id", "tracking_number");
      if (ecr === null) {
        throw new EcourierProviderError(
          "UNRECOGNIZED_RESPONSE",
          "eCourier order-place response had no parcel id (ID).",
        );
      }
      // CHARGE (choice, per v5.5): the documented order-place
      // response — { errors, response_code, message, ID } — carries
      // NO charge field, so the previous "throw when no charge is
      // readable" behaviour would have failed every real booking
      // AFTER eCourier accepted it. The booking therefore succeeds
      // on the ID alone, and the persisted charge resolves as: a
      // charge field on the response when one is present (tolerant
      // read), else the assigned package's `shipping_charge` from
      // the /packages list, else 0. 0 means "charge not yet known",
      // never a guessed number — the parcel's true charge
      // reconciles later from /track's `shipping_price`.
      let chargePoisha = chargeFromRecord(data);
      if (chargePoisha === null) {
        try {
          const packages = await listPackages();
          const own = packages.find((p) => p.code === creds.packageCode.trim());
          chargePoisha = own?.chargePoisha ?? null;
        } catch {
          chargePoisha = null;
        }
      }
      const persistedChargePoisha = chargePoisha ?? 0;
      const shipmentId = ecourierShipmentId(ecr);
      try {
        const shipment = await shipments.create({
          shipmentId,
          trackingId: ecr,
          provider: "ecourier",
          orderRef: parsed.data.orderId,
          codAmountPoisha: parsed.data.codAmountPoisha,
          weightGrams: parsed.data.weightGrams,
          chargePoisha: persistedChargePoisha,
          idempotencyKey: parsed.data.idempotencyKey,
        });
        return {
          shipmentId,
          trackingId: shipment.trackingId,
          status: shipment.status,
          labelUrl: null,
        };
      } catch (err) {
        // UNIQUE (id / trackingId) backstop: a concurrent replay won.
        if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
          const winner =
            (await shipments.findById(shipmentId)) ?? (await shipments.findByTracking(ecr));
          if (winner !== null) {
            return {
              shipmentId: winner.shipmentId,
              trackingId: winner.trackingId,
              status: winner.status,
              labelUrl: null,
            };
          }
        }
        throw err;
      }
    },

    async cancelShipment(shipmentId: string) {
      // v5.5 §2.4: POST /cancel-order { tracking, comment } — keyed
      // by the ECR id, the very value this adapter persists as the
      // Shipment trackingId (our row id is `EC-<ecr>`). The stored
      // row's trackingId is authoritative when the row is readable;
      // the id itself is the fallback (it embeds the ECR).
      let ecr = shipmentId.startsWith("EC-") ? shipmentId.slice(3) : shipmentId;
      try {
        const shipments = await store();
        const row = await shipments.findById(shipmentId);
        if (row !== null && row.trackingId.trim() !== "") ecr = row.trackingId;
      } catch {
        // Store unreadable: fall back to the id-derived ECR.
      }
      if (ecr.trim() === "") {
        throw new EcourierProviderError(
          "INVALID_INPUT",
          "eCourier cancel needs a shipment with a known ECR id.",
        );
      }
      // `comment` is Mandatory (≤255 chars); the interface carries
      // no caller reason, so a fixed merchant-side default is sent.
      const comment = "Cancelled by the merchant from the store admin panel.".slice(0, 255);
      const json = await callApi("/cancel-order", { tracking: ecr, comment });
      // The documented answer is { success: "true" / "false",
      // message } — STRING booleans. Anything but an explicit true
      // (a "false", or a shape we cannot read) is NOT a cancel: the
      // parcel stays live provider-side and the caller must see the
      // failure, never a fabricated local cancel.
      const succeeded = json.success === true || json.success === "true";
      if (!succeeded) {
        throw new EcourierProviderError(
          "ECOURIER_REJECTED",
          `eCourier did not cancel parcel ${ecr}: ${stringField(json, "message") ?? "provider reported failure"}`,
        );
      }
      // ShipmentStatus has no CANCELLED value; a provider-confirmed
      // cancel is the terminal FAILED state (the status map's
      // convention for provider-side cancels).
      const status: ShipmentStatus = "FAILED";
      return { status };
    },

    async getStatus(trackingId: string) {
      // Accepts an ECR id, or our `EC-<ecr>` shipment id.
      const ecr = trackingId.startsWith("EC-") ? trackingId.slice(3) : trackingId;
      const data = await fetchTrackingRecord(ecr);
      const raw = stringField(data, "status", "status_name", "status_text", "current_status", "parcel_status");
      if (raw === null) {
        throw new EcourierProviderError(
          "UNRECOGNIZED_RESPONSE",
          "eCourier tracking response had no status field.",
        );
      }
      const status = mapEcourierDeliveryStatus(raw);
      if (status === null) {
        throw new EcourierProviderError(
          "UNRECOGNIZED_RESPONSE",
          `eCourier returned an unknown status "${raw}".`,
        );
      }
      // Events: the history is our own Shipment row's (empty when
      // the parcel was booked outside this install — reported
      // honestly, not invented).
      let events: string[] = [];
      try {
        const shipments = await store();
        const row = await shipments.findByTracking(trackingId);
        if (row !== null) events = [...row.statusHistory];
      } catch {
        events = [];
      }
      return { status, events };
    },

    async getRates(input: CourierRateInput): Promise<CourierRate[]> {
      // Platform rate-card ESTIMATE (see header): the persisted
      // booking charge comes from the package's shipping_charge
      // (the v5.5 create response carries no charge at all).
      return [
        {
          provider: "ecourier",
          chargePoisha: courierChargePoisha(input.zone, input.weightGrams),
          estimatedDays: 3,
        },
      ];
    },

    async handleWebhook(_verification: WebhookVerification): Promise<boolean> {
      // Routes go through the couriers webhook route (processWebhook:
      // signature + idempotency + order-sync funnel). Direct calls
      // never apply — same convention as the sandbox providers.
      void _verification;
      return false;
    },

    async successRate(phone: string): Promise<CourierSuccessRate> {
      // No per-phone history endpoint is known (see header): zero
      // counts + null rate is the honest "no data" shape.
      return { phone, delivered: 0, failed: 0, returned: 0, successRatePercent: null };
    },

    listPackages,
  };
}

/**
 * AdvancePartnerClient — a zero-dependency, fetch-based client for
 * the Advance Ecommerce partner API.
 *
 * The API surface is deliberately small — three read-only list
 * endpoints, each gated by its own scope on the API key:
 *
 *   GET /api/v1/partner/products    scope products:read
 *   GET /api/v1/partner/orders      scope orders:read
 *   GET /api/v1/partner/customers   scope customers:read
 *
 * Auth is `Authorization: Bearer ae_live_…` (the key a merchant
 * creates under Admin → Webhooks → API keys). Errors arrive as
 * `{ error: { code, message } }` and are thrown as PartnerApiError
 * carrying the server's code/message plus the HTTP status:
 *
 *   401 UNAUTHENTICATED — key missing, unknown, revoked, or expired
 *   403 FORBIDDEN       — key lacks the endpoint's scope
 *   429 RATE_LIMITED    — 120 requests/minute per key (Retry-After set)
 */
import type {
  ListOptions,
  PartnerCustomer,
  PartnerOrder,
  PartnerProduct,
  PartnerResponseMeta,
} from "./types";

export interface AdvancePartnerClientOptions {
  /** The store's origin, e.g. "https://store.example.com" (no path). */
  baseUrl: string;
  /** Partner API key (`ae_live_…`), shown once when created in admin. */
  apiKey: string;
  /** Override the fetch implementation (tests, non-standard runtimes). */
  fetchImpl?: typeof fetch;
}

export class PartnerApiError extends Error {
  /** HTTP status, or 0 when the request never reached the server. */
  readonly status: number;
  /** The server's error code, e.g. "UNAUTHENTICATED" | "FORBIDDEN" | "RATE_LIMITED". */
  readonly code: string;
  /** Seconds to wait before retrying (429 only), from Retry-After. */
  readonly retryAfterSeconds: number | null;

  constructor(status: number, code: string, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "PartnerApiError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface ListEnvelope<T> {
  data: Record<string, T[]>;
  meta: PartnerResponseMeta;
}

export class AdvancePartnerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AdvancePartnerClientOptions) {
    if (!options.baseUrl) throw new Error("AdvancePartnerClient: baseUrl is required");
    if (!options.apiKey) throw new Error("AdvancePartnerClient: apiKey is required");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Most recent products first. Requires the `products:read` scope. */
  async listProducts(options: ListOptions = {}): Promise<PartnerProduct[]> {
    return this.list<PartnerProduct>("/api/v1/partner/products", "products", options);
  }

  /** Most recent orders first. Requires the `orders:read` scope. */
  async listOrders(options: ListOptions = {}): Promise<PartnerOrder[]> {
    return this.list<PartnerOrder>("/api/v1/partner/orders", "orders", options);
  }

  /** Most recent customers first. Requires the `customers:read` scope. */
  async listCustomers(options: ListOptions = {}): Promise<PartnerCustomer[]> {
    return this.list<PartnerCustomer>("/api/v1/partner/customers", "customers", options);
  }

  private async list<T>(path: string, dataKey: string, options: ListOptions): Promise<T[]> {
    const url = new URL(path, this.baseUrl);
    if (options.limit !== undefined) url.searchParams.set("limit", String(options.limit));

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          accept: "application/json",
        },
      });
    } catch (cause) {
      throw new PartnerApiError(
        0,
        "NETWORK_ERROR",
        cause instanceof Error ? cause.message : "Network request failed",
      );
    }

    if (!response.ok) {
      throw await this.toApiError(response);
    }
    const body = (await response.json()) as ListEnvelope<T>;
    return body.data[dataKey] ?? [];
  }

  private async toApiError(response: Response): Promise<PartnerApiError> {
    let code = `HTTP_${response.status}`;
    let message = response.statusText || `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body — keep the status-derived code/message.
    }
    const retryAfterRaw = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterRaw !== null && Number.isFinite(Number(retryAfterRaw))
      ? Number(retryAfterRaw)
      : null;
    return new PartnerApiError(response.status, code, message, retryAfterSeconds);
  }
}

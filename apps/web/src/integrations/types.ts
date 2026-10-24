// Shared integration types — Agent 5 (Steps 19-27, adapter + settings base only).
// No real API calls, no real credentials. Sandbox only in comments. Never live keys.
// Rule: env = default/fallback, Admin > Settings (DB, encrypted) = override.
// Money is integer poisha everywhere. All external work goes to a queue with retry;
// the request that triggered it must never block on a third-party API.

export type IntegrationMode = "sandbox" | "live";

export type ProviderStatus = "not_configured" | "configured" | "connected" | "error";

/** Admin-configurable provider config. Secrets live in Admin Settings (encrypted), never in env-only code. */
export interface ProviderConfig {
  provider: string;
  enabled: boolean;
  mode: IntegrationMode;
  /** Status is derived from a test-connection check, never stored from a real call in this base. */
  status: ProviderStatus;
  /** Encrypted credential reference — the value itself is never carried in code or logs. */
  credentialRef: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
}

export interface Idempotency {
  /** Client-supplied key: order create, payment callback, webhook, courier callback. Replays return the original result. */
  idempotencyKey: string;
}

export interface WebhookVerification {
  /** Verify signature (e.g. HMAC) before processing. Unverified webhooks are rejected and logged, never applied. */
  signature: string;
  rawBody: string;
  timestamp?: string;
}

export interface QueueJob {
  jobId: string;
  type: string;
  payloadRef: string;
  attempts: number;
  maxAttempts: number;
  /** Backoff + auto-retry outline; on final failure, surface a manual fallback in admin (see adapters). */
  nextRetryAt: string | null;
  status: "queued" | "processing" | "succeeded" | "failed" | "manual_fallback";
}

export interface TestConnectionResult {
  ok: boolean;
  status: ProviderStatus;
  message: string;
  /** No credential values in this result, ever. */
  checkedAt: string;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { total: number; page: number; perPage: number };
}

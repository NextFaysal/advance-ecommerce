/**
 * Outbound connectors — ADV-25 part 2 (doc 22).
 *
 * A small fan-out that mirrors order / stock lifecycle events to
 * external tools the merchant already uses: Slack, Telegram and
 * Google Sheets. (Zapier / Make are deliberately NOT separate
 * connectors: they consume generic outbound webhooks, which are the
 * ADV-26 webhooks product — the Settings > Connectors page points
 * admins there.)
 *
 * Honesty contract (house convention):
 *  - A channel that is not configured says NOT_CONFIGURED with the
 *    missing Settings keys named — it never reports a send.
 *  - A notification counts as "sent" only on a real provider 2xx
 *    (Slack webhook / Telegram Bot API / Sheets append).
 *  - Every attempt's outcome is recorded in the connectors.attempts
 *    Setting-doc ledger (codes only — never a credential, never a
 *    provider response body, never a full phone number).
 *  - Payloads are the ids-only shapes the automation seam uses
 *    ({ entityId }); the fan-out expands them into a SAFE summary
 *    (orderNo, totals, status, masked phone) at send time.
 *
 * Credentials live in encrypted Settings (connectors.* keys,
 * registered in src/lib/settings.ts SETTING_DEFAULTS). No credential
 * is ever logged, returned from an API, or written to the ledger.
 */

/** Lifecycle events the fan-out mirrors — the same names the
 *  automation producer seam emits (src/automation/producers.ts). */
export const CONNECTOR_EVENTS = [
  "order.created",
  "order.status_changed",
  "payment.succeeded",
  "stock.low",
] as const;

export type ConnectorEvent = (typeof CONNECTOR_EVENTS)[number];

/** Pseudo-event recorded for admin "টেস্ট পাঠান" attempts. */
export const CONNECTOR_TEST_EVENT = "test" as const;

export const CONNECTOR_CHANNELS = ["slack", "telegram", "sheets"] as const;

export type ConnectorChannel = (typeof CONNECTOR_CHANNELS)[number];

/* ------------------------------------------------------------------ */
/* Safe summaries — the only data that ever leaves the server.         */
/* ------------------------------------------------------------------ */

export interface OrderSummary {
  orderNo: string;
  customerName: string;
  /** Masked at load time (maskPhone) — the raw phone never enters a summary. */
  phoneMasked: string;
  /** Grand total, integer poisha. */
  totalPoisha: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  itemCount: number;
}

export interface StockSummary {
  sku: string;
  available: number;
  productName?: string;
}

export type ConnectorSummary =
  | { kind: "order"; order: OrderSummary }
  | { kind: "stock"; stock: StockSummary }
  | { kind: "test"; channel: ConnectorChannel };

/* ------------------------------------------------------------------ */
/* Attempt ledger                                                      */
/* ------------------------------------------------------------------ */

export type AttemptStatus = "sent" | "failed" | "not_configured";

export interface AttemptRecord {
  /** ISO timestamp of the attempt. */
  at: string;
  channel: ConnectorChannel;
  /** A ConnectorEvent, or "test" for admin test sends. */
  event: ConnectorEvent | typeof CONNECTOR_TEST_EVENT;
  status: AttemptStatus;
  /** Machine code only (e.g. "http_500", "telegram_401",
   *  "invalid_grant", "network_error") — never a response body. */
  errorCode?: string;
  /** Short human note; for not_configured it names the missing keys. */
  detail?: string;
}

/** Outcome of one channel send, as returned by a channel adapter. */
export interface ChannelSendResult {
  ok: boolean;
  errorCode?: string;
  detail?: string;
}

/* ------------------------------------------------------------------ */
/* Injectable dependencies (smoke tests + future workers).            */
/* ------------------------------------------------------------------ */

export type SettingsReader = (key: string) => Promise<string | null>;
export type FetchFn = typeof fetch;

export interface ConnectorDeps {
  /** Settings reader; default = src/lib/settings getSetting. */
  getSetting?: SettingsReader;
  /** HTTP implementation; default = global fetch. */
  fetchFn?: FetchFn;
  /** Clock; default = () => new Date(). */
  now?: () => Date;
  /** Ledger writer; default = the connectors.attempts doc store. */
  recordAttempt?: (attempt: AttemptRecord) => Promise<void>;
  /** Summary loader; default = the Prisma loader in summary.ts. */
  loadSummary?: (
    event: ConnectorEvent,
    entityId: string,
  ) => Promise<ConnectorSummary | null>;
}

export interface NotifyResult {
  event: string;
  /** One entry per channel that was attempted or reported not-configured. */
  attempts: AttemptRecord[];
  /** Set when nothing was attempted at all. */
  skipped?: "unknown_event" | "entity_not_found" | "error";
}

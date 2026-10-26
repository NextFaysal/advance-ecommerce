/**
 * Outbound connector fan-out (ADV-25 part 2) — see types.ts for the
 * honesty contract.
 *
 * notifyExternal(event, { entityId }) is called from ONE hook at the
 * automation producer seam (src/automation/producers.ts), which every
 * funnel emit passes through post-commit. It is fire-and-forget and
 * NEVER throws: each channel is resolved, attempted and recorded
 * independently, so one channel's outage (or a missing credential)
 * can neither break an order funnel nor silence another channel.
 */
import {
  resolveSheetsConfig,
  resolveSlackConfig,
  resolveTelegramConfig,
} from "./config";
import { formatConnectorMessage, formatSheetsRow } from "./format";
import { recordConnectorAttempt } from "./ledger";
import { sendSheetsRow } from "./sheets";
import { sendSlackMessage } from "./slack";
import { loadConnectorSummary } from "./summary";
import { sendTelegramMessage } from "./telegram";
import {
  CONNECTOR_EVENTS,
  CONNECTOR_TEST_EVENT,
  type AttemptRecord,
  type ChannelSendResult,
  type ConnectorChannel,
  type ConnectorDeps,
  type ConnectorEvent,
  type ConnectorSummary,
  type NotifyResult,
} from "./types";

async function defaultGetSetting(key: string): Promise<string | null> {
  const settings = await import("../lib/settings");
  return settings.getSetting(key);
}

function isConnectorEvent(event: string): event is ConnectorEvent {
  return (CONNECTOR_EVENTS as readonly string[]).includes(event);
}

interface ChannelRun {
  record: AttemptRecord;
}

/** Send one already-formatted payload through one channel whose
 *  config has been resolved, converting the adapter result into the
 *  ledger record shape. */
async function runChannel(
  channel: ConnectorChannel,
  event: ConnectorEvent | typeof CONNECTOR_TEST_EVENT,
  summary: ConnectorSummary,
  deps: Required<Pick<ConnectorDeps, "fetchFn" | "now">> & ConnectorDeps,
  configs: {
    slack: Awaited<ReturnType<typeof resolveSlackConfig>>;
    telegram: Awaited<ReturnType<typeof resolveTelegramConfig>>;
    sheets: Awaited<ReturnType<typeof resolveSheetsConfig>>;
  },
): Promise<ChannelRun> {
  const at = deps.now().toISOString();
  let result: ChannelSendResult;
  if (channel === "slack") {
    result = await sendSlackMessage(
      configs.slack.webhookUrl,
      formatConnectorMessage(event, summary),
      deps.fetchFn,
    );
  } else if (channel === "telegram") {
    result = await sendTelegramMessage(
      configs.telegram,
      formatConnectorMessage(event, summary),
      deps.fetchFn,
    );
  } else {
    result = await sendSheetsRow(
      configs.sheets,
      formatSheetsRow(event, summary, deps.now()),
      deps.fetchFn,
      deps.now(),
    );
  }
  return {
    record: {
      at,
      channel,
      event,
      status: result.ok ? "sent" : "failed",
      ...(result.ok ? {} : { errorCode: result.errorCode ?? "unknown_error" }),
      ...(result.detail ? { detail: result.detail } : {}),
    },
  };
}

function notConfiguredRecord(
  channel: ConnectorChannel,
  event: ConnectorEvent | typeof CONNECTOR_TEST_EVENT,
  missing: string[],
  at: string,
): AttemptRecord {
  return {
    at,
    channel,
    event,
    status: "not_configured",
    errorCode: "not_configured",
    detail: `Missing Settings: ${missing.join(", ")}`,
  };
}

/**
 * Fan one lifecycle event out to the configured channels.
 * Fire-and-forget by contract — funnel callers must be able to
 * `void` this; it resolves (never rejects) with what happened.
 */
export async function notifyExternal(
  event: ConnectorEvent | string,
  payload: { entityId: string },
  deps: ConnectorDeps = {},
): Promise<NotifyResult> {
  try {
    if (!isConnectorEvent(event)) return { event, attempts: [], skipped: "unknown_event" };

    const getSetting = deps.getSetting ?? defaultGetSetting;
    const fetchFn = deps.fetchFn ?? fetch;
    const now = deps.now ?? (() => new Date());
    const record = deps.recordAttempt ?? recordConnectorAttempt;
    const loadSummary = deps.loadSummary ?? loadConnectorSummary;
    const fullDeps = { ...deps, fetchFn, now };

    const summary = await loadSummary(event, payload.entityId);
    if (summary === null) {
      // The entity vanished between commit and fan-out (or a bad id):
      // nothing honest can be sent, and there is no channel outcome
      // to record. Ids only in the log line.
      console.warn("[connectors] summary not found", { event, entityId: payload.entityId });
      return { event, attempts: [], skipped: "entity_not_found" };
    }

    const [slack, telegram, sheets] = await Promise.all([
      resolveSlackConfig(getSetting),
      resolveTelegramConfig(getSetting),
      resolveSheetsConfig(getSetting),
    ]);
    const configs = { slack, telegram, sheets };
    const at = now().toISOString();
    const attempts: AttemptRecord[] = [];

    const consider = async (
      channel: ConnectorChannel,
      cfg: { enabled: boolean; events?: Set<ConnectorEvent>; missing: string[] },
    ): Promise<void> => {
      if (!cfg.enabled) return; // channel off — not an attempt.
      // Sheets fires on order.created only, by design (see sheets.ts).
      const subscribed =
        channel === "sheets" ? event === "order.created" : cfg.events!.has(event);
      if (!subscribed) return;
      if (cfg.missing.length > 0) {
        const rec = notConfiguredRecord(channel, event, cfg.missing, at);
        attempts.push(rec);
        await record(rec);
        return;
      }
      const { record: rec } = await runChannel(channel, event, summary, fullDeps, configs);
      attempts.push(rec);
      await record(rec);
    };

    // Independent attempts: a throwing channel must not stop the
    // others (adapters already convert failures to results, so this
    // is belt-and-braces around config/record surprises).
    for (const [channel, cfg] of [
      ["slack", slack],
      ["telegram", telegram],
      ["sheets", sheets],
    ] as const) {
      try {
        await consider(channel, cfg);
      } catch {
        const rec: AttemptRecord = {
          at,
          channel,
          event,
          status: "failed",
          errorCode: "internal_error",
          detail: "Connector attempt failed unexpectedly; see server logs.",
        };
        attempts.push(rec);
        await record(rec).catch(() => undefined);
      }
    }
    return { event, attempts };
  } catch (error) {
    console.warn("[connectors] notifyExternal failed", {
      event,
      error: error instanceof Error ? error.name : "unknown-error",
    });
    return { event, attempts: [], skipped: "error" };
  }
}

/**
 * Admin "টেস্ট পাঠান": one REAL attempt through ONE channel,
 * recorded in the ledger with event "test". Credentials are required
 * (missing → a not_configured record naming the keys); the channel's
 * enabled switch is NOT required — the point of a test is verifying
 * credentials before enabling. The returned record is the verbatim
 * outcome the admin UI shows.
 */
export async function sendConnectorTest(
  channel: ConnectorChannel,
  deps: ConnectorDeps = {},
): Promise<AttemptRecord> {
  const getSetting = deps.getSetting ?? defaultGetSetting;
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? (() => new Date());
  const record = deps.recordAttempt ?? recordConnectorAttempt;
  const fullDeps = { ...deps, fetchFn, now };
  const at = now().toISOString();

  const [slack, telegram, sheets] = await Promise.all([
    resolveSlackConfig(getSetting),
    resolveTelegramConfig(getSetting),
    resolveSheetsConfig(getSetting),
  ]);
  const configs = { slack, telegram, sheets };
  const cfg = configs[channel];

  let rec: AttemptRecord;
  if (cfg.missing.length > 0) {
    rec = notConfiguredRecord(channel, CONNECTOR_TEST_EVENT, cfg.missing, at);
  } else {
    const summary: ConnectorSummary = { kind: "test", channel };
    const { record: runRecord } = await runChannel(
      channel,
      CONNECTOR_TEST_EVENT,
      summary,
      fullDeps,
      configs,
    );
    rec = runRecord;
  }
  await record(rec).catch(() => undefined);
  return rec;
}

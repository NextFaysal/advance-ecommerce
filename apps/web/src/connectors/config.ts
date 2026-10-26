/**
 * Connector channel configuration (ADV-25 part 2).
 *
 * Each channel resolves INDEPENDENTLY from encrypted Settings: its
 * own enabled switch, its own event subset, its own credentials.
 * `missing` names the Settings keys that stand between the channel
 * and a real send — the NOT_CONFIGURED message is built from it, so
 * an admin always learns exactly what to fill in, and nothing else
 * (never a stored value) is ever reported.
 *
 * All readers go through the injectable SettingsReader so tests can
 * drive the fan-out without the DB.
 */
import {
  CONNECTOR_EVENTS,
  type ConnectorEvent,
  type SettingsReader,
} from "./types";

export const DEFAULT_TELEGRAM_API_BASE = "https://api.telegram.org";
export const DEFAULT_SHEETS_SHEET_NAME = "Orders";

/** Events a channel receives. Sheets is intentionally absent: it
 *  fires on order.created only (see sheets.ts). */
export function parseEventSubset(raw: string | null): Set<ConnectorEvent> {
  const out = new Set<ConnectorEvent>();
  if (raw === null) return out;
  for (const part of raw.split(",")) {
    const name = part.trim();
    if ((CONNECTOR_EVENTS as readonly string[]).includes(name)) {
      out.add(name as ConnectorEvent);
    }
  }
  return out;
}

export interface SlackConfig {
  enabled: boolean;
  events: Set<ConnectorEvent>;
  webhookUrl: string;
  missing: string[];
}

export interface TelegramConfig {
  enabled: boolean;
  events: Set<ConnectorEvent>;
  botToken: string;
  chatId: string;
  apiBase: string;
  missing: string[];
}

export interface SheetsConfig {
  enabled: boolean;
  serviceAccountJson: string;
  spreadsheetId: string;
  sheetName: string;
  missing: string[];
}

function clean(value: string | null): string {
  return (value ?? "").trim();
}

export async function resolveSlackConfig(read: SettingsReader): Promise<SlackConfig> {
  const [enabled, events, webhookUrl] = await Promise.all([
    read("connectors.slack.enabled"),
    read("connectors.slack.events"),
    read("connectors.slack.webhook_url"),
  ]);
  const url = clean(webhookUrl);
  return {
    enabled: clean(enabled) === "true",
    events: parseEventSubset(events),
    webhookUrl: url,
    missing: url === "" ? ["connectors.slack.webhook_url"] : [],
  };
}

export async function resolveTelegramConfig(read: SettingsReader): Promise<TelegramConfig> {
  const [enabled, events, botToken, chatId, apiBase] = await Promise.all([
    read("connectors.telegram.enabled"),
    read("connectors.telegram.events"),
    read("connectors.telegram.bot_token"),
    read("connectors.telegram.chat_id"),
    read("connectors.telegram.api_base"),
  ]);
  const token = clean(botToken);
  const chat = clean(chatId);
  const missing: string[] = [];
  if (token === "") missing.push("connectors.telegram.bot_token");
  if (chat === "") missing.push("connectors.telegram.chat_id");
  return {
    enabled: clean(enabled) === "true",
    events: parseEventSubset(events),
    botToken: token,
    chatId: chat,
    apiBase: clean(apiBase) || DEFAULT_TELEGRAM_API_BASE,
    missing,
  };
}

export async function resolveSheetsConfig(read: SettingsReader): Promise<SheetsConfig> {
  const [enabled, serviceAccountJson, spreadsheetId, sheetName] = await Promise.all([
    read("connectors.sheets.enabled"),
    read("connectors.sheets.service_account_json"),
    read("connectors.sheets.spreadsheet_id"),
    read("connectors.sheets.sheet_name"),
  ]);
  const json = clean(serviceAccountJson);
  const sheet = clean(spreadsheetId);
  const missing: string[] = [];
  if (json === "") missing.push("connectors.sheets.service_account_json");
  if (sheet === "") missing.push("connectors.sheets.spreadsheet_id");
  return {
    enabled: clean(enabled) === "true",
    serviceAccountJson: json,
    spreadsheetId: sheet,
    sheetName: clean(sheetName) || DEFAULT_SHEETS_SHEET_NAME,
    missing,
  };
}

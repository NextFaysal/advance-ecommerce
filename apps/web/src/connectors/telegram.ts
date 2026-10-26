/**
 * Telegram connector (ADV-25 part 2).
 *
 * Bot API send: POST {api_base}/bot<token>/sendMessage with
 * { chat_id, text }. The bot token rides the URL path (that is how
 * the Bot API works) — it is NEVER logged and NEVER written to an
 * error record: outcomes carry codes only (telegram_<error_code> or
 * http_<status>). A send counts as "sent" only when the API answers
 * 2xx AND its JSON body says ok: true.
 *
 * The api_base is a Setting (connectors.telegram.api_base, default
 * https://api.telegram.org) so a merchant can point at a self-hosted
 * Bot API server / proxy — and so tests can point at a local capture
 * server.
 */
import type { TelegramConfig } from "./config";
import type { ChannelSendResult, FetchFn } from "./types";

const TIMEOUT_MS = 10_000;

export async function sendTelegramMessage(
  config: Pick<TelegramConfig, "apiBase" | "botToken" | "chatId">,
  text: string,
  fetchFn: FetchFn = fetch,
): Promise<ChannelSendResult> {
  const base = config.apiBase.replace(/\/+$/, "");
  const url = `${base}/bot${config.botToken}/sendMessage`;
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.chatId, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error_code?: number;
    } | null;
    if (res.ok && body?.ok === true) return { ok: true };
    const code =
      typeof body?.error_code === "number" ? `telegram_${body.error_code}` : `http_${res.status}`;
    return {
      ok: false,
      errorCode: code,
      detail: `Telegram Bot API refused the message (${code}).`,
    };
  } catch {
    return {
      ok: false,
      errorCode: "network_error",
      detail: "Telegram Bot API could not be reached (network error or timeout).",
    };
  }
}

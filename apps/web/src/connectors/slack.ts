/**
 * Slack connector (ADV-25 part 2).
 *
 * Incoming-webhook send: POST { text } to the configured webhook
 * URL. The URL itself is the credential (stored encrypted in
 * Settings) — it is never logged and never appears in an error
 * record; outcomes are HTTP status codes only. A send counts as
 * "sent" only on a real 2xx from hooks.slack.com.
 */
import type { ChannelSendResult, FetchFn } from "./types";

const TIMEOUT_MS = 10_000;

export async function sendSlackMessage(
  webhookUrl: string,
  text: string,
  fetchFn: FetchFn = fetch,
): Promise<ChannelSendResult> {
  try {
    const res = await fetchFn(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    return {
      ok: false,
      errorCode: `http_${res.status}`,
      detail: `Slack webhook answered HTTP ${res.status}.`,
    };
  } catch {
    return {
      ok: false,
      errorCode: "network_error",
      detail: "Slack webhook could not be reached (network error or timeout).",
    };
  }
}

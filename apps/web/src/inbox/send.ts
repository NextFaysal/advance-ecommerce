/**
 * Inbox SEND path — doc 22 ADV-6 part 2 (doc 21 G3-10 remainder closed
 * the read side; this closes the write side).
 *
 * Until this module, the /admin/inbox composer was honest demo: it
 * recorded a "কিউ করা — পাঠানো হয়নি" intent in page state and nothing
 * ever left the server, because no Meta channel adapter existed. This
 * module is that adapter:
 *
 *   MESSENGER  -> Graph Send API  POST /v19.0/me/messages
 *                 { recipient: { id: <PSID> }, messaging_type: "RESPONSE",
 *                   message: { text } }
 *                 (RESPONSE = replying inside Meta's 24h customer
 *                 service window; outside it Meta rejects and the
 *                 provider error is surfaced to staff verbatim.)
 *   INSTAGRAM  -> the same Send API path with the Page access token
 *                 (IG messaging rides the Page's Send API; recipient
 *                 is the IG-scoped user id; the channel's config adds
 *                 meta.ig_id on top of the shared core + page token).
 *   WHATSAPP   -> WhatsApp Cloud API  POST /v19.0/<phone_number_id>/messages
 *                 { messaging_product: "whatsapp", to: <wa_id>,
 *                   type: "text", text: { body } }
 *                 (Free-form text is only valid inside the 24h window;
 *                 outside it Meta answers error 131047 — surfaced, not
 *                 hidden.)
 *
 * The recipient is the conversation's channel sender id, which the
 * receive side stores as Conversation.externalThreadId (PSID / IGSID /
 * wa_id). Nothing else about the customer is needed to send.
 *
 * Configuration lives in the encrypted Settings store (keys owned by
 * the ADV-6 settings registry; field sets owned by the receive side,
 * src/inbox/meta-channels.ts — imported here so "configured" has ONE
 * definition across webhook diagnosis, the page status line and this
 * send path):
 *   core (endpoint):  meta.app_secret, meta.webhook_verify_token
 *   MESSENGER:        + meta.page_id, meta.page_access_token
 *   INSTAGRAM:        + meta.ig_id, meta.page_access_token
 *   WHATSAPP:         + meta.whatsapp_phone_number_id,
 *                       meta.whatsapp_access_token
 * (meta.page_id / meta.ig_id identify the assets for the receive side
 * and the status diagnosis; the Send API call itself needs only the
 * token — but a channel is "live" in this install only when its full
 * field set is present, exactly as diagnoseMetaChannels rules it.)
 * A channel counts as CONFIGURED only when every required key is
 * present and non-empty. Tokens are read server-side only, travel only
 * in the Authorization header to graph.facebook.com, and are NEVER
 * logged, returned, or serialised — error messages are built from the
 * provider's error payload only, and the live-status helper below
 * exposes booleans and missing KEY NAMES, never values.
 *
 * Honesty contract (mirrors src/integrations/sms-resolver.ts):
 * - Not configured -> sendStaffReply returns { status: "queued" } —
 *   the caller keeps the old demo behaviour (page-state intent, dashed
 *   "কিউ করা — পাঠানো হয়নি" bubble). No fetch, no persistence.
 * - Provider rejects -> MetaSendError with the provider's own message;
 *   NOTHING is persisted as sent.
 * - Provider accepts -> the reply route persists an OUTBOUND
 *   InboxMessage carrying the platform message id (via the injected
 *   persist fn; default = appendOutboundMessageDb).
 *
 * The settings reader and fetch are injectable (the sms-resolver
 * pattern) so the module is smoke-testable with a fake reader + mock
 * fetch and no DB.
 */
import { getSetting } from "../lib/settings";
import { META_CHANNEL_FIELDS, META_CORE_FIELDS, type MetaSettingsReader } from "./meta-channels";
import type { Conversation, InboxChannel, InboxMessage } from "./types";

export const META_GRAPH_BASE = "https://graph.facebook.com/v19.0";

export type { MetaSettingsReader };

const defaultReader: MetaSettingsReader = { getSetting };

type FetchLike = typeof fetch;

export class MetaSendError extends Error {
  readonly channel: InboxChannel;
  /** NOT_CONFIGURED | EMPTY_MESSAGE | NETWORK | HTTP_<status> |
   *  META_<provider code> | UNRECOGNIZED_RESPONSE */
  readonly code: string;

  constructor(channel: InboxChannel, code: string, message: string) {
    super(message);
    this.name = "MetaSendError";
    this.channel = channel;
    this.code = code;
  }
}

export interface ResolvedMetaChannel {
  channel: InboxChannel;
  configured: boolean;
  /** Setting KEYS that are absent/empty — names only, safe to show staff. */
  missingFields: string[];
  /** Server-side only. Never serialise a ResolvedMetaChannel. */
  pageAccessToken?: string;
  whatsappAccessToken?: string;
  whatsappPhoneNumberId?: string;
}

function present(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function resolveMetaChannel(
  channel: InboxChannel,
  reader: MetaSettingsReader = defaultReader,
): Promise<ResolvedMetaChannel> {
  // Every registry key is `meta.<field>` (see META_KEYS on the
  // receive side), so the field sets translate directly to keys.
  const requiredFields: readonly string[] = [...META_CORE_FIELDS, ...META_CHANNEL_FIELDS[channel]];
  const values = new Map<string, string | undefined>();
  await Promise.all(
    requiredFields.map(async (field) => {
      values.set(field, present(await reader.getSetting(`meta.${field}`)));
    }),
  );
  const missingFields = requiredFields
    .filter((field) => values.get(field) === undefined)
    .map((field) => `meta.${field}`);
  return {
    channel,
    configured: missingFields.length === 0,
    missingFields,
    pageAccessToken: values.get("page_access_token"),
    whatsappAccessToken: values.get("whatsapp_access_token"),
    whatsappPhoneNumberId: values.get("whatsapp_phone_number_id"),
  };
}

/**
 * Boolean live map for the admin page — the ONLY channel-config shape
 * allowed to cross to the browser. Reader failures degrade to
 * all-false (demo mode), never to a crash and never to a fake "live".
 */
export async function getMetaChannelLiveStatus(
  reader: MetaSettingsReader = defaultReader,
): Promise<Record<InboxChannel, boolean>> {
  const status: Record<InboxChannel, boolean> = {
    MESSENGER: false,
    WHATSAPP: false,
    INSTAGRAM: false,
  };
  try {
    const [messenger, instagram, whatsapp] = await Promise.all([
      resolveMetaChannel("MESSENGER", reader),
      resolveMetaChannel("INSTAGRAM", reader),
      resolveMetaChannel("WHATSAPP", reader),
    ]);
    status.MESSENGER = messenger.configured;
    status.INSTAGRAM = instagram.configured;
    status.WHATSAPP = whatsapp.configured;
  } catch {
    // Settings store unavailable -> stay in honest demo mode.
  }
  return status;
}

interface MetaErrorBody {
  error?: { message?: unknown; code?: unknown };
}

function providerError(channel: InboxChannel, status: number, body: unknown): MetaSendError {
  const err = (body as MetaErrorBody | null)?.error;
  const message = typeof err?.message === "string" ? err.message : null;
  const code = typeof err?.code === "number" ? err.code : null;
  if (message) {
    return new MetaSendError(
      channel,
      code !== null ? `META_${code}` : `HTTP_${status}`,
      `Meta rejected the message: ${message}`,
    );
  }
  return new MetaSendError(channel, `HTTP_${status}`, `Meta returned HTTP ${status}.`);
}

/**
 * One text message through the channel's real API. Returns the
 * platform message id. Throws MetaSendError on ANY failure — network,
 * HTTP, provider error payload, or an unrecognisable success body.
 */
export async function sendMetaTextMessage(input: {
  resolved: ResolvedMetaChannel;
  recipientId: string;
  text: string;
  fetchImpl?: FetchLike;
}): Promise<{ platformMessageId: string }> {
  const { resolved, recipientId, text } = input;
  const fetchImpl = input.fetchImpl ?? fetch;
  if (!resolved.configured) {
    throw new MetaSendError(
      resolved.channel,
      "NOT_CONFIGURED",
      `Meta channel ${resolved.channel} is not configured (missing: ${resolved.missingFields.join(", ")}).`,
    );
  }
  if (text.trim().length === 0) {
    throw new MetaSendError(resolved.channel, "EMPTY_MESSAGE", "Message text is empty.");
  }

  let url: string;
  let token: string;
  let payload: Record<string, unknown>;
  if (resolved.channel === "WHATSAPP") {
    url = `${META_GRAPH_BASE}/${resolved.whatsappPhoneNumberId}/messages`;
    token = resolved.whatsappAccessToken!;
    payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      // wa_id is digits-only (country code + number, no "+").
      to: recipientId.replace(/\D/g, ""),
      type: "text",
      text: { preview_url: false, body: text },
    };
  } else {
    url = `${META_GRAPH_BASE}/me/messages`;
    token = resolved.pageAccessToken!;
    payload = {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text },
    };
  }

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Deliberately no error detail: fetch errors can embed the URL,
    // and no URL/header material may reach logs or staff responses
    // beyond what is needed (the token rides the header, not the URL,
    // but the rule is absolute).
    throw new MetaSendError(
      resolved.channel,
      "NETWORK",
      "Could not reach Meta (network error or timeout).",
    );
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw providerError(resolved.channel, res.status, body);

  const platformMessageId =
    resolved.channel === "WHATSAPP"
      ? (body as { messages?: { id?: unknown }[] } | null)?.messages?.[0]?.id
      : (body as { message_id?: unknown } | null)?.message_id;
  if (typeof platformMessageId !== "string" || platformMessageId.length === 0) {
    throw new MetaSendError(
      resolved.channel,
      "UNRECOGNIZED_RESPONSE",
      "Meta accepted the request but returned no message id — the reply was NOT recorded as sent.",
    );
  }
  return { platformMessageId };
}

export interface StaffReplyDeps {
  reader?: MetaSettingsReader;
  fetchImpl?: FetchLike;
  /** Defaults to the DB store (lazy import keeps this module DB-free
   *  for tests). Called ONLY after provider success. */
  persistOutbound?: (
    conversationId: string,
    input: { text: string; externalMessageId: string },
  ) => Promise<InboxMessage>;
}

export type StaffReplyOutcome =
  | { status: "sent"; message: InboxMessage; platformMessageId: string }
  | { status: "queued"; reason: "CHANNEL_NOT_CONFIGURED"; missingFields: string[] };

/**
 * The reply route's one entry point. Configured -> real send, then
 * persist; provider failure propagates as MetaSendError with nothing
 * persisted; unconfigured -> the honest queued outcome (no fetch, no
 * persistence — the client keeps the reply as a page-state intent,
 * exactly the pre-ADV-6 demo behaviour).
 */
export async function sendStaffReply(
  conversation: Conversation,
  text: string,
  deps: StaffReplyDeps = {},
): Promise<StaffReplyOutcome> {
  const resolved = await resolveMetaChannel(conversation.channel, deps.reader ?? defaultReader);
  if (!resolved.configured) {
    return { status: "queued", reason: "CHANNEL_NOT_CONFIGURED", missingFields: resolved.missingFields };
  }
  const { platformMessageId } = await sendMetaTextMessage({
    resolved,
    recipientId: conversation.externalThreadId,
    text,
    fetchImpl: deps.fetchImpl,
  });
  const persist =
    deps.persistOutbound ??
    (async (conversationId: string, input: { text: string; externalMessageId: string }) => {
      const { appendOutboundMessageDb } = await import("./store");
      return appendOutboundMessageDb(conversationId, input);
    });
  const message = await persist(conversation.id, { text, externalMessageId: platformMessageId });
  return { status: "sent", message, platformMessageId };
}

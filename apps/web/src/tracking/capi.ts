// Meta Conversions API (CAPI) payload builder + sender seam — Agent 24.
// The builder is PURE: same input -> same payload, no network, no clock read
// beyond the event's own occurredAt. The sender is an interface; this slice
// ships only a sandbox/no-op implementation that records the eventId — it
// NEVER makes a real HTTP call. The real sender (future slice) reads the
// access token from encrypted Admin Settings (see ./settings.ts), runs in
// the BullMQ "webhook-delivery"-style worker with retry/backoff, and posts
// to graph.facebook.com/<version>/<pixel_id>/events.
import { hashEmailForCapi, hashExternalId, hashPhoneForCapi } from "./hashing";
import type { BuiltTrackingEvent, TrackingUserInput } from "./types";

/**
 * THE payload-edge money conversion. Internal money is integer poisha and
 * never a float; Meta's API requires `value` in decimal major units, so the
 * conversion poisha -> BDT decimal happens here and only here (GA4/TikTok
 * builders import this). 125050 poisha -> 1250.5
 */
export function poishaToMajorValue(poisha: number): number {
  return Number((poisha / 100).toFixed(2));
}

export interface MetaCapiUserData {
  em?: string[];
  ph?: string[];
  external_id?: string[];
  fbp?: string;
  fbc?: string;
  client_ip_address?: string;
  client_user_agent?: string;
}

export interface MetaCapiContent {
  id: string;
  quantity: number;
  item_price: number;
}

export interface MetaCapiCustomData {
  value?: number;
  currency?: "BDT";
  content_ids?: string[];
  content_type?: "product";
  contents?: MetaCapiContent[];
  order_id?: string;
}

export interface MetaCapiEvent {
  event_name: string;
  /** Unix seconds. */
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source: "pixel" | "system";
  event_source_url?: string;
  user_data: MetaCapiUserData;
  custom_data?: MetaCapiCustomData;
}

export interface MetaCapiPayload {
  data: MetaCapiEvent[];
  test_event_code?: string;
}

/** Builds CAPI user_data. Plain identifiers in, hashes out — nothing else. */
export function buildMetaUserData(user: TrackingUserInput | undefined, includeUserData: boolean): MetaCapiUserData {
  if (!user || !includeUserData) return {};
  const out: MetaCapiUserData = {};
  if (user.email) {
    const em = hashEmailForCapi(user.email);
    if (em) out.em = [em];
  }
  if (user.phone) {
    const ph = hashPhoneForCapi(user.phone);
    if (ph) out.ph = [ph];
  }
  if (user.externalId) out.external_id = [hashExternalId(user.externalId)];
  if (user.fbp) out.fbp = user.fbp;
  if (user.fbc) out.fbc = user.fbc;
  if (user.clientIpAddress) out.client_ip_address = user.clientIpAddress;
  if (user.clientUserAgent) out.client_user_agent = user.clientUserAgent;
  return out;
}

export interface BuildCapiOptions {
  /** False in consent "anonymous" mode — user_data is then empty by design. */
  includeUserData: boolean;
  testEventCode?: string | null;
}

export function buildMetaCapiPayload(
  event: BuiltTrackingEvent,
  user: TrackingUserInput | undefined,
  options: BuildCapiOptions,
): MetaCapiPayload {
  const customData: MetaCapiCustomData = {};
  if (event.dedup.valuePoisha !== null) {
    customData.value = poishaToMajorValue(event.dedup.valuePoisha);
    customData.currency = "BDT";
  }
  if (event.items.length > 0) {
    customData.content_ids = event.items.map((i) => i.productId);
    customData.content_type = "product";
    customData.contents = event.items.map((i) => ({
      id: i.productId,
      quantity: i.quantity,
      item_price: poishaToMajorValue(i.itemPricePoisha),
    }));
  }
  if (event.dedup.orderId) customData.order_id = event.dedup.orderId;

  const capiEvent: MetaCapiEvent = {
    event_name: event.eventName,
    event_time: Math.floor(Date.parse(event.dedup.occurredAt) / 1000),
    event_id: event.dedup.eventId,
    action_source: "website",
    event_source: "system",
    user_data: buildMetaUserData(user, options.includeUserData),
    ...(Object.keys(customData).length > 0 ? { custom_data: customData } : {}),
    ...(event.eventSourceUrl ? { event_source_url: event.eventSourceUrl } : {}),
  };
  return {
    data: [capiEvent],
    ...(options.testEventCode ? { test_event_code: options.testEventCode } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Sender seam. Sandbox only in this slice — no real HTTP anywhere.    */
/* ------------------------------------------------------------------ */

export interface CapiSendResult {
  eventId: string;
  channel: "meta";
  status: "sandbox_recorded" | "skipped";
  detail: string;
}

export interface CapiSender {
  send(payload: MetaCapiPayload): Promise<CapiSendResult>;
}

/**
 * Sandbox/no-op sender: records only the eventId(s) it was asked to send.
 * It never logs payload user_data and never touches the network.
 */
export class SandboxCapiSender implements CapiSender {
  readonly sentEventIds: string[] = [];

  async send(payload: MetaCapiPayload): Promise<CapiSendResult> {
    const first = payload.data[0];
    const eventId = first?.event_id ?? "unknown";
    this.sentEventIds.push(eventId);
    return {
      eventId,
      channel: "meta",
      status: "sandbox_recorded",
      detail: "Sandbox sender — no real Meta API call was made.",
    };
  }
}

/** Shared demo sender instance for routes in this slice. */
export const sandboxCapiSender = new SandboxCapiSender();

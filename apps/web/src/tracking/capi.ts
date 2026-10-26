// Meta Conversions API (CAPI) payload builder + sender seam — Agent 24.
// The builder is PURE: same input -> same payload, no network, no clock read
// beyond the event's own occurredAt.
// Real HTTP sender dispatches to Meta Graph API (graph.facebook.com/v19.0/{pixel_id}/events)
// using Bearer token authentication, supporting both Primary and Backup Pixels.
import { hashEmailForCapi, hashExternalId, hashPhoneForCapi } from "./hashing";
import { resolveMetaCapi } from "./resolve";
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
/* Sender seam: Real HTTP + Sandbox fallback                          */
/* ------------------------------------------------------------------ */

export interface MetaCapiTarget {
  pixelId: string;
  accessToken: string;
  testEventCode?: string | null;
}

export interface CapiSendResult {
  eventId: string;
  channel: "meta";
  pixelId?: string;
  status: "sent" | "sandbox_recorded" | "skipped" | "failed";
  detail: string;
  eventsReceived?: number;
  fbtraceId?: string;
}

export interface CapiSender {
  send(payload: MetaCapiPayload): Promise<CapiSendResult>;
}

/**
 * Sends a real HTTP POST request to Meta Graph API for Conversions API (CAPI).
 * Endpoint: https://graph.facebook.com/v19.0/{pixelId}/events
 */
export async function sendMetaCapiHttp(
  payload: MetaCapiPayload,
  target: MetaCapiTarget,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<CapiSendResult> {
  const eventId = payload.data[0]?.event_id ?? "unknown";
  const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(target.pixelId)}/events`;

  const finalPayload = {
    ...payload,
    ...(target.testEventCode ? { test_event_code: target.testEventCode } : {}),
  };

  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${target.accessToken}`,
      },
      body: JSON.stringify(finalPayload),
    });

    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      return {
        eventId,
        channel: "meta",
        pixelId: target.pixelId,
        status: "failed",
        detail: data?.error?.message ?? `Meta API returned HTTP ${res.status}`,
        fbtraceId: data?.error?.fbtrace_id,
      };
    }

    return {
      eventId,
      channel: "meta",
      pixelId: target.pixelId,
      status: "sent",
      detail: "Successfully delivered to Meta Conversions API.",
      eventsReceived: data?.events_received,
      fbtraceId: data?.fbtrace_id,
    };
  } catch (err: any) {
    return {
      eventId,
      channel: "meta",
      pixelId: target.pixelId,
      status: "failed",
      detail: err?.message ?? "Network error contacting Meta Graph API.",
    };
  }
}

/**
 * Returns the server-configured Meta CAPI targets (Primary + Backup).
 * Resolution (ADV-9): Admin Settings DB first — `seo.meta.pixel_id` /
 * `seo.meta.access_token` (and the backup pair), saved from Admin >
 * Settings > Tracking — with the env vars (NEXT_PUBLIC_META_PIXEL_ID /
 * META_PIXEL_ID / META_ACCESS_TOKEN, ...) as fallback when the DB value
 * is empty. A target exists only when a pixel id AND its token resolve.
 */
export async function getActiveMetaCapiTargets(): Promise<MetaCapiTarget[]> {
  const { targets } = await resolveMetaCapi();
  return targets;
}

/**
 * Sandbox/no-op sender: records only the eventId(s) it was asked to send.
 * Used when no live Meta credentials are configured.
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
      detail: "Sandbox sender — no real Meta credentials provided, simulated successfully.",
    };
  }
}

/** Shared demo sender instance for routes in this slice. */
export const sandboxCapiSender = new SandboxCapiSender();

/**
 * Dispatches a CAPI payload to all active Meta targets (Primary and Backup).
 * Falls back to sandbox if no real credentials are configured in this environment.
 */
export async function dispatchMetaCapi(payload: MetaCapiPayload): Promise<CapiSendResult[]> {
  const targets = await getActiveMetaCapiTargets();
  if (targets.length === 0) {
    const sandboxResult = await sandboxCapiSender.send(payload);
    return [sandboxResult];
  }

  const results = await Promise.allSettled(
    targets.map((target) => sendMetaCapiHttp(payload, target)),
  );

  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : {
          eventId: payload.data[0]?.event_id ?? "unknown",
          channel: "meta" as const,
          pixelId: targets[i]?.pixelId,
          status: "failed" as const,
          detail: (r as PromiseRejectedResult).reason?.message ?? "Execution rejected",
        },
  );
}

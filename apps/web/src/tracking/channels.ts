// GA4 Measurement Protocol + TikTok Events API payload shapes — Agent 24.
// TYPES + pure builders only. No sender exists for these channels in this
// slice and no network call is made anywhere; when sending lands it goes
// through the same queue-worker pattern as Meta CAPI, with the measurement
// id / pixel code + secret/token read from encrypted Admin Settings.
import { poishaToMajorValue } from "./capi";
import { hashEmailForCapi, hashPhoneForCapi } from "./hashing";
import type { BuiltTrackingEvent, TrackingUserInput } from "./types";

/* ------------------------------------------------------------------ */
/* GA4 Measurement Protocol (POST /mp/collect shape)                   */
/* ------------------------------------------------------------------ */

export interface Ga4Item {
  item_id: string;
  item_variant?: string;
  quantity: number;
  price: number;
}

export interface Ga4Event {
  name: string;
  params: {
    currency?: "BDT";
    value?: number;
    transaction_id?: string;
    items?: Ga4Item[];
    page_location?: string;
  };
}

export interface Ga4Payload {
  client_id: string;
  user_id?: string;
  events: Ga4Event[];
}

/** GA4 event names differ from Meta's for the same standard events. */
export const GA4_EVENT_NAME: Record<string, string> = {
  PageView: "page_view",
  ViewContent: "view_item",
  AddToCart: "add_to_cart",
  InitiateCheckout: "begin_checkout",
  Purchase: "purchase",
  Lead: "generate_lead",
  CompleteRegistration: "sign_up",
};

export function buildGa4Payload(event: BuiltTrackingEvent, clientId: string): Ga4Payload {
  const params: Ga4Event["params"] = {};
  if (event.dedup.valuePoisha !== null) {
    params.value = poishaToMajorValue(event.dedup.valuePoisha);
    params.currency = "BDT";
  }
  if (event.dedup.orderId) params.transaction_id = event.dedup.orderId;
  if (event.items.length > 0) {
    params.items = event.items.map((i) => ({
      item_id: i.productId,
      ...(i.variantId ? { item_variant: i.variantId } : {}),
      quantity: i.quantity,
      price: poishaToMajorValue(i.itemPricePoisha),
    }));
  }
  if (event.eventSourceUrl) params.page_location = event.eventSourceUrl;
  return {
    client_id: clientId,
    events: [{ name: GA4_EVENT_NAME[event.eventName] ?? "event", params }],
  };
}

/* ------------------------------------------------------------------ */
/* TikTok Events API (POST /open_api/v1.3/event/track/ shape)          */
/* ------------------------------------------------------------------ */

export interface TikTokUser {
  phone_number?: string;
  email?: string;
  ttclid?: string;
  ip?: string;
  user_agent?: string;
}

export interface TikTokContent {
  content_id: string;
  content_type: "product";
  content_name?: string;
  quantity: number;
  price: number;
}

export interface TikTokEvent {
  event: string;
  event_time: string;
  event_id: string;
  user: TikTokUser;
  page?: { url: string };
  properties?: {
    value?: number;
    currency?: "BDT";
    contents?: TikTokContent[];
    order_id?: string;
  };
}

export interface TikTokPayload {
  event_source: "web";
  /** Pixel code — public id, comes from Admin Settings, never hardcoded. */
  event_source_id: string;
  data: TikTokEvent[];
  test_event_code?: string;
}

export interface TikTokExtras {
  pixelCode: string;
  ttclid?: string | null;
  includeUserData: boolean;
  testEventCode?: string | null;
}

export function buildTikTokPayload(
  event: BuiltTrackingEvent,
  user: TrackingUserInput | undefined,
  extras: TikTokExtras,
): TikTokPayload {
  const tiktokUser: TikTokUser = {};
  if (user && extras.includeUserData) {
    if (user.phone) {
      const ph = hashPhoneForCapi(user.phone);
      if (ph) tiktokUser.phone_number = ph;
    }
    if (user.email) {
      const em = hashEmailForCapi(user.email);
      if (em) tiktokUser.email = em;
    }
    if (user.clientIpAddress) tiktokUser.ip = user.clientIpAddress;
    if (user.clientUserAgent) tiktokUser.user_agent = user.clientUserAgent;
  }
  if (extras.ttclid) tiktokUser.ttclid = extras.ttclid;

  const properties: NonNullable<TikTokEvent["properties"]> = {};
  if (event.dedup.valuePoisha !== null) {
    properties.value = poishaToMajorValue(event.dedup.valuePoisha);
    properties.currency = "BDT";
  }
  if (event.items.length > 0) {
    properties.contents = event.items.map((i) => ({
      content_id: i.productId,
      content_type: "product" as const,
      quantity: i.quantity,
      price: poishaToMajorValue(i.itemPricePoisha),
    }));
  }
  if (event.dedup.orderId) properties.order_id = event.dedup.orderId;

  return {
    event_source: "web",
    event_source_id: extras.pixelCode,
    data: [
      {
        event: event.eventName,
        event_time: event.dedup.occurredAt,
        event_id: event.dedup.eventId,
        user: tiktokUser,
        ...(event.eventSourceUrl ? { page: { url: event.eventSourceUrl } } : {}),
        ...(Object.keys(properties).length > 0 ? { properties } : {}),
      },
    ],
    ...(extras.testEventCode ? { test_event_code: extras.testEventCode } : {}),
  };
}

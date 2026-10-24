// TEMPORARY DEMO data for /admin/shipments — Agent 44.
// (Agent 34's audit listed shipments as API-only: the sandbox shipment
// APIs existed — POST book / GET track / POST cancel — but no page.)
//
// Every record below is shaped EXACTLY like the real sandbox contract so
// the page does not invent a parallel model:
//  - shipments: SandboxShipment (src/integrations/sandbox/store.ts), i.e.
//    what POST /api/v1/admin/shipments books and what the courier webhook
//    advances; tracking ids follow the SBX- formats in
//    src/integrations/sandbox/deterministic.ts.
//  - chargePoisha on each record equals courierChargePoisha(zone,
//    weightGrams) from src/integrations/sandbox/courier-provider.ts —
//    the zone rule is NOT re-implemented here, the values are its outputs:
//    inside_dhaka 6000 / outside_dhaka 12000 / district 10000 poisha,
//    +2000 per extra 500g above 1kg.
// The display-only extensions on DemoShipment (zone, district,
// chargePoisha, failureReason, events with timestamps) are what a DB
// shipments + shipment_events read would return; statusHistory stays the
// plain status list the sandbox store keeps. Nothing here is a real
// shipment, a real customer, or a real courier booking. All money is
// integer poisha. Times are shown in Asia/Dhaka.
import type {
  ShipmentStatus,
  ShippingZone,
  ShipmentAddress,
} from "@/integrations/courier";
import type { SandboxCourierProvider } from "@/integrations/sandbox/courier-provider";
import type { SandboxShipment } from "@/integrations/sandbox/store";

export type { SandboxCourierProvider };

/**
 * The sandbox courier list, mirrored as data for the client board. This
 * file is imported by a client component, so it must not import VALUES
 * from courier-provider.ts (that module pulls in node:crypto via
 * deterministic.ts). page.tsx (server) iterates the real
 * SANDBOX_COURIER_PROVIDERS for its rate calls; keep the two in sync.
 */
export const DEMO_COURIER_PROVIDERS: readonly SandboxCourierProvider[] = [
  "steadfast",
  "pathao",
  "redx",
];

/** Fixed demo "today" (Asia/Dhaka), matching the other admin demo pages. */
export const DEMO_TODAY_YMD = "2026-10-24";

/** hh:mm, Asia/Dhaka — for table display. */
export function dhakaTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** "24 Oct, 11:45 AM", Asia/Dhaka — for created-at + timeline display. */
export function dhakaDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

export const SANDBOX_COURIER_LABELS_BN: Record<SandboxCourierProvider, string> = {
  steadfast: "স্টেডফাস্ট (Steadfast)",
  pathao: "পাঠাও (Pathao)",
  redx: "রেডএক্স (RedX)",
};

export const ZONE_LABELS_BN: Record<ShippingZone, string> = {
  inside_dhaka: "ঢাকার ভিতরে",
  outside_dhaka: "ঢাকার বাইরে",
  district: "জেলা শহর",
};

export const SHIPMENT_STATUS_META: Record<
  ShipmentStatus,
  { labelBn: string; labelEn: string; icon: string; tone: "warning" | "info" | "success" | "danger" | "brand" | "neutral" }
> = {
  CREATED: { labelBn: "তৈরি হয়েছে", labelEn: "CREATED", icon: "📦", tone: "neutral" },
  PICKED_UP: { labelBn: "পিকআপ হয়েছে", labelEn: "PICKED_UP", icon: "📥", tone: "info" },
  IN_TRANSIT: { labelBn: "পথে আছে", labelEn: "IN_TRANSIT", icon: "🚚", tone: "info" },
  OUT_FOR_DELIVERY: { labelBn: "ডেলিভারির জন্য বের হয়েছে", labelEn: "OUT_FOR_DELIVERY", icon: "🛵", tone: "brand" },
  DELIVERED: { labelBn: "ডেলিভারি সম্পন্ন", labelEn: "DELIVERED", icon: "✓", tone: "success" },
  FAILED: { labelBn: "ব্যর্থ", labelEn: "FAILED", icon: "⚠", tone: "danger" },
  RETURNING: { labelBn: "ফেরত আসছে", labelEn: "RETURNING", icon: "↩", tone: "warning" },
  RETURNED: { labelBn: "ফেরত এসেছে", labelEn: "RETURNED", icon: "↩", tone: "warning" },
};

/**
 * Forward delivery flow, for showing the not-yet-reached steps of the
 * tracking timeline as pending. Mirrors SHIPMENT_FLOW in
 * src/integrations/sandbox/status-mapping.ts (kept unexported there —
 * this is the display copy, not a second state machine: transitions are
 * still governed by canApplyShipmentStatus + the order state machine).
 */
export const FORWARD_FLOW: readonly ShipmentStatus[] = [
  "CREATED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

export function isProblemStatus(status: ShipmentStatus): boolean {
  return status === "FAILED" || status === "RETURNING" || status === "RETURNED";
}

// ---------------------------------------------------------------------------
// Shipments — SandboxShipment shape + display extensions.
// ---------------------------------------------------------------------------

export interface DemoShipmentEvent {
  status: ShipmentStatus;
  /** ISO timestamp, Asia/Dhaka display. */
  at: string;
  note: string | null;
}

export interface DemoShipment extends SandboxShipment {
  /** Zone the sandbox rate was computed from (CourierRateInput.zone). */
  zone: ShippingZone;
  district: string;
  /** courierChargePoisha(zone, weightGrams) — integer poisha. */
  chargePoisha: number;
  /** Set only for FAILED / RETURNING / RETURNED demo records. */
  failureReason: string | null;
  events: DemoShipmentEvent[];
}

export const demoShipments: DemoShipment[] = [
  {
    shipmentId: "SBX-SHIP-STEADFAST-DEMO01",
    trackingId: "SBX-SF-DEMO1001",
    provider: "steadfast",
    orderId: "100245",
    codAmountPoisha: 305800,
    weightGrams: 800,
    status: "IN_TRANSIT",
    statusHistory: ["CREATED", "PICKED_UP", "IN_TRANSIT"],
    orderStatus: "SHIPPED",
    idempotencyKey: "demo-ship-001",
    createdAt: "2026-10-24T08:30:00+06:00",
    zone: "inside_dhaka",
    district: "Dhaka",
    chargePoisha: 6000,
    failureReason: null,
    events: [
      { status: "CREATED", at: "2026-10-24T08:30:00+06:00", note: "বুকিং তৈরি হয়েছে (ডেমো)" },
      { status: "PICKED_UP", at: "2026-10-24T10:05:00+06:00", note: "কুরিয়ার পিকআপ করেছে (ডেমো)" },
      { status: "IN_TRANSIT", at: "2026-10-24T11:20:00+06:00", note: "ঢাকা হাবে পৌঁছেছে (ডেমো)" },
    ],
  },
  {
    shipmentId: "SBX-SHIP-PATHAO-DEMO02",
    trackingId: "SBX-PT-DEMO1002",
    provider: "pathao",
    orderId: "100244",
    codAmountPoisha: 0,
    weightGrams: 600,
    status: "OUT_FOR_DELIVERY",
    statusHistory: ["CREATED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY"],
    orderStatus: "SHIPPED",
    idempotencyKey: "demo-ship-002",
    createdAt: "2026-10-23T15:10:00+06:00",
    zone: "outside_dhaka",
    district: "Chattogram",
    chargePoisha: 12000,
    failureReason: null,
    events: [
      { status: "CREATED", at: "2026-10-23T15:10:00+06:00", note: "বুকিং তৈরি হয়েছে (ডেমো)" },
      { status: "PICKED_UP", at: "2026-10-23T17:40:00+06:00", note: "কুরিয়ার পিকআপ করেছে (ডেমো)" },
      { status: "IN_TRANSIT", at: "2026-10-24T07:15:00+06:00", note: "চট্টগ্রাম হাবে পৌঁছেছে (ডেমো)" },
      { status: "OUT_FOR_DELIVERY", at: "2026-10-24T10:50:00+06:00", note: "ডেলিভারি এজেন্টের কাছে (ডেমো)" },
    ],
  },
  {
    shipmentId: "SBX-SHIP-REDX-DEMO03",
    trackingId: "SBX-RX-DEMO1003",
    provider: "redx",
    orderId: "100243",
    codAmountPoisha: 150000,
    weightGrams: 1500,
    status: "DELIVERED",
    statusHistory: ["CREATED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED"],
    orderStatus: "DELIVERED",
    idempotencyKey: "demo-ship-003",
    createdAt: "2026-10-22T12:00:00+06:00",
    zone: "district",
    district: "Rajshahi",
    chargePoisha: 12000,
    failureReason: null,
    events: [
      { status: "CREATED", at: "2026-10-22T12:00:00+06:00", note: "বুকিং তৈরি হয়েছে (ডেমো)" },
      { status: "PICKED_UP", at: "2026-10-22T16:25:00+06:00", note: "কুরিয়ার পিকআপ করেছে (ডেমো)" },
      { status: "IN_TRANSIT", at: "2026-10-23T08:05:00+06:00", note: "রাজশাহী হাবে পৌঁছেছে (ডেমো)" },
      { status: "OUT_FOR_DELIVERY", at: "2026-10-23T11:30:00+06:00", note: "ডেলিভারি এজেন্টের কাছে (ডেমো)" },
      { status: "DELIVERED", at: "2026-10-23T13:45:00+06:00", note: "গ্রাহক পণ্য পেয়েছেন, COD সংগৃহীত (ডেমো)" },
    ],
  },
  {
    shipmentId: "SBX-SHIP-STEADFAST-DEMO04",
    trackingId: "SBX-SF-DEMO1004",
    provider: "steadfast",
    orderId: "100251",
    codAmountPoisha: 45000,
    weightGrams: 500,
    status: "FAILED",
    statusHistory: ["CREATED", "PICKED_UP", "IN_TRANSIT", "FAILED"],
    orderStatus: "FAILED",
    idempotencyKey: "demo-ship-004",
    createdAt: "2026-10-24T07:05:00+06:00",
    zone: "inside_dhaka",
    district: "Dhaka",
    chargePoisha: 6000,
    failureReason: "ঠিকানায় গিয়ে গ্রাহককে পাওয়া যায়নি, ফোন বন্ধ ছিল (ডেমো)",
    events: [
      { status: "CREATED", at: "2026-10-24T07:05:00+06:00", note: "বুকিং তৈরি হয়েছে (ডেমো)" },
      { status: "PICKED_UP", at: "2026-10-24T09:15:00+06:00", note: "কুরিয়ার পিকআপ করেছে (ডেমো)" },
      { status: "IN_TRANSIT", at: "2026-10-24T10:40:00+06:00", note: "ঢাকা হাবে পৌঁছেছে (ডেমো)" },
      { status: "FAILED", at: "2026-10-24T12:10:00+06:00", note: "ঠিকানায় গিয়ে গ্রাহককে পাওয়া যায়নি, ফোন বন্ধ ছিল (ডেমো)" },
    ],
  },
  {
    shipmentId: "SBX-SHIP-PATHAO-DEMO05",
    trackingId: "SBX-PT-DEMO1005",
    provider: "pathao",
    orderId: "100238",
    codAmountPoisha: 75000,
    weightGrams: 1200,
    status: "RETURNING",
    statusHistory: ["CREATED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "RETURNING"],
    orderStatus: "RETURNING",
    idempotencyKey: "demo-ship-005",
    createdAt: "2026-10-21T13:20:00+06:00",
    zone: "outside_dhaka",
    district: "Khulna",
    chargePoisha: 14000,
    failureReason: "গ্রাহক ডেলিভারি নিতে অস্বীকার করেছেন (ডেমো)",
    events: [
      { status: "CREATED", at: "2026-10-21T13:20:00+06:00", note: "বুকিং তৈরি হয়েছে (ডেমো)" },
      { status: "PICKED_UP", at: "2026-10-21T16:00:00+06:00", note: "কুরিয়ার পিকআপ করেছে (ডেমো)" },
      { status: "IN_TRANSIT", at: "2026-10-22T08:30:00+06:00", note: "খুলনা হাবে পৌঁছেছে (ডেমো)" },
      { status: "OUT_FOR_DELIVERY", at: "2026-10-22T11:05:00+06:00", note: "ডেলিভারি এজেন্টের কাছে (ডেমো)" },
      { status: "RETURNING", at: "2026-10-22T12:40:00+06:00", note: "গ্রাহক ডেলিভারি নিতে অস্বীকার করেছেন — পণ্য ফেরত আসছে (ডেমো)" },
    ],
  },
  {
    shipmentId: "SBX-SHIP-REDX-DEMO06",
    trackingId: "SBX-RX-DEMO1006",
    provider: "redx",
    orderId: "100236",
    codAmountPoisha: 98000,
    weightGrams: 2000,
    status: "RETURNED",
    statusHistory: ["CREATED", "PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY", "RETURNING", "RETURNED"],
    orderStatus: "RETURNED",
    idempotencyKey: "demo-ship-006",
    createdAt: "2026-10-20T10:15:00+06:00",
    zone: "district",
    district: "Sylhet",
    chargePoisha: 14000,
    failureReason: "দুইবার চেষ্টা করেও ডেলিভারি হয়নি — পণ্য গুদামে ফেরত এসেছে (ডেমো)",
    events: [
      { status: "CREATED", at: "2026-10-20T10:15:00+06:00", note: "বুকিং তৈরি হয়েছে (ডেমো)" },
      { status: "PICKED_UP", at: "2026-10-20T14:50:00+06:00", note: "কুরিয়ার পিকআপ করেছে (ডেমো)" },
      { status: "IN_TRANSIT", at: "2026-10-21T07:55:00+06:00", note: "সিলেট হাবে পৌঁছেছে (ডেমো)" },
      { status: "OUT_FOR_DELIVERY", at: "2026-10-21T10:20:00+06:00", note: "ডেলিভারি এজেন্টের কাছে (ডেমো)" },
      { status: "RETURNING", at: "2026-10-21T15:35:00+06:00", note: "ডেলিভারি ব্যর্থ — পণ্য ফেরত পাঠানো হয়েছে (ডেমো)" },
      { status: "RETURNED", at: "2026-10-23T09:10:00+06:00", note: "পণ্য গুদামে ফেরত এসেছে (ডেমো)" },
    ],
  },
  {
    shipmentId: "SBX-SHIP-STEADFAST-DEMO07",
    trackingId: "SBX-SF-DEMO1007",
    provider: "steadfast",
    orderId: "100252",
    codAmountPoisha: 45000,
    weightGrams: 1000,
    status: "CREATED",
    statusHistory: ["CREATED"],
    orderStatus: "CONFIRMED",
    idempotencyKey: "demo-ship-007",
    createdAt: "2026-10-24T11:45:00+06:00",
    zone: "inside_dhaka",
    district: "Dhaka",
    chargePoisha: 6000,
    failureReason: null,
    events: [
      { status: "CREATED", at: "2026-10-24T11:45:00+06:00", note: "বুকিং তৈরি হয়েছে, পিকআপের অপেক্ষায় (ডেমো)" },
    ],
  },
  {
    shipmentId: "SBX-SHIP-PATHAO-DEMO08",
    trackingId: "SBX-PT-DEMO1008",
    provider: "pathao",
    orderId: "100247",
    codAmountPoisha: 100000,
    weightGrams: 900,
    status: "PICKED_UP",
    statusHistory: ["CREATED", "PICKED_UP"],
    orderStatus: "SHIPPED",
    idempotencyKey: "demo-ship-008",
    createdAt: "2026-10-24T10:20:00+06:00",
    zone: "outside_dhaka",
    district: "Barishal",
    chargePoisha: 12000,
    failureReason: null,
    events: [
      { status: "CREATED", at: "2026-10-24T10:20:00+06:00", note: "বুকিং তৈরি হয়েছে (ডেমো)" },
      { status: "PICKED_UP", at: "2026-10-24T12:05:00+06:00", note: "কুরিয়ার পিকআপ করেছে (ডেমো)" },
    ],
  },
];

export interface ShipmentSummary {
  total: number;
  /** PICKED_UP + IN_TRANSIT + OUT_FOR_DELIVERY. */
  inTransit: number;
  delivered: number;
  /** FAILED + RETURNING + RETURNED. */
  problem: number;
  /** COD still to collect on active (not delivered/failed/returned) shipments. */
  codOutstandingPoisha: number;
}

export function summarizeShipments(shipments: DemoShipment[]): ShipmentSummary {
  let inTransit = 0;
  let delivered = 0;
  let problem = 0;
  let codOutstandingPoisha = 0;
  for (const s of shipments) {
    if (s.status === "DELIVERED") delivered += 1;
    else if (isProblemStatus(s.status)) problem += 1;
    else {
      if (s.status !== "CREATED") inTransit += 1;
      codOutstandingPoisha += s.codAmountPoisha;
    }
  }
  return { total: shipments.length, inTransit, delivered, problem, codOutstandingPoisha };
}

// ---------------------------------------------------------------------------
// Bookable demo orders — CreateShipmentInput shape (POST /api/v1/admin/
// shipments body, minus provider/idempotencyKey which the panel picks).
// The zone is what the courier area lookup would return for the address;
// the sandbox rate rule consumes the zone string directly.
// ---------------------------------------------------------------------------

export interface DemoBookableOrder {
  orderId: string;
  address: ShipmentAddress;
  zone: ShippingZone;
  /** Integer poisha still to collect on delivery (0 = prepaid). */
  codAmountPoisha: number;
  /** Default parcel weight; the panel can re-price at preset weights. */
  weightGrams: number;
  itemCount: number;
}

export const demoBookableOrders: DemoBookableOrder[] = [
  {
    orderId: "100255",
    address: {
      recipientName: "Tanvir Hasan",
      recipientPhone: "+8801712345678",
      division: "Dhaka",
      district: "Dhaka",
      upazila: "Mirpur",
      union: null,
      addressLine: "House 8, Road 2, Mirpur 10",
    },
    zone: "inside_dhaka",
    codAmountPoisha: 128000,
    weightGrams: 700,
    itemCount: 2,
  },
  {
    orderId: "100256",
    address: {
      recipientName: "Sharmin Akter",
      recipientPhone: "+8801812345678",
      division: "Chattogram",
      district: "Chattogram",
      upazila: "Hathazari",
      union: null,
      addressLine: "Village Road, Hathazari",
    },
    zone: "outside_dhaka",
    codAmountPoisha: 86500,
    weightGrams: 1800,
    itemCount: 1,
  },
  {
    orderId: "100257",
    address: {
      recipientName: "Arif Chowdhury",
      recipientPhone: "+8801912345678",
      division: "Rajshahi",
      district: "Rajshahi",
      upazila: "Boalia",
      union: null,
      addressLine: "Shaheb Bazar, Zero Point",
    },
    zone: "district",
    codAmountPoisha: 54200,
    weightGrams: 2500,
    itemCount: 3,
  },
];

/** Weight presets (grams) the booking panel can re-price at. */
export const BOOKING_WEIGHT_PRESETS_GRAMS: readonly number[] = [500, 1000, 1500, 2000, 2500, 3000];

/**
 * Booking rate card for one demo order, computed on the SERVER (page.tsx)
 * by calling the real sandbox functions — courierChargePoisha for every
 * preset weight and getRates for the per-provider estimate — so the
 * client panel only ever displays the sandbox rule's own outputs.
 */
export interface BookingRateCard {
  orderId: string;
  /** chargePoisha by weight preset, from courierChargePoisha(zone, w). */
  chargeByWeightGrams: Record<string, number>;
  /** Estimated delivery days by provider, from CourierRate.estimatedDays. */
  daysByProvider: Record<SandboxCourierProvider, number | null>;
}

/**
 * Subscriptions service (ADV-18 remainder) — the customer-facing CRUD
 * over the Subscription table plus the shared serialization the
 * account page, the public API and the admin list all render from.
 *
 * Rules enforced HERE (routes stay thin):
 *  - Ownership: every customer-side read/write filters on customerId;
 *    another customer's row is indistinguishable from a missing one.
 *  - The variant must be a live, sellable variant of an ACTIVE
 *    product at create time (re-checked again at generation time —
 *    the generator skips + records the failure when it is gone).
 *  - The address is a SNAPSHOT: copied from the chosen saved address
 *    or the submitted form at create time; later edits to the saved
 *    address do not move an existing subscription.
 *  - Payment is COD only in v1. A prepaid cycle would need a stored
 *    payment instrument, which the platform does not hold — the API
 *    refuses other methods instead of pretending to charge them.
 *  - Status machine: ACTIVE <-> PAUSED, anything -> CANCELLED
 *    (terminal). Resume restarts the cycle from NOW (nextRunAt =
 *    now + interval) rather than resurrecting missed cycles.
 */
import { prisma } from "@advance-ecommerce/db";
import { getSetting } from "@/lib/settings";
import { INTERVAL_LABELS, type SubscriptionInterval } from "./labels";

export {
  SUBSCRIPTION_INTERVALS,
  SUBSCRIPTION_STATUSES,
  INTERVAL_LABELS,
  type SubscriptionInterval,
  type SubscriptionStatus,
} from "./labels";

/** Advance a date by one interval. MONTHLY is calendar-based with the
 *  day clamped to the target month's length (Jan 31 -> Feb 28). */
export function addInterval(from: Date, interval: string): Date {
  const next = new Date(from.getTime());
  if (interval === "WEEKLY") {
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  if (interval === "BIWEEKLY") {
    next.setUTCDate(next.getUTCDate() + 14);
    return next;
  }
  // MONTHLY (and any unknown legacy value — monthly is the default).
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

/** The configured Subscribe & Save discount (Settings
 *  subscriptions.discount_bps, default 0 = no discount). Clamped to a
 *  sane 0..5000 (max 50%) so a fat-fingered setting cannot give the
 *  stock away; unparsable values degrade to 0. */
export async function loadSubscriptionDiscountBps(): Promise<number> {
  const raw = await getSetting("subscriptions.discount_bps");
  const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 5000);
}

export interface SubscriptionAddressSnapshot {
  division: string;
  district: string;
  upazila: string;
  union?: string | null;
  addressLine: string;
}

export interface SubscriptionView {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  variantId: string;
  productName: string;
  variantLabel: string;
  sku: string;
  unitPricePoisha: number;
  quantity: number;
  interval: string;
  intervalLabelBn: string;
  status: string;
  paymentMethod: string;
  address: SubscriptionAddressSnapshot;
  nextRunAt: string;
  lastRunAt: string | null;
  lastOrderId: string | null;
  lastError: string | null;
  runCount: number;
  createdAt: string;
}

type SubscriptionRow = Awaited<ReturnType<typeof loadSubscriptionRows>>[number];

async function loadSubscriptionRows(where: { customerId?: string; id?: string }) {
  return prisma.subscription.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      variant: {
        select: {
          sku: true,
          attributes: true,
          pricePoisha: true,
          product: { select: { titleBn: true } },
        },
      },
    },
  });
}

function variantLabel(attributes: unknown): string {
  if (typeof attributes === "object" && attributes !== null && !Array.isArray(attributes)) {
    const values = Object.values(attributes as Record<string, unknown>)
      .map((v) => (typeof v === "string" ? v : ""))
      .filter((v) => v !== "");
    if (values.length > 0) return values.join(" / ");
  }
  return "স্ট্যান্ডার্ড";
}

export function serializeSubscription(row: SubscriptionRow): SubscriptionView {
  return {
    id: row.id,
    customerId: row.customerId,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    variantId: row.variantId,
    productName: row.variant.product.titleBn,
    variantLabel: variantLabel(row.variant.attributes),
    sku: row.variant.sku,
    unitPricePoisha: row.variant.pricePoisha,
    quantity: row.quantity,
    interval: row.interval,
    intervalLabelBn:
      INTERVAL_LABELS[row.interval as SubscriptionInterval]?.bn ?? row.interval,
    status: row.status,
    paymentMethod: row.paymentMethod,
    address: {
      division: row.division,
      district: row.district,
      upazila: row.upazila,
      union: row.union,
      addressLine: row.addressLine,
    },
    nextRunAt: row.nextRunAt.toISOString(),
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastOrderId: row.lastOrderId,
    lastError: row.lastError,
    runCount: row.runCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSubscriptionsForCustomer(customerId: string): Promise<SubscriptionView[]> {
  const rows = await loadSubscriptionRows({ customerId });
  return rows.map(serializeSubscription);
}

export async function listSubscriptionsForAdmin(limit = 200): Promise<SubscriptionView[]> {
  const rows = await loadSubscriptionRows({});
  return rows.slice(0, limit).map(serializeSubscription);
}

export type CreateSubscriptionResult =
  | { ok: true; view: SubscriptionView }
  | { ok: false; code: string; message: string };

export async function createSubscription(input: {
  customerId: string;
  variantId: string;
  quantity: number;
  interval: SubscriptionInterval;
  address: SubscriptionAddressSnapshot;
  now?: Date;
}): Promise<CreateSubscriptionResult> {
  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, name: true, phone: true, deletedAt: true },
  });
  if (customer === null || customer.deletedAt !== null) {
    return { ok: false, code: "CUSTOMER_NOT_FOUND", message: "অ্যাকাউন্ট পাওয়া যায়নি। / Account not found." };
  }
  const variant = await prisma.productVariant.findUnique({
    where: { id: input.variantId },
    select: {
      id: true,
      isActive: true,
      deletedAt: true,
      product: { select: { status: true } },
    },
  });
  if (
    variant === null ||
    !variant.isActive ||
    variant.deletedAt !== null ||
    variant.product.status !== "ACTIVE"
  ) {
    return {
      ok: false,
      code: "VARIANT_UNAVAILABLE",
      message: "এই পণ্যটি এখন সাবস্ক্রিপশনের জন্য পাওয়া যাচ্ছে না। / This product is not available for subscription right now.",
    };
  }
  const now = input.now ?? new Date();
  const row = await prisma.subscription.create({
    data: {
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      variantId: variant.id,
      quantity: input.quantity,
      interval: input.interval,
      status: "ACTIVE",
      paymentMethod: "cod",
      division: input.address.division,
      district: input.address.district,
      upazila: input.address.upazila,
      union: input.address.union ?? null,
      addressLine: input.address.addressLine,
      nextRunAt: addInterval(now, input.interval),
    },
  });
  const rows = await loadSubscriptionRows({ id: row.id });
  return { ok: true, view: serializeSubscription(rows[0] as SubscriptionRow) };
}

export type UpdateSubscriptionResult =
  | { ok: true; view: SubscriptionView }
  | { ok: false; code: string; message: string };

/**
 * Customer-side management: pause / resume / cancel / change
 * interval / change quantity. Ownership is part of the lookup — a
 * row owned by someone else returns NOT_FOUND, never FORBIDDEN, so
 * the endpoint is not an existence oracle.
 */
export async function updateSubscriptionForCustomer(input: {
  customerId: string;
  subscriptionId: string;
  action?: "pause" | "resume" | "cancel";
  interval?: SubscriptionInterval;
  quantity?: number;
  now?: Date;
}): Promise<UpdateSubscriptionResult> {
  const existing = await prisma.subscription.findFirst({
    where: { id: input.subscriptionId, customerId: input.customerId },
    select: { id: true, status: true, interval: true },
  });
  if (existing === null) {
    return { ok: false, code: "NOT_FOUND", message: "সাবস্ক্রিপশন পাওয়া যায়নি। / Subscription not found." };
  }
  if (existing.status === "CANCELLED") {
    return {
      ok: false,
      code: "ALREADY_CANCELLED",
      message: "বাতিল করা সাবস্ক্রিপশন আর বদলানো যায় না — নতুন করে সাবস্ক্রাইব করুন। / A cancelled subscription cannot be changed; create a new one.",
    };
  }
  const now = input.now ?? new Date();
  const data: { status?: string; interval?: string; quantity?: number; nextRunAt?: Date } = {};
  if (input.action === "pause") {
    if (existing.status !== "ACTIVE") {
      return { ok: false, code: "NOT_ACTIVE", message: "শুধু সক্রিয় সাবস্ক্রিপশন থামানো যায়। / Only an active subscription can be paused." };
    }
    data.status = "PAUSED";
  } else if (input.action === "resume") {
    if (existing.status !== "PAUSED") {
      return { ok: false, code: "NOT_PAUSED", message: "এই সাবস্ক্রিপশনটি থামানো অবস্থায় নেই। / This subscription is not paused." };
    }
    data.status = "ACTIVE";
    // Resume restarts the cycle from now — missed cycles are NOT
    // back-filled (the customer was not charged for them either).
    data.nextRunAt = addInterval(now, input.interval ?? existing.interval);
  } else if (input.action === "cancel") {
    data.status = "CANCELLED";
  }
  if (input.interval !== undefined) {
    data.interval = input.interval;
    // An interval change on an ACTIVE subscription re-bases the next
    // run on the new interval; a PAUSED one applies it on resume.
    if (existing.status === "ACTIVE" && input.action !== "pause" && input.action !== "cancel") {
      data.nextRunAt = addInterval(now, input.interval);
    }
  }
  if (input.quantity !== undefined) data.quantity = input.quantity;
  if (Object.keys(data).length === 0) {
    return { ok: false, code: "NOTHING_TO_UPDATE", message: "কোনো পরিবর্তন দেওয়া হয়নি। / Nothing to update." };
  }
  await prisma.subscription.update({ where: { id: existing.id }, data });
  const rows = await loadSubscriptionRows({ id: existing.id });
  return { ok: true, view: serializeSubscription(rows[0] as SubscriptionRow) };
}

/** The customer's saved addresses, for the create forms (snapshot
 *  source). Only id + display fields leave the server. */
export async function listCustomerAddressOptions(customerId: string) {
  const rows = await prisma.address.findMany({
    where: { customerId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      label: true,
      division: true,
      district: true,
      upazila: true,
      union: true,
      addressLine: true,
      isDefault: true,
    },
  });
  return rows;
}

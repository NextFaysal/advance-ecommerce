import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoInboxFlags, isInboxEnabled } from "@/inbox/flags";
import { getConversationDb } from "@/inbox/store";
import { extractPhoneFromMessages } from "@/inbox/conversion";
import { parseAddress } from "@/bd/address-parser";
import { bdAddressSchema, normalizeBdPhone } from "@/checkout/validation";
import { getVariantSnapshots } from "@/orders/repository";
import { createManualOrder } from "@/orders/manual-create";

// Inbox conversation -> REAL order — doc 17 batch O4 (wave 22).
// Guard mirrors the sibling inbox draft route exactly: RBAC
// orders.create (src/reports/guard) + the module.f_commerce feature
// flag (OFF -> 403 FEATURE_LOCKED).
//
// The order is created through the SHARED manual-create service
// (src/orders/manual-create) with source "inbox" — Order.source is a
// free string (the repository defaults it to "website"), so no schema
// change was needed — and an internalNote that ALWAYS names the
// conversation id, so the order's history shows where it came from.
//
// Customer identity is phone-first, exactly like checkout + the draft
// route: the phone comes from the request body when staff supply one,
// else from the conversation (the DB store derives the captured phone
// from the stored message bodies — the full number is never stored on
// the conversation row and never returned by this route). NO usable
// phone -> 422; a number is never invented. The address comes from
// the body (`address` directly, or `addressText` run through the
// Bangla address parser with optional field overrides, the same
// assembly buildOrderDraft uses) — if neither yields a valid
// bdAddress the request fails 422 rather than guessing one.
// Item prices: a staff-entered unitPricePoisha wins; when omitted the
// CATALOG price is filled in here, so the shared service's
// staff-price contract (and its override note) stays truthful — a
// catalog-priced line records no override.
const convertSchema = z.object({
  customerName: z.string().min(2).max(120).optional(),
  phone: z.string().min(11).max(15).optional(),
  address: bdAddressSchema.optional(),
  addressText: z.string().min(5).max(1000).optional(),
  addressOverride: z
    .object({
      division: z.string().min(1).optional(),
      district: z.string().min(1).optional(),
      upazila: z.string().min(1).optional(),
      union: z.string().optional(),
      addressLine: z.string().min(5).optional(),
    })
    .optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().positive(),
        unitPricePoisha: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
  paymentMethod: z.enum(["cod", "bkash", "nagad"]).default("cod"),
  shippingMethod: z.enum(["inside_dhaka", "outside_dhaka", "pickup"]).optional(),
  shippingOverridePoisha: z.number().int().nonnegative().optional(),
  couponCode: z.string().max(64).optional(),
  note: z.string().max(500).optional(),
});

function errorJson(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("orders.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isInboxEnabled(demoInboxFlags)) {
    return errorJson(403, "FEATURE_LOCKED", "F-commerce inbox is locked for this install (module.f_commerce is OFF).");
  }
  const parsed = convertSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return errorJson(
      400,
      "INVALID_INPUT",
      "রূপান্তরের তথ্য সঠিক নয়। / Invalid convert-to-order input.",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const body = parsed.data;

  let found: Awaited<ReturnType<typeof getConversationDb>>;
  try {
    found = await getConversationDb(params.id);
  } catch {
    return errorJson(503, "DB_NOT_READY", "Inbox database is not available.");
  }
  if (!found) {
    return errorJson(404, "NOT_FOUND", "Conversation not found.");
  }
  const { conversation: conv, messages } = found;

  // Phone: body override, else the conversation's captured phone,
  // else extracted from the thread — never invented.
  const phoneRaw = body.phone ?? conv.customerPhone ?? extractPhoneFromMessages(messages) ?? "";
  const phone = normalizeBdPhone(phoneRaw);
  if (!phone) {
    return errorJson(
      422,
      "PHONE_REQUIRED",
      "এই কথোপকথনে গ্রাহকের ব্যবহারযোগ্য ফোন নম্বর পাওয়া যায়নি — অর্ডার তৈরি করতে সঠিক ফোন নম্বর দরকার। / No usable customer phone number was found for this conversation — a valid phone number is required to create an order.",
    );
  }

  const customerName = (body.customerName ?? conv.customerDisplayName).trim();
  if (customerName.length < 2) {
    return errorJson(
      422,
      "NAME_REQUIRED",
      "গ্রাহকের নাম দরকার (কমপক্ষে ২ অক্ষর)। / A customer name is required (at least 2 characters).",
    );
  }

  // Address: explicit object wins; else parse the free text with
  // field overrides (buildOrderDraft's assembly); else fail — an
  // address is never guessed.
  let address = body.address;
  if (!address && body.addressText) {
    const parsedAddress = parseAddress(body.addressText);
    const candidate = {
      division: body.addressOverride?.division ?? parsedAddress.division ?? undefined,
      district: body.addressOverride?.district ?? parsedAddress.district ?? undefined,
      upazila:
        body.addressOverride?.upazila ??
        parsedAddress.upazila ??
        parsedAddress.area ??
        undefined,
      union: body.addressOverride?.union,
      addressLine: body.addressOverride?.addressLine ?? parsedAddress.addressLine,
    };
    const checked = bdAddressSchema.safeParse(candidate);
    if (!checked.success) {
      return errorJson(
        422,
        "ADDRESS_INVALID",
        "ঠিকানা সম্পূর্ণ করা যায়নি — বিভাগ, জেলা, উপজেলা ও পূর্ণ ঠিকানা দিন। / The address could not be completed — provide division, district, upazila and a full address line.",
        checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      );
    }
    address = checked.data;
  }
  if (!address) {
    return errorJson(
      422,
      "ADDRESS_REQUIRED",
      "অর্ডার তৈরি করতে গ্রাহকের ঠিকানা দরকার। / A customer address is required to create an order.",
    );
  }

  // Fill catalog prices for lines staff did not price; an unknown
  // variant keeps price 0 here and the service fails it with
  // VARIANT_NOT_FOUND before any money math runs.
  const snapshots = await getVariantSnapshots(body.items.map((i) => i.variantId));
  const items = body.items.map((i) => ({
    variantId: i.variantId,
    quantity: i.quantity,
    unitPricePoisha: i.unitPricePoisha ?? snapshots.get(i.variantId)?.unitPricePoisha ?? 0,
  }));

  const result = await createManualOrder(
    {
      phone,
      customerName,
      address,
      items,
      paymentMethod: body.paymentMethod,
      shippingMethod: body.shippingMethod,
      shippingOverridePoisha: body.shippingOverridePoisha,
      couponCode: body.couponCode,
      note: body.note,
      source: "inbox",
      internalNote: `ইনবক্স কথোপকথন থেকে তৈরি — conversation ${conv.id} (${conv.channel}) / Created from inbox conversation ${conv.id} (${conv.channel})`,
    },
    {
      id: guard.userId,
      permissions: guard.permissions,
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    },
  );
  if (!result.ok) {
    return errorJson(result.httpStatus, result.code, result.message, result.details);
  }
  return NextResponse.json(
    {
      data: {
        order: {
          id: result.orderId,
          orderNo: result.orderNo,
          totalPoisha: result.pricing?.totalPoisha ?? result.order?.totalPoisha ?? null,
          pricing: result.pricing,
        },
      },
      meta: { source: "inbox", conversationId: conv.id, db: "PRISMA" },
    },
    { status: 201 },
  );
}

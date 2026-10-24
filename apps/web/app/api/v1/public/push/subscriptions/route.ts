/**
 * Push subscriptions — customer-facing subscribe / unsubscribe.
 *
 * POST   { endpoint, keys: { p256dh, auth } }  (a browser
 *        PushSubscription JSON) → stored in the PushSubscription
 *        table (upsert by endpoint). When the request carries a valid
 *        customer_session cookie, the subscription is attached to that
 *        customer; anonymous subscriptions are stored with no customer
 *        (the account-session attach is what "logged in" means here —
 *        subscribe itself is not login-gated).
 * DELETE { endpoint } → the stored subscription is removed.
 *
 * The subscription KEYS (p256dh/auth) are stored server-side only and
 * are never returned by any response.
 */
import { NextResponse } from "next/server";
import { requireCustomer } from "@/customer-auth/http";
import { validatePushSubscription } from "@/platform/push";
import {
  isPushConfigured,
  removePushSubscription,
  upsertPushSubscription,
} from "@/platform/push-server";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const validated = validatePushSubscription(body);
  if (!validated.ok) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid push subscription.", details: validated.errors } },
      { status: 400 },
    );
  }
  const customer = await requireCustomer();
  const saved = await upsertPushSubscription({
    ...validated.value,
    ...(customer ? { customerId: customer.id } : {}),
    userAgent: validated.value.userAgent ?? req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json(
    {
      data: {
        endpoint: saved.endpoint,
        customerId: saved.customerId ?? null,
        pushConfigured: isPushConfigured(),
      },
      meta: { persistence: "database" },
    },
    { status: 201 },
  );
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!endpoint.startsWith("https://")) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "A push subscription endpoint is required." } },
      { status: 400 },
    );
  }
  const removed = await removePushSubscription(endpoint);
  return NextResponse.json({
    data: { endpoint, removed },
    meta: { persistence: "database" },
  });
}

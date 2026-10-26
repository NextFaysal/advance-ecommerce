// Public SMS delivery-report (DLR) webhook — ADV-2 (doc 22).
// POST /api/v1/public/sms/dlr?provider=bulksmsbd|sslwireless|greenweb
//
// Providers POST delivery status for a previously accepted message
// here (the URL is configured in the provider's own panel — this route
// cannot force them to call it). Each provider's field names are
// normalised to { providerMessageId, status } where status is one of
// delivered | failed | pending | unknown.
//
// DURABLE-STORE LIMIT — read before "fixing": there is currently NO
// table that can record a DLR. NotificationLog (the notification
// delivery log) has no provider-message-id column, and job results
// live only in BullMQ + handler logs, so a callback's message id
// cannot be joined to a send record. Per the ADV-2 brief this route
// therefore does the honest minimum: it parses + normalises the
// callback, logs ids/status ONLY (never a phone number or message
// body), and answers 200 with recorded:false and the reason in meta —
// it never claims persistence it did not perform. Recording DLRs
// durably needs a schema addition (a providerMessageId column +
// index on NotificationLog, or an SmsDeliveryReport table); that is
// a deliberate follow-up, not an oversight.
import { NextResponse } from "next/server";
import { SMS_PROVIDERS, type SmsProviderName } from "@/integrations/sms";

export const dynamic = "force-dynamic";

type DlrStatus = "delivered" | "failed" | "pending" | "unknown";

/** Per-provider raw status vocabularies, mapped conservatively:
 *  anything not clearly delivered/failed stays pending/unknown
 *  rather than being upgraded to a success it may not be. */
const STATUS_MAPS: Record<SmsProviderName, Record<string, DlrStatus>> = {
  bulksmsbd: {
    delivered: "delivered",
    success: "delivered",
    sent: "delivered",
    failed: "failed",
    error: "failed",
    undelivered: "failed",
    pending: "pending",
    processing: "pending",
  },
  sslwireless: {
    delivered: "delivered",
    success: "delivered",
    sent: "delivered",
    failed: "failed",
    error: "failed",
    undelivered: "failed",
    pending: "pending",
    accepted: "pending",
  },
  greenweb: {
    delivered: "delivered",
    success: "delivered",
    s: "delivered",
    sent: "delivered",
    failed: "failed",
    error: "failed",
    f: "failed",
    pending: "pending",
  },
};

const ID_FIELDS: Record<SmsProviderName, readonly string[]> = {
  bulksmsbd: ["message_id", "messageId", "id"],
  sslwireless: ["reference_id", "referenceId", "csms_id", "csmsId", "message_id"],
  greenweb: ["messageid", "message_id", "messageId", "id"],
};

const STATUS_FIELDS: Record<SmsProviderName, readonly string[]> = {
  bulksmsbd: ["status", "delivery_status", "dlr_status"],
  sslwireless: ["smsStatus", "status", "delivery_status"],
  greenweb: ["status", "delivery_status"],
};

function firstField(body: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = body[field];
    if (typeof value === "string" && value !== "") return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

export async function POST(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider") ?? "";
  if (!(SMS_PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Unknown SMS provider." } },
      { status: 400 },
    );
  }
  const name = provider as SmsProviderName;

  // Providers send DLRs as JSON or form-encoded; accept both.
  const rawText = await req.text().catch(() => "");
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    const form = new URLSearchParams(rawText);
    for (const [key, value] of form.entries()) body[key] = value;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "DLR body must be an object." } },
      { status: 400 },
    );
  }

  const providerMessageId = firstField(body, ID_FIELDS[name]);
  const rawStatus = firstField(body, STATUS_FIELDS[name]);
  if (providerMessageId === null || rawStatus === null) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "DLR body is missing the message id or status field." } },
      { status: 400 },
    );
  }
  const status: DlrStatus = STATUS_MAPS[name][rawStatus.toLowerCase()] ?? "unknown";

  // Ids + status only — never a phone, never a message body.
  console.log("[sms-dlr]", { provider: name, providerMessageId, status });

  return NextResponse.json({
    data: { received: true, recorded: false, providerMessageId, status },
    meta: {
      durableStore: "NONE",
      note: "No DLR store exists yet (NotificationLog has no provider message id column); this callback was acknowledged and logged only, not persisted.",
    },
  });
}

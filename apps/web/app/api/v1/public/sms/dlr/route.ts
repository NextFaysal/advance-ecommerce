// Public SMS delivery-report (DLR) webhook — ADV-2 (doc 22).
// POST /api/v1/public/sms/dlr?provider=bulksmsbd|sslwireless|greenweb
//
// Providers POST delivery status for a previously accepted message
// here (the URL is configured in the provider's own panel — this route
// cannot force them to call it). Each provider's field names are
// normalised to { providerMessageId, status } where status is one of
// delivered | failed | pending | unknown.
//
// DURABLE STORE (schema wave 2, 2026-10-26 — supersedes the ADV-2
// recorded:false behaviour): NotificationLog now carries
// providerMessageId and the send paths record accepted real-provider
// sends with it, so callbacks are applied to the matching row via
// src/jobs/delivery-reports.ts (applySmsDeliveryReport). "recorded"
// in the response now means a matching send row was found (and, for
// a failed report, flipped to FAILED) — see that module for the exact
// semantics, including why delivered/pending do not mutate the row
// (NotificationStatus has no DELIVERED value). Callbacks with no
// matching recorded send still answer recorded:false with the reason
// — this route never claims persistence it did not perform.
import { NextResponse } from "next/server";
import { SMS_PROVIDERS, type SmsProviderName } from "@/integrations/sms";
import { applySmsDeliveryReport } from "@/jobs/delivery-reports";

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

  const applied = await applySmsDeliveryReport({
    provider: name,
    providerMessageId,
    status,
  });

  if (!applied.recorded) {
    return NextResponse.json({
      data: { received: true, recorded: false, providerMessageId, status },
      meta: {
        durableStore: "NotificationLog.providerMessageId",
        reason: applied.reason,
        note:
          applied.reason === "PROVIDER_MISMATCH"
            ? "A send row carries this message id under a different provider; message ids are only unique per provider, so the report was not applied."
            : "No recorded send carries this provider message id (the send predates durable DLR recording, or was made outside this system); the callback was acknowledged and logged only.",
      },
    });
  }

  return NextResponse.json({
    data: {
      received: true,
      recorded: true,
      providerMessageId,
      status,
      notificationLogId: applied.notificationLogId,
      rowStatus: applied.rowStatus,
      mutated: applied.mutated,
    },
    meta: {
      durableStore: "NotificationLog.providerMessageId",
      note: "Matched to the recorded send row. A failed report flips the row to FAILED (errorRef DLR_DELIVERY_FAILED); delivered/pending leave the row's SENT as its terminal recorded state — NotificationStatus has no DELIVERED value.",
    },
  });
}

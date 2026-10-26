import { NextResponse } from "next/server";
import { authenticateDeviceToken, type SmsDeviceAuth } from "@/bd/devices";
import { dbTrxRegistry } from "@/bd/sms-trx-registry-db";
import {
  candidateFromOrder,
  ingestSms,
  ingestSmsItemSchema,
  ingestSmsRequestSchema,
  isBatchRequest,
  smsIngestionStore,
  type IngestSmsResult,
  type SmsIngestionRecord,
} from "@/bd/sms-ingestion";
import { listOrders } from "@/orders/repository";
import { guardError, requireAdmin } from "@/reports/guard";

// SMS ingestion — Agent 49, Step 44 (E1 follow-up).
// GET:  RBAC payments.verify_manual (staff session ONLY — a device
//       token may submit SMS, never read the record list). Lists
//       ingestion records (newest first, ?outcome= filter, ?limit=).
//       Phones are masked in every record by construction — the
//       store never holds a full phone.
// POST: EITHER a staff session (RBAC payments.verify_manual, the
//       admin UI path) OR a per-device token (wave 58):
//       `Authorization: Bearer ae_dev_…` provisioned in Admin >
//       BD Tools > ডিভাইস টোকেন (src/bd/devices.ts). Precedence: a
//       request CARRYING an Authorization header is authenticated
//       as a device ONLY — an invalid/revoked token answers 401 and
//       never falls back to the session. No header -> session path,
//       unchanged. Device-authed records keep source
//       "android_forwarder" and gain `device: { id, label }`
//       provenance (process-only — see src/bd/sms-ingestion.ts).
//       Body is one SMS item { smsText, source, receivedAt?,
//       providerHint? } or a batch { items: [...] } (max 50). Batch
//       items are validated and ingested one by one: a bad item
//       yields its own error entry and NEVER fails the batch. There
//       is no rate limiter on this route for either auth path — the
//       zod body caps (50 items, 2000-char SMS) and (provider,
//       TrxID) dedupe apply identically to both.
//
// Persistence: DB-backed (DB swap 2026-10-24) — records live in the
// sms_ingestions table with UNIQUE(provider, trxId); matching runs
// against the DB-backed orders repository. REJECTED records (no parsed
// TrxID/amount) have no table representation and stay process-local —
// see src/bd/sms-ingestion.ts for the drift notes.
//
// Ingestion NEVER marks anything paid: a MATCHED record is a verification
// PROPOSAL for staff. The payment is confirmed only through the existing
// manual-TrxID review flow (/api/v1/admin/payments/manual-trx). The raw
// SMS body is never stored or logged — records hold a SHA-256 hash of it,
// the parsed fields (masked phone), and, for parsed payment SMS only, a
// truncated preview. REJECTED bodies (incl. OTPs) get no preview at all.

const META = {
  persistence: "database",
  marksPaid: false,
  note: "Ingestion proposes matches for staff review only; payment confirmation stays with the manual-TrxID review flow.",
} as const;

function publicResult(result: IngestSmsResult) {
  return { record: result.record, duplicate: result.duplicate };
}

export async function GET(req: Request) {
  const guard = await requireAdmin("payments.verify_manual");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const params = new URL(req.url).searchParams;
  const outcome = params.get("outcome");
  const limitParam = Number(params.get("limit") ?? "100");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 200) : 100;
  let records: SmsIngestionRecord[] = await smsIngestionStore.list(limit);
  if (outcome) records = records.filter((r) => r.outcome === outcome);
  return NextResponse.json({ data: { records }, meta: META });
}

export async function POST(req: Request) {
  // Auth (see header): Authorization header present -> device token
  // only, fail-closed. Absent -> the original staff-session guard.
  let device: SmsDeviceAuth | null = null;
  if (req.headers.get("authorization")) {
    device = await authenticateDeviceToken(req);
    if (!device) {
      return NextResponse.json(
        { error: { code: "DEVICE_TOKEN_INVALID", message: "Device token missing, unknown, or revoked." } },
        { status: 401 },
      );
    }
  } else {
    const guard = await requireAdmin("payments.verify_manual");
    if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  }
  const meta = device
    ? { ...META, auth: { kind: "device" as const, deviceId: device.id, deviceLabel: device.label } }
    : META;
  const body: unknown = await req.json().catch(() => null);
  const parsed = ingestSmsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid SMS ingestion request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  // Match candidates come from the DB-backed orders repository (the
  // orders module's read contract) — most recent 200 orders.
  const { rows: orders } = await listOrders({ page: 1, pageSize: 200 });
  const deps = {
    store: smsIngestionStore,
    orders: orders.map(candidateFromOrder),
    verifiedRegistry: dbTrxRegistry,
  };

  if (!isBatchRequest(parsed.data)) {
    const result = await ingestSms(device ? { ...parsed.data, device } : parsed.data, deps);
    return NextResponse.json({ data: publicResult(result), meta }, { status: 201 });
  }

  // Batch mode: validate each item on its own so one malformed SMS
  // cannot fail the other 49. Valid items ingest in order, so a TrxID
  // repeated inside one batch dedupes against its own first occurrence.
  const results = [];
  for (const [index, rawItem] of parsed.data.items.entries()) {
    const item = ingestSmsItemSchema.safeParse(rawItem);
    if (!item.success) {
      results.push({ index, record: null, duplicate: false, error: "INVALID_ITEM", issues: item.error.issues });
      continue;
    }
    const result = await ingestSms(device ? { ...item.data, device } : item.data, deps);
    results.push({ index, record: result.record, duplicate: result.duplicate, error: null, issues: null });
  }
  const counts: Record<string, number> = {};
  for (const entry of results) {
    const key = entry.record ? entry.record.outcome : "INVALID_ITEM";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return NextResponse.json({ data: { results, counts }, meta }, { status: 201 });
}

import { NextResponse } from "next/server";
import { demoTrxRegistry } from "@/bd/sms-autoverify";
import {
  candidateFromOrder,
  demoSmsIngestionStore,
  ingestSms,
  ingestSmsItemSchema,
  ingestSmsRequestSchema,
  isBatchRequest,
  type IngestSmsResult,
  type SmsIngestionRecord,
} from "@/bd/sms-ingestion";
import { MOCK_ORDERS } from "@/orders/mock";
import { guardError, requireAdmin } from "@/reports/guard";

// SMS ingestion — Agent 49, Step 44 (E1 follow-up).
// GET:  RBAC payments.verify_manual. Lists ingestion records (newest
//       first, ?outcome= filter, ?limit=). Phones are masked in every
//       record by construction — the store never holds a full phone.
// POST: RBAC payments.verify_manual. Body is one SMS item
//       { smsText, source, receivedAt?, providerHint? } or a batch
//       { items: [...] } (max 50). Batch items are validated and
//       ingested one by one: a bad item yields its own error entry and
//       NEVER fails the batch.
//
// Persistence: IN-MEMORY-DEMO only (demoSmsIngestionStore). Matching runs
// against the TEMPORARY MOCK order store (src/orders/mock.ts) — the same
// source the orders API reads — until Prisma orders land; the DB version
// stores records in an sms_ingestions table with UNIQUE(provider, trxId).
//
// Ingestion NEVER marks anything paid: a MATCHED record is a verification
// PROPOSAL for staff. The payment is confirmed only through the existing
// manual-TrxID review flow (/api/v1/admin/payments/manual-trx). The raw
// SMS body is never stored or logged — records hold a SHA-256 hash of it,
// the parsed fields (masked phone), and, for parsed payment SMS only, a
// truncated preview. REJECTED bodies (incl. OTPs) get no preview at all.

const META = {
  persistence: "in-memory-demo",
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
  let records: SmsIngestionRecord[] = demoSmsIngestionStore.list(limit);
  if (outcome) records = records.filter((r) => r.outcome === outcome);
  return NextResponse.json({ data: { records }, meta: META });
}

export async function POST(req: Request) {
  const guard = await requireAdmin("payments.verify_manual");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body: unknown = await req.json().catch(() => null);
  const parsed = ingestSmsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid SMS ingestion request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const deps = {
    store: demoSmsIngestionStore,
    orders: MOCK_ORDERS.map(candidateFromOrder),
    verifiedRegistry: demoTrxRegistry,
  };

  if (!isBatchRequest(parsed.data)) {
    const result = ingestSms(parsed.data, deps);
    return NextResponse.json({ data: publicResult(result), meta: META }, { status: 201 });
  }

  // Batch mode: validate each item on its own so one malformed SMS
  // cannot fail the other 49. Valid items ingest in order, so a TrxID
  // repeated inside one batch dedupes against its own first occurrence.
  const results = parsed.data.items.map((rawItem, index) => {
    const item = ingestSmsItemSchema.safeParse(rawItem);
    if (!item.success) {
      return { index, record: null, duplicate: false, error: "INVALID_ITEM", issues: item.error.issues };
    }
    const result = ingestSms(item.data, deps);
    return { index, record: result.record, duplicate: result.duplicate, error: null, issues: null };
  });
  const counts: Record<string, number> = {};
  for (const entry of results) {
    const key = entry.record ? entry.record.outcome : "INVALID_ITEM";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return NextResponse.json({ data: { results, counts }, meta: META }, { status: 201 });
}

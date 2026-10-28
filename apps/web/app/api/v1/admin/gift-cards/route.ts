import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  GiftCardRedemptionError,
  issueGiftCards,
  listGiftCards,
} from "@/marketing/gift-cards";
import { recordDemoAudit } from "../audit-log/store";

// Gift cards — admin (ADV-18).
// GET:  list cards with LEDGER-DERIVED balances + effective status
//       (marketing.coupon). The plaintext code is never stored, so
//       it can never appear here — only hash + last-4 exist at rest.
// POST: issue 1..100 cards of a fixed amount (marketing.campaign).
//       The response carries each plaintext code EXACTLY ONCE; it is
//       not written to the audit log or anywhere else. A disabled
//       module (module.marketing_mechanics OFF) locks both verbs.
function locked() {
  return NextResponse.json(
    {
      error: {
        code: "FEATURE_LOCKED",
        message: "Marketing mechanics module is locked for this install (module.marketing_mechanics is OFF).",
      },
    },
    { status: 403 },
  );
}

export async function GET() {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("marketing.coupon");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isFeatureEnabled("module.marketing_mechanics")) return locked();
  const cards = await listGiftCards();
  return NextResponse.json({
    data: { cards },
    meta: {
      persistence: "database",
      module: "module.marketing_mechanics",
      note: "Balances are derived from the GiftCardTransaction ledger on every read; plaintext codes are never stored and cannot be re-displayed.",
    },
  });
}

const issueSchema = z.object({
  amountPoisha: z.number().int().positive().max(100_000_000),
  count: z.number().int().min(1).max(100).default(1),
  expiresAt: z.string().datetime().nullable().optional(),
  reason: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  await ensureDbFeatureFlags().catch(() => {});
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isFeatureEnabled("module.marketing_mechanics")) return locked();
  const parsed = issueSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Gift card issue input invalid.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      },
      { status: 400 },
    );
  }
  try {
    const issued = await issueGiftCards({
      count: parsed.data.count,
      initialPoisha: parsed.data.amountPoisha,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      createdById: guard.userId,
    });
    await recordDemoAudit({
      actorId: guard.userId,
      action: "gift_card.issue",
      entityType: "GiftCard",
      entityId: issued[0]?.id ?? null,
      afterJson: {
        count: issued.length,
        amountPoisha: parsed.data.amountPoisha,
        cardIds: issued.map((c) => c.id),
        codeLast4s: issued.map((c) => c.codeLast4),
      },
      reason: parsed.data.reason,
    });
    return NextResponse.json(
      {
        data: { issued },
        meta: {
          persistence: "database",
          module: "module.marketing_mechanics",
          note: "These plaintext codes are shown ONCE — only their hashes are stored. Copy them now; they cannot be recovered.",
        },
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof GiftCardRedemptionError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: 400 },
      );
    }
    throw err;
  }
}

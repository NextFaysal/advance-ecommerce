/**
 * GET|POST /api/v1/public/pay/[token] — public payment link. Agent 19.
 *
 * The token in the path is the ONLY credential and the ONLY lookup key:
 * it is hashed and looked up by hash (resolvePayLink). A link id is never
 * accepted here, and neither the token nor its hash ever appears in a
 * response. POST starts a SANDBOX payment only (Agent 9 gateway) — no real
 * gateway call, no money moves, and the link is NOT marked paid by this
 * route; paid state arrives via verified webhook in the real flow.
 *
 * Persistence is the in-memory demo store (meta.source says so); the DB
 * version swaps resolvePayLink's store for the payment_links table.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeBdPhone } from "@advance-ecommerce/validators";
import { ensureDemoPaymentLink, initiateSandboxPay, resolvePayLink } from "@/storefront-ux/pay-link-view";

const payBodySchema = z.object({
  method: z.enum(["bkash", "nagad", "sslcommerz"]),
  phone: z.string().min(11).max(15),
});

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  ensureDemoPaymentLink();
  const resolved = resolvePayLink(params.token);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "পেমেন্ট লিংক পাওয়া যায়নি।" } },
      { status: 404 },
    );
  }
  return NextResponse.json({
    data: { link: resolved.view },
    meta: { source: "in-memory-demo", sandbox: true },
  });
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  ensureDemoPaymentLink();
  const resolved = resolvePayLink(params.token);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "পেমেন্ট লিংক পাওয়া যায়নি।" } },
      { status: 404 },
    );
  }
  if (!resolved.view.isPayable) {
    return NextResponse.json(
      { error: { code: "LINK_NOT_PAYABLE", message: resolved.view.statusLabelBn } },
      { status: 409 },
    );
  }
  const parsed = payBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "পেমেন্ট মাধ্যম ও সঠিক মোবাইল নম্বর দিন।", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const phone = normalizeBdPhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।" } },
      { status: 400 },
    );
  }
  try {
    const result = await initiateSandboxPay(resolved.record, {
      method: parsed.data.method,
      customerPhone: phone,
      baseUrl: new URL(req.url).origin,
    });
    if (!result.ok) {
      return NextResponse.json({ error: { code: "LINK_NOT_PAYABLE", message: result.error } }, { status: 409 });
    }
    return NextResponse.json({ data: result, meta: { source: "in-memory-demo", sandbox: true } });
  } catch {
    return NextResponse.json(
      { error: { code: "SANDBOX_INIT_FAILED", message: "পেমেন্ট শুরু করা যায়নি, আবার চেষ্টা করুন।" } },
      { status: 400 },
    );
  }
}

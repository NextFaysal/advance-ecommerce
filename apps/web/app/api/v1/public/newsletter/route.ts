import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { newsletterSubscribeSchema, DEFAULT_NEWSLETTER_SOURCE } from "@/newsletter/schema";
import {
  isNewsletterHoneypotTripped,
  newsletterRateLimiter,
  newsletterRateLimitKey,
  noteNewsletterHoneypotDrop,
} from "@/newsletter/policy";
import { newsletterStore, unsubscribeNewsletter } from "@/newsletter/store-db";
import { NewsletterStoreUnavailableError } from "@/newsletter/store";
import { recordMarketingConsent } from "@/privacy/ledger";

/**
 * Marketing consent log hook (ADV-29 — privacy.consent_log): every
 * REAL consent change lands in the ledger. Best-effort by design —
 * a ledger failure is logged server-side and never breaks the
 * subscribe/unsubscribe the visitor asked for. Honeypot drops and
 * duplicate no-op subscribes record NOTHING (no consent changed).
 */
async function logConsent(input: {
  action: "granted" | "withdrawn";
  source: string;
  email: string;
}): Promise<void> {
  try {
    const customer = await prisma.customer.findFirst({
      where: { email: input.email },
      select: { id: true, phone: true },
    });
    await recordMarketingConsent({
      action: input.action,
      source: input.source,
      email: input.email,
      phone: customer?.phone ?? null,
      customerId: customer?.id ?? null,
    });
  } catch (error) {
    console.error("privacy.consent_log write failed (newsletter):", error);
  }
}

// POST /api/v1/public/newsletter — newsletter subscribe.
//
// Public (no account needed). Subscribing is IDEMPOTENT: an
// already-subscribed address returns 200 with duplicate: true and no
// second row. Only the normalized email + source are stored; the
// response never carries the row id.
//
// HONESTY: persistence needs the NewsletterSubscriber table. Until
// that model + migration land (schema is owned by the parent), the
// store reports itself unavailable and this route answers 503
// NEWSLETTER_NOT_READY — it never returns a fake success for an
// address that was not stored. Honeypot drops are the single
// deliberate exception, mirroring the contact endpoint: a bot that
// fills the hidden field gets a plausible 201 and nothing is stored,
// so bots cannot tell they were dropped.
export async function POST(req: Request) {
  const rawBody: unknown = await req.json().catch(() => null);

  // Honeypot first: a tripped bot gets a plausible success and leaves.
  if (isNewsletterHoneypotTripped(rawBody)) {
    noteNewsletterHoneypotDrop();
    const email =
      typeof rawBody === "object" && rawBody !== null && "email" in rawBody
        ? String((rawBody as { email: unknown }).email ?? "")
        : "";
    return NextResponse.json(
      {
        data: {
          subscriber: { email, status: "subscribed", subscribedAt: new Date().toISOString() },
          duplicate: false,
        },
        meta: { persistence: "database" },
      },
      { status: 201 },
    );
  }

  const parsed = newsletterSubscribeSchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "সঠিক ইমেইল ঠিকানা দিন।" } },
      { status: 400 },
    );
  }

  // IP placeholder: first x-forwarded-for hop until trusted-proxy setup
  // (same convention as the contact endpoint).
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]?.trim() || "unknown";
  const limit = newsletterRateLimiter.check(newsletterRateLimitKey(parsed.data.email, ip));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "অনেকবার চেষ্টা করা হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন।",
        },
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const result = await newsletterStore.subscribe(parsed.data);
    if (!result.ok) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: result.error } },
        { status: 400 },
      );
    }
    // Consent granted — only on a real change (fresh subscribe or
    // reactivation), never on the idempotent duplicate no-op.
    if (!result.duplicate) {
      await logConsent({
        action: "granted",
        source: parsed.data.source ?? DEFAULT_NEWSLETTER_SOURCE,
        email: parsed.data.email,
      });
    }
    return NextResponse.json(
      {
        data: { subscriber: result.subscriber, duplicate: result.duplicate },
        meta: { persistence: "database" },
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (e) {
    if (e instanceof NewsletterStoreUnavailableError) {
      return NextResponse.json(
        {
          error: {
            code: "NEWSLETTER_NOT_READY",
            message: "দুঃখিত — এই মুহূর্তে সাবস্ক্রাইব করা যাচ্ছে না, পরে আবার চেষ্টা করুন।",
          },
          meta: { persistence: "unavailable", reason: "model-pending" },
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "সার্ভারে সমস্যা হয়েছে — আবার চেষ্টা করুন।" } },
      { status: 503 },
    );
  }
}

// DELETE /api/v1/public/newsletter — newsletter unsubscribe
// (ADV-29). Body: { email }. The admin subscribers route's header
// long referenced "the public unsubscribe flow" as the owner of
// status changes, but no such route existed — this is it.
//
// Non-enumerating: unknown and already-unsubscribed addresses get
// the SAME generic 200 as a real flip, so the endpoint cannot probe
// who is subscribed. Only a real subscribed → unsubscribed flip is
// written to the marketing consent log (privacy.consent_log).
export async function DELETE(req: Request) {
  const rawBody: unknown = await req.json().catch(() => null);
  const email =
    typeof rawBody === "object" && rawBody !== null && "email" in rawBody
      ? String((rawBody as { email: unknown }).email ?? "")
      : "";
  const parsed = newsletterSubscribeSchema.shape.email.safeParse(email);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "সঠিক ইমেইল ঠিকানা দিন।" } },
      { status: 400 },
    );
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]?.trim() || "unknown";
  const limit = newsletterRateLimiter.check(newsletterRateLimitKey(parsed.data, ip));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "অনেকবার চেষ্টা করা হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন।",
        },
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  try {
    const result = await unsubscribeNewsletter(parsed.data);
    if (!result.ok) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: result.error } },
        { status: 400 },
      );
    }
    if (result.changed) {
      await logConsent({
        action: "withdrawn",
        source: "newsletter-unsubscribe",
        email: parsed.data,
      });
    }
    return NextResponse.json({
      data: { unsubscribed: true },
      meta: { persistence: "database" },
    });
  } catch (e) {
    if (e instanceof NewsletterStoreUnavailableError) {
      return NextResponse.json(
        {
          error: {
            code: "NEWSLETTER_NOT_READY",
            message: "দুঃখিত — এই মুহূর্তে আনসাবস্ক্রাইব করা যাচ্ছে না, পরে আবার চেষ্টা করুন।",
          },
          meta: { persistence: "unavailable", reason: "model-pending" },
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "সার্ভারে সমস্যা হয়েছে — আবার চেষ্টা করুন।" } },
      { status: 503 },
    );
  }
}

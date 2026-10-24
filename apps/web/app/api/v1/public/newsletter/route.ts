import { NextResponse } from "next/server";
import { newsletterSubscribeSchema } from "@/newsletter/schema";
import {
  isNewsletterHoneypotTripped,
  newsletterRateLimiter,
  newsletterRateLimitKey,
  noteNewsletterHoneypotDrop,
} from "@/newsletter/policy";
import { newsletterStore } from "@/newsletter/store-db";
import { NewsletterStoreUnavailableError } from "@/newsletter/store";

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

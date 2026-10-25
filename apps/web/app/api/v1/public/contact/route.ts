/**
 * POST /api/v1/public/contact — contact form submission. Agent 47.
 *
 * Flow: honeypot pre-check (raw body) -> Zod validate -> rate limit
 * (3/hour per normalized phone + IP, in-memory) -> store in the
 * support inbox -> 201 { data: { id, status: "received" } }.
 *
 * HONESTY RULE: status "received" means the message was stored in the
 * support inbox — NO email or SMS is sent by this endpoint, and the
 * response never claims one was. Persistence is the ContactMessage
 * table via src/contact/store-db.ts (meta persistence: "database");
 * the stored record's lifecycle status starts at "NEW" — "received"
 * is the public acknowledgement of storage, not the stored value.
 * While the ContactMessage delegate is unavailable (model landing),
 * the endpoint answers an honest 503 and stores NOTHING — it never
 * falls back to an in-memory store.
 *
 * HONEYPOT: if the hidden field arrives filled, the endpoint returns
 * the same 201 shape with an unstored reference id, stores nothing,
 * and silently increments a drop counter. The field is never named in
 * any response.
 */
import { NextResponse } from "next/server";
import { contactSubmissionSchema } from "@/contact/schema";
import { contactRateLimiter, contactRateLimitKey, isHoneypotTripped } from "@/contact/policy";
import { noteHoneypotDrop, unstoredReferenceId } from "@/contact/store";
import {
  ContactStoreUnavailableError,
  createContactMessage,
  type ContactMessageRecord,
} from "@/contact/store-db";

export async function POST(req: Request) {
  const rawBody: unknown = await req.json().catch(() => null);

  // Honeypot first: a tripped bot gets a plausible success and leaves.
  if (isHoneypotTripped(rawBody)) {
    noteHoneypotDrop();
    return NextResponse.json(
      { data: { id: unstoredReferenceId(), status: "received" } },
      { status: 201 },
    );
  }

  const parsed = contactSubmissionSchema.safeParse(rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "তথ্য ঠিকমতো পূরণ করুন — যেসব ঘরে সমস্যা আছে তা চিহ্নিত করা হয়েছে।",
          details: parsed.error.issues,
        },
      },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // IP placeholder: first x-forwarded-for hop until trusted-proxy setup.
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]?.trim() || "unknown";
  const limit = contactRateLimiter.check(contactRateLimitKey(body.phone, ip));
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "এই নম্বর থেকে অনেকগুলো বার্তা পাঠানো হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন।",
        },
      },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let record: ContactMessageRecord;
  try {
    record = await createContactMessage({
      name: body.name,
      phone: body.phone,
      email: body.email,
      subject: body.subject,
      message: body.message,
    });
  } catch (e) {
    if (e instanceof ContactStoreUnavailableError) {
      return NextResponse.json(
        {
          error: {
            code: "CONTACT_NOT_READY",
            message: "দুঃখিত — এই মুহূর্তে বার্তা পাঠানো যাচ্ছে না, পরে আবার চেষ্টা করুন।",
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

  return NextResponse.json(
    {
      data: { id: record.id, status: "received" },
      meta: {
        persistence: "database",
        note: "Stored in the support inbox database. No email or SMS is sent by this endpoint.",
      },
    },
    { status: 201 },
  );
}

export function GET() {
  return NextResponse.json({ error: { code: "METHOD_NOT_ALLOWED", message: "POST only." } }, { status: 405 });
}

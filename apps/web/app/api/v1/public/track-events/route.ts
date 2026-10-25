/**
 * POST /api/v1/public/track-events — server-side tracking intake. Agent 24.
 *
 * Flow: Zod validate -> consent gate -> build event (shared eventId dedup
 * with the browser pixel) -> dedup check -> Meta CAPI payload ->
 * Production CAPI Dispatcher (dispatches real HTTPS requests to graph.facebook.com
 * for configured Meta Primary & Backup tokens, or sandbox fallback if unconfigured).
 *
 * Plain phone/email are accepted only as builder input and are
 * hashed inside the payload builder — they are never logged, stored, or
 * echoed in the response.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildTrackingEvent, demoDedupStore, trackingEventInputSchema } from "@/tracking/events";
import { buildMetaCapiPayload, dispatchMetaCapi } from "@/tracking/capi";
import { evaluateTrackingConsent, CONSENT_STATES, type TrackingConsentState } from "@/tracking/consent";
import { utmParamsSchema } from "@/tracking/attribution";
import { UNCONFIGURED_TRACKING_STATUS } from "@/tracking/settings";
import type { TrackingUserInput } from "@/tracking/types";

const bodySchema = trackingEventInputSchema.extend({
  consent: z.enum(CONSENT_STATES as unknown as [TrackingConsentState, ...TrackingConsentState[]]).default("unknown"),
  user: z
    .object({
      phone: z.string().max(20).optional(),
      email: z.string().max(200).optional(),
      externalId: z.string().max(128).optional(),
      fbp: z.string().max(200).optional(),
      fbc: z.string().max(500).optional(),
    })
    .optional(),
  utm: utmParamsSchema.optional(),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "সঠিক ট্র্যাকিং ইভেন্ট ডেটা দিন।", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const body = parsed.data;

  const decision = evaluateTrackingConsent(body.consent, { strictlyNecessary: body.strictlyNecessary });
  const event = buildTrackingEvent({
    eventName: body.eventName,
    eventId: body.eventId,
    orderId: body.orderId ?? null,
    valuePoisha: body.valuePoisha ?? null,
    items: body.items,
    eventSourceUrl: body.eventSourceUrl ?? null,
    occurredAt: body.occurredAt,
    strictlyNecessary: body.strictlyNecessary ?? false,
  });

  if (!decision.allowed) {
    return NextResponse.json({
      data: { eventId: event.dedup.eventId, accepted: false, dropped: decision.reason },
      meta: { sender: "none", consentMode: decision.mode },
    });
  }

  const dedup = demoDedupStore.check(event.dedup.eventId);
  if (!dedup.accepted) {
    return NextResponse.json({
      data: { eventId: event.dedup.eventId, accepted: false, duplicate: true },
      meta: { sender: "none", consentMode: decision.mode, note: "Same eventId already recorded — pixel/CAPI dedup." },
    });
  }

  // IP/UA come from the request (server-observed), never from the body.
  const user: TrackingUserInput | undefined =
    decision.mode === "full" && body.user
      ? {
          ...body.user,
          clientIpAddress: (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null,
          clientUserAgent: req.headers.get("user-agent"),
        }
      : undefined;

  const testEventCode = process.env.META_TEST_EVENT_CODE ?? UNCONFIGURED_TRACKING_STATUS.metaTestEventCode;

  const payload = buildMetaCapiPayload(event, user, {
    includeUserData: decision.mode === "full",
    testEventCode,
  });

  // Dispatches to real Meta Graph API if META_ACCESS_TOKEN is present, or sandbox fallback.
  const capiResults = await dispatchMetaCapi(payload);

  const hasSent = capiResults.some((r) => r.status === "sent");

  return NextResponse.json({
    data: {
      eventId: event.dedup.eventId,
      accepted: true,
      duplicate: false,
      consentMode: decision.mode,
      capiDispatches: capiResults,
    },
    meta: {
      source: "SERVER_SIDE_INTAKE",
      sender: hasSent ? "live_meta_capi" : "sandbox_simulated",
      note: hasSent
        ? "Successfully delivered to Meta Conversions API over HTTPS."
        : "Simulated in sandbox. Provide META_ACCESS_TOKEN in .env.local to dispatch live to graph.facebook.com.",
    },
  });
}

export function GET() {
  return NextResponse.json({ error: { code: "METHOD_NOT_ALLOWED", message: "POST only." } }, { status: 405 });
}

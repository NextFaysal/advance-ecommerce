/**
 * F-Commerce Public Webhook — /api/v1/public/inbox/webhook
 *
 * Receives real-time inbound chat messages from Meta (Facebook Messenger,
 * Instagram Direct, WhatsApp Cloud API).
 */
import { NextResponse } from "next/server";
import { verifyMetaWebhook, parseMetaWebhookEvent } from "@/inbox/channel-adapters";
import { loadMetaSecrets, verifyMetaSignature } from "@/inbox/meta-channels";
import { getSetting } from "@/lib/settings";
import { ingestInboundMessage } from "@/inbox/store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const { verified, challenge: resChallenge } = verifyMetaWebhook(mode, token, challenge);
  if (verified && resChallenge) {
    return new Response(resChallenge, { status: 200 });
  }

  return NextResponse.json({ error: "Forbidden — invalid verification token" }, { status: 403 });
}

export async function POST(req: Request) {
  // v2-merge hardening (PR #1): the branch version ingested any POSTed
  // payload unauthenticated — anyone could inject fake customer
  // messages into the inbox. Verify X-Hub-Signature-256 against the
  // configured Meta app secret first, exactly like the canonical
  // /api/v1/public/meta/webhook route; fail closed when Meta is not
  // configured (no secret -> no valid signature -> 401).
  const rawBody = await req.text();
  const { appSecret } = await loadMetaSecrets({ getSetting }).catch(() => ({ appSecret: "" }));
  if (!verifyMetaSignature(rawBody, req.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const events = parseMetaWebhookEvent(body);

  for (const ev of events) {
    try {
      if (ev.text) {
        await ingestInboundMessage({
          channel: ev.channel,
          externalThreadId: ev.externalThreadId,
          externalMessageId: ev.externalMessageId,
          customerDisplayName: ev.customerName || "Customer",
          kind: "TEXT",
          text: ev.text,
          direction: "INBOUND",
        });
      }
    } catch (e) {
      console.error("[F-Commerce Webhook] Error processing event:", e);
    }
  }

  return NextResponse.json({ success: true, processed: events.length });
}

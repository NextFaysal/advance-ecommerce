/**
 * F-Commerce Public Webhook — /api/v1/public/inbox/webhook
 *
 * Receives real-time inbound chat messages from Meta (Facebook Messenger,
 * Instagram Direct, WhatsApp Cloud API).
 */
import { NextResponse } from "next/server";
import { verifyMetaWebhook, parseMetaWebhookEvent } from "@/inbox/channel-adapters";
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
  let body: any;
  try {
    body = await req.json();
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

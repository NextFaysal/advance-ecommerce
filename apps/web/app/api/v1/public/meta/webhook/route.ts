// Meta webhook — ADV-6 part 1 (doc 22): the F-commerce RECEIVE side.
//
// GET  /api/v1/public/meta/webhook — Meta subscription handshake:
//      the hub.challenge is echoed ONLY when hub.mode=subscribe and
//      hub.verify_token matches Settings meta.webhook_verify_token.
// POST /api/v1/public/meta/webhook — Messenger / Instagram / WhatsApp
//      Cloud API event ingestion. X-Hub-Signature-256 (HMAC-SHA256 of
//      the RAW body, keyed with meta.app_secret from encrypted
//      Settings) is verified BEFORE anything is parsed or stored:
//      unverified -> 401, no state change. Verified events are
//      normalised by src/inbox/meta-channels.ts and ingested through
//      the inbox DB store, which dedupes replays on
//      (channel, externalMessageId).
//
// When Meta is not configured in Settings at all, both verbs answer
// 404 — the endpoint is effectively closed and never fake-accepts.
// Secrets are read server-side only and never logged or returned.
import { NextResponse } from "next/server";
import { getSetting } from "@/lib/settings";
import { ingestInboundMessage } from "@/inbox/store";
import {
  handleMetaWebhookGet,
  handleMetaWebhookPost,
  type MetaWebhookDeps,
  type MetaWebhookResult,
} from "@/inbox/meta-channels";

export const dynamic = "force-dynamic";

const deps: MetaWebhookDeps = {
  reader: { getSetting },
  ingest: async (input) => {
    const result = await ingestInboundMessage(input);
    // ADV-6 bot v1 trigger (parent wiring, wave 38): after a NEW
    // inbound message lands, let the bot analyse the conversation.
    // maybeCreateBotDraft self-gates on module.f_commerce +
    // f_commerce.bot_enabled and never throws into the webhook.
    if (!result.duplicate) {
      void import("@/inbox/bot")
        .then((m) => m.maybeCreateBotDraft(result.conversation.id))
        .catch(() => {});
    }
    return result;
  },
};

function respond(result: MetaWebhookResult): NextResponse {
  if (result.text !== undefined) {
    return new NextResponse(result.text, {
      status: result.status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.json(result.json ?? {}, { status: result.status });
}

export async function GET(req: Request) {
  return respond(await handleMetaWebhookGet(new URL(req.url), deps));
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  return respond(await handleMetaWebhookPost(rawBody, signature, deps));
}

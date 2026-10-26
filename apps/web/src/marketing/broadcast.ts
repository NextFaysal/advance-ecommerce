/**
 * WhatsApp broadcast — ADV-18B (doc 22).
 *
 * Consent reality (verified on disk): there is NO marketing-consent
 * field on Customer and no phone on NewsletterSubscriber. The only
 * recorded marketing opt-in in this codebase is a newsletter
 * subscription (status "subscribed"). The broadcast audience is
 * therefore EXACTLY: newsletter subscribers whose email matches a
 * customer record that has a phone, is not blocked and not deleted.
 * The admin UI states this definition verbatim — nobody outside it
 * is ever messaged, and the matched count is shown before sending.
 *
 * Sending rides the ADV-6 Meta adapter (src/inbox/send.ts):
 * - Channel not configured (no Meta app / WhatsApp token / phone
 *   number id in Settings) -> the campaign is saved with status
 *   NOT_SENT and a reason naming the missing Settings keys. It is
 *   NEVER marked sent.
 * - Configured -> a capped SYNCHRONOUS batch (BROADCAST_BATCH_CAP)
 *   is attempted now; there is no broadcast queue producer in this
 *   codebase (queues are consumer-only for outbound messaging), so
 *   the cap is stated in the UI and any remainder stays unsent and
 *   is reported on the campaign record. Per-recipient results are
 *   recorded ONLY for sends actually attempted.
 * - Meta caveat (also shown in the UI): free-form text outside a
 *   customer's 24-hour window is rejected by Meta — production
 *   broadcasts should use approved templates; per-recipient Meta
 *   errors are recorded here verbatim when they happen.
 *
 * Campaign records live in the Setting doc `marketing.broadcasts`.
 */
import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  readMarketingDoc,
  writeMarketingDoc,
  prismaMarketingDocStore,
  type MarketingDocStore,
} from "./docs";
import { maskPhone, normalizeBdPhone } from "@/checkout/validation";

export const BROADCASTS_KEY = "marketing.broadcasts";
export const BROADCAST_BATCH_CAP = 50;

export const broadcastRecipientResultSchema = z.object({
  phoneMasked: z.string(),
  status: z.enum(["sent", "failed"]),
  platformMessageId: z.string().optional(),
  error: z.string().optional(),
});

export const broadcastCampaignSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(120),
  message: z.string().min(1).max(2000),
  status: z.enum(["DRAFT", "NOT_SENT", "SENT", "PARTIALLY_SENT", "FAILED"]),
  notSentReason: z.string().optional(),
  note: z.string().optional(),
  audienceCount: z.number().int().nonnegative(),
  attemptedCount: z.number().int().nonnegative().default(0),
  results: z.array(broadcastRecipientResultSchema).default([]),
  createdAt: z.string(),
  createdById: z.string(),
  sentAt: z.string().optional(),
});

export const broadcastsDocSchema = z.object({
  version: z.literal(1),
  campaigns: z.array(broadcastCampaignSchema).max(100),
});

export type BroadcastCampaign = z.infer<typeof broadcastCampaignSchema>;
export type BroadcastsDoc = z.infer<typeof broadcastsDocSchema>;

export const EMPTY_BROADCASTS_DOC: BroadcastsDoc = { version: 1, campaigns: [] };

export async function loadBroadcastsDoc(
  store: MarketingDocStore = prismaMarketingDocStore(),
): Promise<BroadcastsDoc> {
  return readMarketingDoc(store, BROADCASTS_KEY, broadcastsDocSchema, EMPTY_BROADCASTS_DOC);
}

async function saveBroadcastsDoc(store: MarketingDocStore, doc: BroadcastsDoc, actorId: string): Promise<void> {
  await writeMarketingDoc(store, BROADCASTS_KEY, doc, actorId);
}

/* ------------------------------------------------------------------ */
/* Audience                                                            */
/* ------------------------------------------------------------------ */

export interface BroadcastRecipient {
  customerId: string;
  /** Normalised +8801XXXXXXXXX. */
  phone: string;
  /** WhatsApp wa_id (digits only). */
  waId: string;
}

/** The consent-defined audience (see header). Pure DB reads. */
export async function computeBroadcastAudience(): Promise<BroadcastRecipient[]> {
  const { prisma } = await import("@advance-ecommerce/db");
  const subscribers = await prisma.newsletterSubscriber.findMany({
    where: { status: "subscribed" },
    select: { email: true },
  });
  if (subscribers.length === 0) return [];
  const subscribedEmails = new Set(subscribers.map((s) => s.email.toLowerCase()));
  const customers = await prisma.customer.findMany({
    where: { email: { not: null }, blocked: false, deletedAt: null },
    select: { id: true, phone: true, email: true },
  });
  const recipients: BroadcastRecipient[] = [];
  const seenPhones = new Set<string>();
  for (const customer of customers) {
    if (customer.email === null || !subscribedEmails.has(customer.email.toLowerCase())) continue;
    const phone = normalizeBdPhone(customer.phone);
    if (phone === null || seenPhones.has(phone)) continue;
    seenPhones.add(phone);
    recipients.push({ customerId: customer.id, phone, waId: phone.replace(/\D/g, "") });
  }
  return recipients;
}

/* ------------------------------------------------------------------ */
/* Campaign lifecycle                                                  */
/* ------------------------------------------------------------------ */

export async function createCampaign(
  store: MarketingDocStore,
  input: { title: string; message: string },
  actorId: string,
  now: Date = new Date(),
): Promise<BroadcastCampaign> {
  const audience = await computeBroadcastAudience();
  const campaign: BroadcastCampaign = {
    id: randomUUID(),
    title: input.title,
    message: input.message,
    status: "DRAFT",
    audienceCount: audience.length,
    attemptedCount: 0,
    results: [],
    createdAt: now.toISOString(),
    createdById: actorId,
  };
  const doc = await loadBroadcastsDoc(store);
  await saveBroadcastsDoc(store, { version: 1, campaigns: [campaign, ...doc.campaigns].slice(0, 100) }, actorId);
  return campaign;
}

export interface BroadcastChannelStatus {
  configured: boolean;
  /** Missing Settings keys (names only), e.g. meta.whatsapp_access_token. */
  missingSettings: string[];
}

export async function getBroadcastChannelStatus(): Promise<BroadcastChannelStatus> {
  const { resolveMetaChannel } = await import("@/inbox/send");
  const resolved = await resolveMetaChannel("WHATSAPP");
  return {
    configured: resolved.configured,
    // missingFields already carry full Setting key names
    // (e.g. "meta.whatsapp_access_token").
    missingSettings: [...resolved.missingFields],
  };
}

export type SendCampaignResult =
  | { ok: true; campaign: BroadcastCampaign }
  | { ok: false; code: "NOT_FOUND" | "ALREADY_SENT"; message: string };

export async function sendCampaign(
  store: MarketingDocStore,
  campaignId: string,
  actorId: string,
  now: Date = new Date(),
): Promise<SendCampaignResult> {
  const doc = await loadBroadcastsDoc(store);
  const campaign = doc.campaigns.find((c) => c.id === campaignId);
  if (campaign === undefined) return { ok: false, code: "NOT_FOUND", message: "ক্যাম্পেইন পাওয়া যায়নি।" };
  if (campaign.status === "SENT" || campaign.status === "PARTIALLY_SENT") {
    return { ok: false, code: "ALREADY_SENT", message: "এই ক্যাম্পেইন ইতিমধ্যে পাঠানো হয়েছে — পুনরায় পাঠানো যাবে না।" };
  }

  const { resolveMetaChannel, sendMetaTextMessage } = await import("@/inbox/send");
  const resolved = await resolveMetaChannel("WHATSAPP");

  const persist = async (updated: BroadcastCampaign): Promise<BroadcastCampaign> => {
    const fresh = await loadBroadcastsDoc(store);
    await saveBroadcastsDoc(
      store,
      { version: 1, campaigns: fresh.campaigns.map((c) => (c.id === updated.id ? updated : c)) },
      actorId,
    );
    return updated;
  };

  if (!resolved.configured) {
    // Honest NOT_SENT: nothing was attempted, nothing is claimed.
    const updated: BroadcastCampaign = {
      ...campaign,
      status: "NOT_SENT",
      notSentReason: `WhatsApp চ্যানেল কনফিগার করা নেই — Settings-এ এই কীগুলো দিন: ${resolved.missingFields.join(", ")}`,
      attemptedCount: 0,
      results: [],
      sentAt: undefined,
    };
    return { ok: true, campaign: await persist(updated) };
  }

  const audience = await computeBroadcastAudience();
  const batch = audience.slice(0, BROADCAST_BATCH_CAP);
  const results: BroadcastCampaign["results"] = [];
  let sentCount = 0;
  for (const recipient of batch) {
    try {
      const sent = await sendMetaTextMessage({
        resolved,
        recipientId: recipient.waId,
        text: campaign.message,
      });
      results.push({ phoneMasked: maskPhone(recipient.phone), status: "sent", platformMessageId: sent.platformMessageId });
      sentCount += 1;
    } catch (error) {
      results.push({
        phoneMasked: maskPhone(recipient.phone),
        status: "failed",
        error: error instanceof Error ? error.message : "send failed",
      });
    }
  }
  const remainder = audience.length - batch.length;
  const updated: BroadcastCampaign = {
    ...campaign,
    status: sentCount === batch.length && batch.length > 0 ? "SENT" : sentCount > 0 ? "PARTIALLY_SENT" : "FAILED",
    notSentReason: undefined,
    note:
      remainder > 0
        ? `ব্যাচ সীমা ${BROADCAST_BATCH_CAP}: প্রথম ${batch.length} জনকে চেষ্টা করা হয়েছে; বাকি ${remainder} জন এই রানে পাঠানো হয়নি।`
        : batch.length === 0
          ? "অডিয়েন্সে কেউ নেই — কাউকে পাঠানো হয়নি।"
          : undefined,
    audienceCount: audience.length,
    attemptedCount: batch.length,
    results,
    sentAt: now.toISOString(),
  };
  if (batch.length === 0) {
    updated.status = "NOT_SENT";
    updated.notSentReason = "অডিয়েন্সে পাঠানোর মতো কেউ নেই (সাবস্ক্রাইব করা ও ফোন-সহ কাস্টমার শূন্য)।";
  }
  return { ok: true, campaign: await persist(updated) };
}

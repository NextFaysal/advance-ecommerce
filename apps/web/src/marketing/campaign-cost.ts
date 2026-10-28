// Campaign cost estimate — pure helpers, SCHEMA-FREE (perf wave, zod diet).
//
// These functions used to live in ./service next to the zod schemas
// (createCampaignSchema & friends). The admin campaign UI (client
// components) imports estimateCampaignCost for live cost feedback,
// which dragged ./service — and the zod runtime with it — into the
// browser bundle. They now live here with zero schema imports;
// ./service re-exports them so server callers are unchanged, and the
// zod gate in ./service stays exactly as strict as before.
//
// CampaignCostInput mirrors the OUTPUT shape of createCampaignSchema
// (z.infer) field-for-field; the estimator only reads channel,
// messageText, recipientCount and pricePerSegmentPoisha.

export interface CampaignCostInput {
  channel: "sms" | "email";
  segmentRef: string;
  templateKey: string;
  messageText: string;
  recipientCount: number;
  pricePerSegmentPoisha: number;
  scheduledAt: string | null;
}

// Bangla Unicode segment note: GSM-7: 160 chars / 153 concatenated.
// Unicode (Bangla, emoji): 70 / 67. Segments are computed from the
// RENDERED message, never a fixed price.
export function isUnicodeMessage(text: string): boolean {
  // Bangla block U+0980-U+09FF, or any non-ASCII char, forces Unicode encoding.
  return /[^\x00-\x7F]/.test(text);
}

export function smsSegments(text: string): number {
  if (text.length === 0) return 0;
  const unicode = isUnicodeMessage(text);
  const single = unicode ? 70 : 160;
  const concat = unicode ? 67 : 153;
  return text.length <= single ? 1 : Math.ceil(text.length / concat);
}

export function estimateCampaignCost(input: CampaignCostInput): { segmentsPerMessage: number; costEstimatePoisha: number; isUnicode: boolean } {
  if (input.channel === "email") return { segmentsPerMessage: 0, costEstimatePoisha: 0, isUnicode: isUnicodeMessage(input.messageText) };
  const segmentsPerMessage = smsSegments(input.messageText);
  return { segmentsPerMessage, costEstimatePoisha: segmentsPerMessage * input.recipientCount * input.pricePerSegmentPoisha, isUnicode: isUnicodeMessage(input.messageText) };
}

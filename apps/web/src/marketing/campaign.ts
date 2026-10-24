// SMS/email campaign outline — Agent 5, Step 26 (types only, no sends here).
// Cost estimate is in poisha and is an estimate: Bangla Unicode messages use more
// segments than Latin messages, so the Step 26 service must compute segments from
// the rendered message, not from a fixed per-message price.

export type CampaignChannel = "sms" | "email";

export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled";

export interface Campaign {
  id: string;
  channel: CampaignChannel;
  segmentRef: string;
  templateKey: string;
  scheduledAt: string | null;
  /** Recipient count at schedule time; delivery counts are filled by the Step 26 service. */
  recipientCount: number;
  sentCount: number;
  deliveredCount: number;
  failedCount: number;
  /** Integer poisha estimate, nullable until segments are computed. */
  costEstimatePoisha: number | null;
  status: CampaignStatus;
}

/** Abandoned-checkout recovery and back-in-stock alerts reuse the campaign + notification log types. */
export interface AbandonedCheckoutFollowUp {
  checkoutId: string;
  customerPhone: string;
  channel: CampaignChannel;
  attempt: number;
  status: "pending" | "sent" | "recovered" | "expired";
}

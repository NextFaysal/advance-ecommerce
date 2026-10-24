// SmsProvider adapter interface — Agent 5, Step 26 (base only).
// No real SMS API calls here. Providers are admin-selectable; the active provider
// and fallback provider are set in Admin > Settings > Notifications.
import type { ProviderConfig } from "./types";

export type SmsProviderName = "bulksmsbd" | "sslwireless" | "greenweb";

export const SMS_PROVIDERS: readonly SmsProviderName[] = ["bulksmsbd", "sslwireless", "greenweb"];

export interface SmsSendInput {
  toPhone: string;
  /** Final rendered message. Bangla Unicode length rules apply at send time (Step 26). */
  message: string;
  /** For cost reporting and template tracking. */
  templateKey: string | null;
  orderId: string | null;
}

export interface SmsSendResult {
  messageId: string;
  status: "queued" | "sent" | "failed";
  /** Segments used, for cost estimation. Cost itself is reported by the provider, never guessed here. */
  segments: number;
}

export interface SmsProvider {
  readonly name: SmsProviderName;
  readonly config: ProviderConfig;
  send(input: SmsSendInput): Promise<SmsSendResult>;
}

/** Admin SMS settings: active provider, fallback provider, sender ID, cost guard. */
export interface SmsSettings {
  activeProvider: SmsProviderName;
  fallbackProvider: SmsProviderName | null;
  senderId: string | null;
  enabled: boolean;
  /** Daily spend guard in poisha; 0 = no guard. Exceeding it queues (never sends) until reviewed. */
  dailyBudgetPoisha: number;
}

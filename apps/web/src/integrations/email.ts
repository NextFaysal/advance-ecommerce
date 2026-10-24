// EmailProvider adapter interface — Agent 5, Step 26/31 (base only).
// No real email API calls here. Resend + SMTP are both supported; admin picks one
// in Admin > Settings > Notifications. Templates use variables, never inline secrets.
import type { ProviderConfig } from "./types";

export type EmailProviderName = "resend" | "smtp";

export const EMAIL_PROVIDERS: readonly EmailProviderName[] = ["resend", "smtp"];

export interface EmailSendInput {
  to: string;
  subject: string;
  /** Rendered HTML/text body. Template variables: {customer_name}, {order_no}, {tracking_url}. */
  body: string;
  templateKey: string | null;
  orderId: string | null;
}

export interface EmailSendResult {
  messageId: string;
  status: "queued" | "sent" | "failed";
}

export interface EmailProvider {
  readonly name: EmailProviderName;
  readonly config: ProviderConfig;
  send(input: EmailSendInput): Promise<EmailSendResult>;
}

export interface EmailSettings {
  activeProvider: EmailProviderName;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
}

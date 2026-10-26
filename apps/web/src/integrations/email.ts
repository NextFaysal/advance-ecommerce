// EmailProvider adapter interface — Agent 5, Step 26/31 (base only).
// No real email API calls here. Resend + SMTP are both supported; admin picks one
// in Admin > Settings > Notifications. Templates use variables, never inline secrets.
import type { ProviderConfig } from "./types";

export type EmailProviderName = "resend" | "smtp";

export const EMAIL_PROVIDERS: readonly EmailProviderName[] = ["resend", "smtp"];

export interface EmailSendInput {
  to: string;
  subject: string;
  /** Rendered plain-text body. Template variables: {customer_name}, {order_no}, {tracking_url}. */
  body: string;
  /** Optional rendered HTML body (ADV-3 templates produce both). */
  html?: string;
  /** Optional file attachments (base64 content) — the path ADV-29's
   *  PDF invoices will ride on; no caller attaches anything yet. */
  attachments?: { filename: string; contentBase64: string }[];
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

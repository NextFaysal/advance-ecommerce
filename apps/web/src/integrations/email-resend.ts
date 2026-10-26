/**
 * Resend email adapter — ADV-3 (doc 22).
 *
 * A REAL adapter behind the EmailProvider interface
 * (src/integrations/email.ts): it POSTs to the Resend HTTP API with
 * the global fetch — deliberately no SDK / npm dependency. The API
 * key is handed in by the caller (src/email/config.ts resolves it
 * from the encrypted Admin Settings store); the key lives only in
 * this closure, is never logged, and never appears in an error.
 *
 * Failure honesty: a non-2xx response THROWS (RESEND_SEND_FAILED with
 * the HTTP status only — the response body is never read into the
 * error because it can echo recipient data). Callers let BullMQ retry
 * per the email queue policy; nothing here reports a send that did
 * not happen.
 */
import type { EmailProvider, EmailSendInput, EmailSendResult } from "./email";
import type { ProviderConfig } from "./types";

export interface ResendEmailProviderOptions {
  apiKey: string;
  fromEmail: string;
  /** Sender display name; "" sends the bare address. */
  fromName: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** API base override (tests); default https://api.resend.com. */
  baseUrl?: string;
}

export const RESEND_API_BASE = "https://api.resend.com";

/** "Name <addr>" when a name exists, the bare address otherwise. */
export function formatFromAddress(fromName: string, fromEmail: string): string {
  const name = fromName.trim();
  return name === "" ? fromEmail : `${name} <${fromEmail}>`;
}

/** The exact JSON body posted to Resend — exported for the smoke. */
export function buildResendPayload(
  options: Pick<ResendEmailProviderOptions, "fromEmail" | "fromName">,
  input: EmailSendInput,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    from: formatFromAddress(options.fromName, options.fromEmail),
    to: [input.to],
    subject: input.subject,
    text: input.body,
  };
  if (input.html !== undefined && input.html !== "") payload.html = input.html;
  if (input.attachments !== undefined && input.attachments.length > 0) {
    payload.attachments = input.attachments.map((a) => ({
      filename: a.filename,
      content: a.contentBase64,
    }));
  }
  return payload;
}

export function createResendEmailProvider(
  options: ResendEmailProviderOptions,
): EmailProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? RESEND_API_BASE;
  const config: ProviderConfig = {
    provider: "resend",
    enabled: true,
    mode: "live",
    status: "configured",
    // Reference only — the value itself is never carried here.
    credentialRef: "settings:email.resend.api_key",
    lastTestedAt: null,
    lastError: null,
  };
  return {
    name: "resend",
    config,
    async send(input: EmailSendInput): Promise<EmailSendResult> {
      const response = await fetchImpl(`${baseUrl}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildResendPayload(options, input)),
      });
      if (!response.ok) {
        throw new Error(`RESEND_SEND_FAILED:http-${response.status}`);
      }
      const data = (await response.json().catch(() => null)) as
        | { id?: unknown }
        | null;
      const messageId =
        typeof data?.id === "string" && data.id !== "" ? data.id : "resend-no-id";
      return { messageId, status: "sent" };
    },
  };
}

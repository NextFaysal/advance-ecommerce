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
 * the HTTP status plus the error name/message Resend itself returns —
 * read tolerantly from the documented error body; the adapter never
 * adds the API key or the recipient to an error). Callers let BullMQ
 * retry per the email queue policy; nothing here reports a send that
 * did not happen: a 2xx whose body lacks the documented string `id`
 * is off-doc and throws RESEND_UNRECOGNIZED_RESPONSE instead of
 * inventing a message id.
 *
 * Doc verification (2026-10-30, resend.com/docs): endpoint, Bearer
 * auth, payload fields (from/to/subject/text/html) and the attachment
 * mapping (filename + base64 content) match the docs. Also per docs:
 * an explicit User-Agent header is REQUIRED on every request (403
 * without one); the `Idempotency-Key` header (1–256 chars, retained
 * 24h, same key+payload returns the original result) makes queue
 * retries safe; send `tags` are accepted as metadata.
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
  // Documented send `tags` — correlation metadata only, so a send can
  // be found in Resend's logs by our internal ids. templateKey is the
  // platform's INTERNAL template id (templates render locally in
  // src/email; it is NOT a Resend template id and Resend never
  // renders from it). Resend tag values must be charset-safe
  // ([A-Za-z0-9_-], ≤256 chars); unsafe values are skipped silently.
  const tags: { name: string; value: string }[] = [];
  if (input.templateKey !== null && RESEND_TAG_VALUE.test(input.templateKey)) {
    tags.push({ name: "template_key", value: input.templateKey });
  }
  if (input.orderId !== null && RESEND_TAG_VALUE.test(input.orderId)) {
    tags.push({ name: "order_id", value: input.orderId });
  }
  if (tags.length > 0) payload.tags = tags;
  return payload;
}

/** Resend tag-value charset per the docs: [A-Za-z0-9_-], ≤256 chars. */
const RESEND_TAG_VALUE = /^[A-Za-z0-9_-]{1,256}$/;

/**
 * Build the thrown error for a non-2xx Resend response. The
 * documented error shape is { name, message, statusCode } (some
 * errors nest name/message one level down) — read tolerantly and
 * surface ONLY name + message, the message truncated to 200 chars,
 * so a permanent 422 validation error is distinguishable from a
 * retryable 429. The API key is never included.
 */
export async function resendSendFailedError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as unknown;
  const name = pickResendErrorField(body, "name") || "unknown_error";
  const message = pickResendErrorField(body, "message").slice(0, 200);
  return new Error(`RESEND_SEND_FAILED:http-${response.status}:${name}:${message}`);
}

function pickResendErrorField(body: unknown, field: "name" | "message"): string {
  if (typeof body !== "object" || body === null) return "";
  const record = body as Record<string, unknown>;
  const direct = record[field];
  if (typeof direct === "string") return direct;
  const nested = record.error;
  if (typeof nested === "object" && nested !== null) {
    const inner = (nested as Record<string, unknown>)[field];
    if (typeof inner === "string") return inner;
  }
  return "";
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
      const headers: Record<string, string> = {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        // Resend's docs require a User-Agent on every API request
        // (403 without one) — set it explicitly instead of relying
        // on whatever the fetch runtime sends by default.
        "User-Agent": "advance-ecommerce/1.0",
      };
      // Documented idempotency: the same key + payload within 24h
      // returns the original result instead of sending twice, which
      // is what makes a BullMQ retry after an ambiguous failure
      // safe. Off-spec keys (outside 1–256 chars) are ignored.
      if (
        input.idempotencyKey !== undefined &&
        input.idempotencyKey.length >= 1 &&
        input.idempotencyKey.length <= 256
      ) {
        headers["Idempotency-Key"] = input.idempotencyKey;
      }
      const response = await fetchImpl(`${baseUrl}/emails`, {
        method: "POST",
        headers,
        body: JSON.stringify(buildResendPayload(options, input)),
      });
      if (!response.ok) {
        throw await resendSendFailedError(response);
      }
      const data = (await response.json().catch(() => null)) as
        | { id?: unknown }
        | null;
      if (typeof data?.id !== "string" || data.id === "") {
        // Off-doc shape: a 2xx without the documented string `id`
        // cannot be reported as a verified send — throw so the
        // queue retries (safe under the idempotency key above)
        // instead of recording a fabricated message id.
        throw new Error("RESEND_UNRECOGNIZED_RESPONSE");
      }
      return { messageId: data.id, status: "sent" };
    },
  };
}

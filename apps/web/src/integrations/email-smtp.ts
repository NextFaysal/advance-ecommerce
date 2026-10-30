/**
 * SMTP email adapter — notifications wave (doc: courier-wave follow-up).
 *
 * A REAL adapter behind the EmailProvider interface
 * (src/integrations/email.ts), built on nodemailer — Node core has
 * no SMTP client, so a dependency is unavoidable for this transport.
 * The credentials are handed in by the caller (src/email/config.ts
 * resolves them from the encrypted Admin Settings store); they live
 * only in this closure / the transporter, are never logged, and
 * never appear in an error.
 *
 * TLS posture: implicit TLS when `secure` (port 465 convention);
 * otherwise STARTTLS is REQUIRED (requireTLS) — the connection never
 * silently falls back to plaintext on a submission port. Certificate
 * verification stays on unless the merchant explicitly set
 * email.smtp.tls_reject_unauthorized to "false" in Settings.
 *
 * Failure honesty: a send/verify failure THROWS with the nodemailer
 * error CODE only (SMTP_SEND_FAILED:<code> / SMTP_VERIFY_FAILED:<code>)
 * — the raw server response is never read into the error because it
 * can echo credentials or recipient data. Callers let BullMQ retry
 * per the email queue policy; nothing here reports a send that did
 * not happen.
 */
import { createTransport, type Transporter } from "nodemailer";
import type { EmailProvider, EmailSendInput, EmailSendResult } from "./email";
import type { ProviderConfig } from "./types";
import { formatFromAddress } from "./email-resend";

/** Connection + auth fields — everything verifySmtpConnection needs. */
export interface SmtpConnectionOptions {
  host: string;
  port: number;
  /** true = implicit TLS (465); false = STARTTLS (587/25), pinned on. */
  secure: boolean;
  user: string;
  password: string;
  /** false only when the merchant disabled cert verification. */
  tlsRejectUnauthorized: boolean;
}

export interface SmtpEmailProviderOptions extends SmtpConnectionOptions {
  fromEmail: string;
  /** Sender display name; "" sends the bare address. */
  fromName: string;
}

function buildTransport(options: SmtpConnectionOptions): Transporter {
  return createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    auth: { user: options.user, pass: options.password },
    // Pin the STARTTLS upgrade on non-implicit ports: nodemailer must
    // refuse the connection rather than send credentials in plaintext
    // if the server does not offer STARTTLS.
    requireTLS: !options.secure,
    tls: { rejectUnauthorized: options.tlsRejectUnauthorized },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

/** The nodemailer error code (EAUTH, ECONNECTION, ETIMEDOUT, …) and
 *  nothing else — error.message can carry the server's raw response. */
function smtpErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code !== "") return code;
  }
  return "unknown";
}

export function createSmtpEmailProvider(
  options: SmtpEmailProviderOptions,
): EmailProvider {
  const config: ProviderConfig = {
    provider: "smtp",
    enabled: true,
    mode: "live",
    status: "configured",
    // Reference only — the value itself is never carried here.
    credentialRef: "settings:email.smtp.password",
    lastTestedAt: null,
    lastError: null,
  };
  return {
    name: "smtp",
    config,
    async send(input: EmailSendInput): Promise<EmailSendResult> {
      const transporter = buildTransport(options);
      try {
        const info = await transporter.sendMail({
          from: formatFromAddress(options.fromName, options.fromEmail),
          to: input.to,
          subject: input.subject,
          text: input.body,
          ...(input.html !== undefined && input.html !== ""
            ? { html: input.html }
            : {}),
          ...(input.attachments !== undefined && input.attachments.length > 0
            ? {
                attachments: input.attachments.map((a) => ({
                  filename: a.filename,
                  content: Buffer.from(a.contentBase64, "base64"),
                })),
              }
            : {}),
        });
        return { messageId: info.messageId, status: "sent" };
      } catch (error) {
        throw new Error(`SMTP_SEND_FAILED:${smtpErrorCode(error)}`);
      } finally {
        transporter.close();
      }
    },
  };
}

/**
 * Settings probe: connects, greets and authenticates against the
 * SAVED SMTP settings — sends NOTHING. Resolves on success; throws
 * SMTP_VERIFY_FAILED:<nodemailer code> on failure.
 */
export async function verifySmtpConnection(
  options: SmtpConnectionOptions,
): Promise<void> {
  const transporter = buildTransport(options);
  try {
    await transporter.verify();
  } catch (error) {
    throw new Error(`SMTP_VERIFY_FAILED:${smtpErrorCode(error)}`);
  } finally {
    transporter.close();
  }
}

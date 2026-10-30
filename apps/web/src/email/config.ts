/**
 * Email transport configuration — ADV-3 (doc 22).
 *
 * Resolves the REAL email transport from Admin Settings, following
 * the platform resolution order (DB Settings row → env → default):
 *
 *   email.provider          which transport ("resend"; default, or "smtp")
 *   email.resend.api_key    encrypted credential (env RESEND_API_KEY
 *                           is the fallback, never the override)
 *   email.resend.enabled    "false" disables the transport outright
 *   email.smtp.host         SMTP server host (required for smtp)
 *   email.smtp.port         default 587
 *   email.smtp.secure       "true"/"false"; blank → port === 465
 *   email.smtp.user         SMTP auth user (required for smtp)
 *   email.smtp.password     encrypted credential (required for smtp)
 *   email.smtp.enabled      "false" disables the transport outright
 *   email.smtp.tls_reject_unauthorized
 *                           "false" disables TLS certificate checks
 *                           (default "true" — verification stays on)
 *   email.from_address      sender address (env EMAIL_FROM_ADDRESS)
 *   email.from_name         sender display name; falls back to
 *                           general.store_name, then the bare address
 *
 * HONESTY: anything missing yields { configured: false, reason } —
 * the send path turns that into a SKIPPED job, never a fake send.
 * SMTP is implemented via nodemailer (src/integrations/email-smtp.ts)
 * — Node core has no SMTP client, so a dependency is unavoidable for
 * that transport; Resend stays dependency-free global fetch.
 * getEmailTransportStatus() exposes booleans only — a credential
 * value never leaves this module.
 */
import {
  getIntegrationConfigWithSecrets,
  getSetting,
} from "../lib/settings";
import { createResendEmailProvider } from "../integrations/email-resend";
import {
  createSmtpEmailProvider,
  type SmtpConnectionOptions,
} from "../integrations/email-smtp";
import type { EmailProvider } from "../integrations/email";

/** Settings access seam — injectable so the smoke can resolve config
 *  without a database. The default reader is the real Settings store. */
export interface EmailSettingsReader {
  getSetting(key: string): Promise<string | null>;
  getProviderSecrets(provider: string): Promise<Record<string, string>>;
}

const defaultReader: EmailSettingsReader = {
  getSetting: (key) => getSetting(key),
  getProviderSecrets: (provider) =>
    getIntegrationConfigWithSecrets("email", provider),
};

interface ResolvedEmailConfig {
  providerName: string;
  /** Non-null when the selected provider can never be configured. */
  unsupportedReason: string | null;
  enabled: boolean;
  /** Resend credential; "" for other providers. */
  apiKey: string;
  /** SMTP connection fields; defaults for other providers. */
  smtp: SmtpConnectionOptions;
  fromEmail: string;
  fromName: string;
}

async function resolveEmailConfig(
  reader: EmailSettingsReader,
): Promise<ResolvedEmailConfig> {
  const providerName =
    ((await reader.getSetting("email.provider")) ?? "").trim() || "resend";
  // The sender identity is provider-independent, so it is resolved
  // ONCE here — above the provider branch — and every transport (and
  // the status probe) reports the same from address.
  const fromEmail =
    ((await reader.getSetting("email.from_address")) ?? "").trim() ||
    (process.env.EMAIL_FROM_ADDRESS ?? "").trim();
  const fromNameSetting = ((await reader.getSetting("email.from_name")) ?? "").trim();
  const storeName = ((await reader.getSetting("general.store_name")) ?? "").trim();
  const base: ResolvedEmailConfig = {
    providerName,
    unsupportedReason: null,
    enabled: true,
    apiKey: "",
    smtp: {
      host: "",
      port: 587,
      secure: false,
      user: "",
      password: "",
      tlsRejectUnauthorized: true,
    },
    fromEmail,
    fromName: fromNameSetting || storeName,
  };
  if (providerName === "smtp") {
    const secrets = await reader.getProviderSecrets("smtp");
    const portRaw = Number.parseInt((secrets["port"] ?? "").trim(), 10);
    const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 587;
    const secureRaw = (secrets["secure"] ?? "").trim().toLowerCase();
    return {
      ...base,
      enabled: secrets["enabled"] !== "false",
      smtp: {
        host: (secrets["host"] ?? "").trim(),
        port,
        // Blank means "follow the port": 465 is the implicit-TLS port.
        secure: secureRaw === "" ? port === 465 : secureRaw === "true",
        user: (secrets["user"] ?? "").trim(),
        // Never trimmed — whitespace can be part of a password.
        password: secrets["password"] ?? "",
        tlsRejectUnauthorized:
          (secrets["tls_reject_unauthorized"] ?? "").trim() !== "false",
      },
    };
  }
  if (providerName !== "resend") {
    return { ...base, unsupportedReason: `unknown email provider "${providerName}"` };
  }
  const secrets = await reader.getProviderSecrets("resend");
  const apiKey =
    (secrets["api_key"] ?? "").trim() || (process.env.RESEND_API_KEY ?? "").trim();
  return {
    ...base,
    enabled: secrets["enabled"] !== "false",
    apiKey,
  };
}

/** The first reason the resolved transport cannot send, in the
 *  platform's naming style; null when it is fully configured. Shared
 *  by loadEmailTransport and getEmailTransportStatus so the two can
 *  never disagree about why a transport is down. */
function firstBlockedReason(resolved: ResolvedEmailConfig): string | null {
  if (resolved.unsupportedReason !== null) return resolved.unsupportedReason;
  if (!resolved.enabled) return `email.${resolved.providerName}.enabled is false`;
  if (resolved.providerName === "smtp") {
    if (resolved.smtp.host === "") return "email.smtp.host is not set";
    if (resolved.smtp.user === "") return "email.smtp.user is not set";
    if (resolved.smtp.password === "") return "email.smtp.password is not set";
  } else if (resolved.apiKey === "") {
    return "email.resend.api_key is not set";
  }
  if (resolved.fromEmail === "") return "email.from_address is not set";
  return null;
}

export type EmailTransportLoad =
  | {
      configured: true;
      providerName: string;
      provider: EmailProvider;
      fromEmail: string;
      fromName: string;
    }
  | { configured: false; providerName: string; reason: string };

/**
 * Build the real transport, or explain exactly why there is none.
 * Never throws: a broken Settings store resolves to not-configured
 * ("settings-unavailable") so a worker job SKIPs instead of crashing
 * the handler — the order/invite that queued it is unaffected either
 * way (email is a side channel, never a precondition).
 */
export async function loadEmailTransport(
  reader: EmailSettingsReader = defaultReader,
): Promise<EmailTransportLoad> {
  let providerName = "resend";
  try {
    const resolved = await resolveEmailConfig(reader);
    providerName = resolved.providerName;
    const reason = firstBlockedReason(resolved);
    if (reason !== null) {
      return { configured: false, providerName, reason };
    }
    const provider =
      providerName === "smtp"
        ? createSmtpEmailProvider({
            ...resolved.smtp,
            fromEmail: resolved.fromEmail,
            fromName: resolved.fromName,
          })
        : createResendEmailProvider({
            apiKey: resolved.apiKey,
            fromEmail: resolved.fromEmail,
            fromName: resolved.fromName,
          });
    return {
      configured: true,
      providerName,
      fromEmail: resolved.fromEmail,
      fromName: resolved.fromName,
      provider,
    };
  } catch {
    return { configured: false, providerName, reason: "settings-unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/* Settings-test probe resolution (Admin > Settings > Test button)     */
/* ------------------------------------------------------------------ */

export interface EmailProbeResolution {
  providerName: string;
  fromAddressSet: boolean;
  /** Resend only: the API key is set (the value never leaves config). */
  resendApiKeySet: boolean;
  /** The SAVED SMTP connection options when the selected provider is
   *  smtp — parsed here, in the one place SMTP settings are read, so
   *  the probe can never drift from the send path. Null otherwise. */
  smtp: SmtpConnectionOptions | null;
  /** Missing required SMTP Settings keys (names only), check order. */
  smtpMissingFields: string[];
}

export async function resolveEmailProbe(
  reader: EmailSettingsReader = defaultReader,
): Promise<EmailProbeResolution> {
  const resolved = await resolveEmailConfig(reader);
  const smtpMissingFields: string[] = [];
  if (resolved.providerName === "smtp") {
    if (resolved.smtp.host === "") smtpMissingFields.push("email.smtp.host");
    if (resolved.smtp.user === "") smtpMissingFields.push("email.smtp.user");
    if (resolved.smtp.password === "") smtpMissingFields.push("email.smtp.password");
  }
  return {
    providerName: resolved.providerName,
    fromAddressSet: resolved.fromEmail !== "",
    resendApiKeySet: resolved.apiKey !== "",
    smtp: resolved.providerName === "smtp" ? resolved.smtp : null,
    smtpMissingFields,
  };
}

/* ------------------------------------------------------------------ */
/* Status probe (Admin > Settings card pattern: booleans only)         */
/* ------------------------------------------------------------------ */

export interface EmailTransportStatus {
  provider: string;
  configured: boolean;
  /** The active provider's secret credential is set (Resend API key,
   *  or the SMTP password) — field name kept for existing consumers. */
  apiKeySet: boolean;
  fromAddressSet: boolean;
  /** Machine reason when not configured; null when configured. */
  reason: string | null;
}

export async function getEmailTransportStatus(
  reader: EmailSettingsReader = defaultReader,
): Promise<EmailTransportStatus> {
  try {
    const resolved = await resolveEmailConfig(reader);
    const apiKeySet =
      resolved.providerName === "smtp"
        ? resolved.smtp.password !== ""
        : resolved.apiKey !== "";
    const fromAddressSet = resolved.fromEmail !== "";
    const reason = firstBlockedReason(resolved);
    return {
      provider: resolved.providerName,
      configured: reason === null,
      apiKeySet,
      fromAddressSet,
      reason,
    };
  } catch {
    return {
      provider: "resend",
      configured: false,
      apiKeySet: false,
      fromAddressSet: false,
      reason: "settings-unavailable",
    };
  }
}

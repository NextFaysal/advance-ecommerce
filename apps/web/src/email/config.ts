/**
 * Email transport configuration — ADV-3 (doc 22).
 *
 * Resolves the REAL email transport from Admin Settings, following
 * the platform resolution order (DB Settings row → env → default):
 *
 *   email.provider          which transport ("resend"; default)
 *   email.resend.api_key    encrypted credential (env RESEND_API_KEY
 *                           is the fallback, never the override)
 *   email.resend.enabled    "false" disables the transport outright
 *   email.from_address      sender address (env EMAIL_FROM_ADDRESS)
 *   email.from_name         sender display name; falls back to
 *                           general.store_name, then the bare address
 *
 * HONESTY: anything missing yields { configured: false, reason } —
 * the send path turns that into a SKIPPED job, never a fake send.
 * SMTP is a registered provider name with NO transport behind it yet
 * (no dependency-free way to speak SMTP from this codebase), so it
 * resolves to not-configured with that exact reason instead of
 * pretending. getEmailTransportStatus() exposes booleans only — a
 * credential value never leaves this module.
 */
import {
  getIntegrationConfigWithSecrets,
  getSetting,
} from "../lib/settings";
import { createResendEmailProvider } from "../integrations/email-resend";
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
  apiKey: string;
  fromEmail: string;
  fromName: string;
}

async function resolveEmailConfig(
  reader: EmailSettingsReader,
): Promise<ResolvedEmailConfig> {
  const providerName =
    ((await reader.getSetting("email.provider")) ?? "").trim() || "resend";
  const base: ResolvedEmailConfig = {
    providerName,
    unsupportedReason: null,
    enabled: true,
    apiKey: "",
    fromEmail: "",
    fromName: "",
  };
  if (providerName === "smtp") {
    return {
      ...base,
      unsupportedReason:
        "smtp transport is not implemented yet — set email.provider to resend",
    };
  }
  if (providerName !== "resend") {
    return { ...base, unsupportedReason: `unknown email provider "${providerName}"` };
  }
  const secrets = await reader.getProviderSecrets("resend");
  const apiKey =
    (secrets["api_key"] ?? "").trim() || (process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail =
    ((await reader.getSetting("email.from_address")) ?? "").trim() ||
    (process.env.EMAIL_FROM_ADDRESS ?? "").trim();
  const fromNameSetting = ((await reader.getSetting("email.from_name")) ?? "").trim();
  const storeName = ((await reader.getSetting("general.store_name")) ?? "").trim();
  return {
    ...base,
    enabled: secrets["enabled"] !== "false",
    apiKey,
    fromEmail,
    fromName: fromNameSetting || storeName,
  };
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
    if (resolved.unsupportedReason !== null) {
      return { configured: false, providerName, reason: resolved.unsupportedReason };
    }
    if (!resolved.enabled) {
      return {
        configured: false,
        providerName,
        reason: "email.resend.enabled is false",
      };
    }
    if (resolved.apiKey === "") {
      return {
        configured: false,
        providerName,
        reason: "email.resend.api_key is not set",
      };
    }
    if (resolved.fromEmail === "") {
      return {
        configured: false,
        providerName,
        reason: "email.from_address is not set",
      };
    }
    return {
      configured: true,
      providerName,
      fromEmail: resolved.fromEmail,
      fromName: resolved.fromName,
      provider: createResendEmailProvider({
        apiKey: resolved.apiKey,
        fromEmail: resolved.fromEmail,
        fromName: resolved.fromName,
      }),
    };
  } catch {
    return { configured: false, providerName, reason: "settings-unavailable" };
  }
}

/* ------------------------------------------------------------------ */
/* Status probe (Admin > Settings card pattern: booleans only)         */
/* ------------------------------------------------------------------ */

export interface EmailTransportStatus {
  provider: string;
  configured: boolean;
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
    const apiKeySet = resolved.apiKey !== "";
    const fromAddressSet = resolved.fromEmail !== "";
    let reason: string | null = null;
    if (resolved.unsupportedReason !== null) reason = resolved.unsupportedReason;
    else if (!resolved.enabled) reason = "email.resend.enabled is false";
    else if (!apiKeySet) reason = "email.resend.api_key is not set";
    else if (!fromAddressSet) reason = "email.from_address is not set";
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

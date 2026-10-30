import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import {
  SMS_PROVIDERS,
  getIntegrationConfigWithSecrets,
  getSetting,
} from "@/lib/settings";
import type { SmsProviderName } from "@/integrations/sms";
import {
  SMS_FIELD_DEFS,
  SmsSettingsCard,
  type SmsProviderInitial,
  type SmsSettingsInitial,
} from "./sms-settings-card";
import { getEmailTransportStatus, type EmailTransportStatus } from "@/email/config";
import { EmailSettingsCard, type EmailSettingsInitial } from "./email-settings-card";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { SETTINGS_B_STRINGS } from "../strings-b";

// Admin > Settings > Notifications — SMS gateway configuration (ADV-2,
// doc 22). This page used to be a disabled shell; it is now the real
// editor for the keys src/integrations/sms-resolver.ts reads at send
// time:
//   sms.provider / sms.fallback_provider / sms.sender_id
//   sms.<provider>.enabled + the provider's credential fields
//     bulksmsbd:   api_key (secret), sender_id
//     sslwireless: api_token (secret), sid
//     greenweb:    token (secret)
// Secret VALUES never reach this page's props: the server reads the
// provider rows only to compute presence booleans (has the field been
// set?), and the card's credential inputs are write-only (blank =
// keep the stored value). Saves go through the standard Settings API
// (reason required, audited) exactly like the other settings cards.
// A provider routes REAL sends only when enabled AND fully
// credentialed; otherwise sends stay on the sandbox simulator and are
// labelled simulated — the card says which state the store is in.
// UI copy: doc-30 dictionary (../strings-b), locale via getRequestLocale().
export const dynamic = "force-dynamic";

export default async function NotificationsSettingsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  let dbReady = true;
  const initial: SmsSettingsInitial = {
    activeProvider: "",
    fallbackProvider: "",
    senderId: "",
    providers: {} as Record<SmsProviderName, SmsProviderInitial>,
  };
  try {
    initial.activeProvider = (await getSetting("sms.provider")) ?? "";
    initial.fallbackProvider = (await getSetting("sms.fallback_provider")) ?? "";
    initial.senderId = (await getSetting("sms.sender_id")) ?? "";
    for (const provider of SMS_PROVIDERS) {
      const fields = await getIntegrationConfigWithSecrets("sms", provider).catch(
        () => ({}) as Record<string, string>,
      );
      const present: Record<string, boolean> = {};
      for (const def of SMS_FIELD_DEFS[provider]) {
        present[def.key] = (fields[def.key] ?? "").trim() !== "";
      }
      initial.providers[provider] = {
        enabled: (await getSetting(`sms.${provider}.enabled`)) === "true",
        present,
        senderId: (fields.sender_id ?? "").trim(),
      };
    }
  } catch {
    dbReady = false;
    for (const provider of SMS_PROVIDERS) {
      initial.providers[provider] = { enabled: false, present: {}, senderId: "" };
    }
  }
  const emailStatus: EmailTransportStatus = await getEmailTransportStatus().catch(
    () => ({
      provider: "resend",
      configured: false,
      apiKeySet: false,
      fromAddressSet: false,
      reason: "status unavailable",
    }),
  );

  // Email editor initial state (doc-verification wave, 2026-10-30):
  // plain values for text fields, PRESENCE booleans for secrets — a
  // secret value never reaches the page props, same discipline as the
  // SMS card above.
  const emailInitial: EmailSettingsInitial = {
    provider: "resend",
    fromName: "",
    fromAddress: "",
    resendApiKeyPresent: false,
    smtpEnabled: true,
    smtpHost: "",
    smtpPort: "",
    smtpSecure: "",
    smtpUser: "",
    smtpPasswordPresent: false,
    smtpTlsRejectUnauthorized: true,
    configured: emailStatus.configured,
    statusReason: emailStatus.reason ?? "",
  };
  if (dbReady) {
    try {
      emailInitial.provider = (await getSetting("email.provider")) ?? "resend";
      emailInitial.fromName = (await getSetting("email.from_name")) ?? "";
      emailInitial.fromAddress = (await getSetting("email.from_address")) ?? "";
      const resendFields = await getIntegrationConfigWithSecrets("email", "resend").catch(
        () => ({}) as Record<string, string>,
      );
      emailInitial.resendApiKeyPresent = (resendFields.api_key ?? "").trim() !== "";
      const smtpFields = await getIntegrationConfigWithSecrets("email", "smtp").catch(
        () => ({}) as Record<string, string>,
      );
      emailInitial.smtpEnabled = (await getSetting("email.smtp.enabled")) !== "false";
      emailInitial.smtpHost = smtpFields.host ?? "";
      emailInitial.smtpPort = smtpFields.port ?? "";
      emailInitial.smtpSecure = smtpFields.secure ?? "";
      emailInitial.smtpUser = smtpFields.user ?? "";
      emailInitial.smtpPasswordPresent = (smtpFields.password ?? "").trim() !== "";
      emailInitial.smtpTlsRejectUnauthorized =
        (smtpFields.tls_reject_unauthorized ?? "true") !== "false";
    } catch {
      // Keep the defaults; the card still renders and saves will
      // surface any settings API failure with its real message.
    }
  }

  return (
    <main className="min-w-0">
      <PageHeader
        title={s.notifTitle}
        description={s.notifDesc}
        breadcrumb={s.notifBreadcrumb}
        actions={
          <Link
            href="/admin/settings"
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300"
          >
            {s.allSettings}
          </Link>
        }
      />

      <div className="mt-6">
        <SmsSettingsCard initial={initial} dbReady={dbReady} />
      </div>

      <EmailSettingsCard initial={emailInitial} dbReady={dbReady} />
    </main>
  );
}

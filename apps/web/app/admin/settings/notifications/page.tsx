import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Icon } from "@/components/ui/icon";
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
export const dynamic = "force-dynamic";

export default async function NotificationsSettingsPage() {
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

  return (
    <main className="min-w-0">
      <PageHeader
        title="নোটিফিকেশন — SMS গেটওয়ে ও ইমেইল"
        description="OTP, অর্ডার আপডেট, কল-সেন্টার অটোমেশন ও রিটার্ন নোটিফিকেশনের SMS কোন গেটওয়ে দিয়ে যাবে তা এখান থেকে ঠিক হয়। ক্রেডেনশিয়াল এনক্রিপ্ট হয়ে সংরক্ষিত থাকে — মান কখনো পেজে দেখানো হয় না।"
        breadcrumb="সেটিংস / নোটিফিকেশন"
        actions={
          <Link
            href="/admin/settings"
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300"
          >
            ← সব সেটিংস
          </Link>
        }
      />

      <div className="mt-4">
        <SmsSettingsCard initial={initial} dbReady={dbReady} />
      </div>

      <section className="mt-4 rounded-lg border border-border/70 bg-card p-5 shadow-card">
        <h2 className="flex items-center gap-2.5 font-display text-base font-semibold text-text-main">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
            <Icon name="info" size={17} />
          </span>
          ইমেইল
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-text-muted">
          {emailStatus.configured ? (
            <>
              Resend transport কনফিগার করা আছে — queue-তে থাকা ইমেইল (অর্ডার
              কনফার্মেশন, স্টাফ ইনভাইট) worker চালু থাকলে আসলেই পাঠানো হবে।
            </>
          ) : (
            <>
              Resend transport তৈরি (ADV-3), কিন্তু এখনো কনফিগার করা হয়নি
              {emailStatus.reason ? <> ({emailStatus.reason})</> : null}। Settings-এ{" "}
              <code>email.resend.api_key</code> ও <code>email.from_address</code>{" "}
              বসালে ইমেইল চালু হবে; ততক্ষণ queue-তে থাকা ইমেইল SKIP হয় — কোথাও
              &quot;পাঠানো হয়েছে&quot; বলে দাবি করা হয় না। SMTP এখনো implement
              হয়নি। SMS গেটওয়ে উপরে কনফিগার করলেই OTP ও নোটিফিকেশন SMS আসল
              গেটওয়ে দিয়ে যেতে শুরু করবে (worker চালু থাকা সাপেক্ষে)।
            </>
          )}
        </p>
      </section>
    </main>
  );
}

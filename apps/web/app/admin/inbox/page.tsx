import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { PageHeader } from "@/components/ui/page-header";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { INBOX_STRINGS } from "./strings";
import { maskPhone } from "@/checkout/validation";
import { demoInboxFlags, isInboxEnabled } from "@/inbox/flags";
import { extractPhoneFromMessages } from "@/inbox/conversion";
import { toConversationView } from "@/inbox/service";
import { loadInbox } from "@/inbox/store";
import { getMetaChannelLiveStatus } from "@/inbox/send";
import { getInboxChannelsLiveMeta } from "@/inbox/meta-channels";
import { getSetting } from "@/lib/settings";
import type { InboxChannel, InboxMessage } from "@/inbox/types";
import InboxClient from "./inbox-client";

// F-commerce unified inbox — Agent 40 (page) on Agent 14's src/inbox
// contracts + /api/v1/admin/inbox routes (Step 46, A6 / Part G).
// Locked state: while module.f_commerce is OFF (seeded default, paid
// add-on), the page renders the lock panel, matching the API's 403
// FEATURE_LOCKED and the call-center / pos / automation page pattern.
// Unlocked: the unified inbox UI (InboxClient) works on the Prisma DB
// store (src/inbox/store.ts). The RECEIVE side went live in ADV-6
// part 1: channels fully configured in Settings (meta.*) deliver real
// webhook messages here; the per-channel live state below is computed
// from that config on every render, never hardcoded. The SEND side
// (ADV-6 part 2, src/inbox/send.ts) uses the SAME live definition: on
// a live channel the composer sends for real via the reply route; on
// an unconfigured channel it keeps the queued-intent demo behaviour.
// Privacy (D1 fix): only MASKED shapes cross to the client component —
// ConversationView[] (toConversationView) and pre-masked detected phones.
// Full numbers stay server-side; the order draft is built by POST
// /api/v1/admin/inbox/draft, which resolves the phone server-side.
export default async function AdminInboxPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, INBOX_STRINGS);
  await ensureDbFeatureFlags().catch(() => {});
  if (!isInboxEnabled(demoInboxFlags)) {
    return (
      <main>
        <PageHeader
          title={s.pageTitle}
          description={s.lockedDesc}
        />
        <p role="status">
          {s.lockedTextA}
          <code>module.f_commerce</code>{s.lockedTextB}
        </p>
      </main>
    );
  }

  const { conversations, messagesByConversation } = await loadInbox();
  const channelLive = await getMetaChannelLiveStatus();
  const anyLive = channelLive.MESSENGER || channelLive.WHATSAPP || channelLive.INSTAGRAM;
  const channelsMeta = await getInboxChannelsLiveMeta({ getSetting });
  const channelLabels: Record<InboxChannel, string> = {
    MESSENGER: "Messenger",
    INSTAGRAM: "Instagram",
    WHATSAPP: "WhatsApp",
  };
  const threads: Record<string, InboxMessage[]> = {};
  const detectedPhoneMasked: Record<string, string | null> = {};
  for (const conv of conversations) {
    const messages = messagesByConversation.get(conv.id) ?? [];
    threads[conv.id] = messages;
    const detected = extractPhoneFromMessages(messages);
    detectedPhoneMasked[conv.id] = detected ? maskPhone(detected) : null;
  }

  return (
    <main>
      <PageHeader
        title={s.pageTitle}
        description={s.pageDesc}
        breadcrumb={s.pageBreadcrumb}
      />
      <p role="status">
        {s.channelStatusLabel}{" "}
        {(Object.keys(channelLabels) as InboxChannel[]).map((channel, i) => (
          <span key={channel}>
            {i > 0 ? " · " : ""}
            {channelLabels[channel]}:{" "}
            {channelsMeta.channels[channel] ? s.channelLiveLabel : s.channelNotSetup}
          </span>
        ))}
        {" — "}{s.channelSetupSuffix}
      </p>
      <InboxClient
        conversations={conversations.map(toConversationView)}
        threads={threads}
        detectedPhoneMasked={detectedPhoneMasked}
        channelLive={channelLive}
      />
    </main>
  );
}

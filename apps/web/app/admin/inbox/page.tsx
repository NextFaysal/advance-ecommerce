import { PageHeader } from "@/components/ui/page-header";
import { maskPhone } from "@/checkout/validation";
import { demoInboxFlags, isInboxEnabled } from "@/inbox/flags";
import { extractPhoneFromMessages } from "@/inbox/conversion";
import {
  demoConversations,
  demoMessages,
  messagesForConversation,
  toConversationView,
} from "@/inbox/service";
import type { InboxMessage } from "@/inbox/types";
import InboxClient from "./inbox-client";

// F-commerce unified inbox — Agent 40 (page) on Agent 14's src/inbox
// contracts + /api/v1/admin/inbox routes (Step 46, A6 / Part G).
// Locked state: while module.f_commerce is OFF (seeded default, paid
// add-on), the page renders the lock panel, matching the API's 403
// FEATURE_LOCKED and the call-center / pos / automation page pattern.
// Unlocked: the unified inbox UI (InboxClient) works on the src/inbox
// TEMPORARY DEMO store (in-memory, lost on restart). Channels are TYPES
// ONLY in this slice — no Messenger / WhatsApp / Instagram API is
// connected, no channel token exists anywhere, and nothing is ever sent.
// Privacy (D1 fix): only MASKED shapes cross to the client component —
// ConversationView[] (toConversationView) and pre-masked detected phones.
// Full numbers stay server-side; the order draft is built by POST
// /api/v1/admin/inbox/draft, which resolves the phone server-side.
export default function AdminInboxPage() {
  if (!isInboxEnabled(demoInboxFlags)) {
    return (
      <main>
        <PageHeader
          title="ইনবক্স (F-commerce)"
          description="Messenger, WhatsApp ও Instagram-এর সব কথোপকথন এক জায়গায় (ধাপ ৪৬, A6)"
        />
        <p role="status">
          🔒 এই মডিউলটি এই ইনস্টলে লক করা আছে। F-commerce ইনবক্স একটি পেইড অ্যাড-অন —
          আনলক করতে Admin &gt; Settings &gt; Feature Flags থেকে{" "}
          <code>module.f_commerce</code> চালু করুন।
        </p>
      </main>
    );
  }

  const threads: Record<string, InboxMessage[]> = {};
  const detectedPhoneMasked: Record<string, string | null> = {};
  for (const conv of demoConversations) {
    const messages = messagesForConversation(demoMessages, conv.id);
    threads[conv.id] = messages;
    const detected = extractPhoneFromMessages(messages);
    detectedPhoneMasked[conv.id] = detected ? maskPhone(detected) : null;
  }

  return (
    <main>
      <PageHeader
        title="ইনবক্স (F-commerce)"
        description="TEMPORARY DEMO — ডেটা src/inbox ইন-মেমরি ডেমো স্টোর থেকে (রিস্টার্টে মুছে যায়)। কোনো চ্যানেল API সংযুক্ত নেই: উত্তর পাঠানো যায় না, আর কথোপকথন থেকে তৈরি ড্রাফট কোনো অর্ডার নয়।"
        breadcrumb="Admin / Sales"
      />
      <InboxClient
        conversations={demoConversations.map(toConversationView)}
        threads={threads}
        detectedPhoneMasked={detectedPhoneMasked}
      />
    </main>
  );
}

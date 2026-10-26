import { PageHeader } from "@/components/ui/page-header";
import { subscriptionBoxesEnabled } from "@/boxes/flags";
import { subscriptionsEnabled } from "@/subscriptions/flags";
import { BoxesList } from "./boxes-list";
import { BoxesConfigCard } from "./boxes-config-card";
import { BoxesContentsCard } from "./boxes-contents-card";

// Admin > Subscription Boxes — ADV-23 vertical 4 (doc 23, wave 56).
// Locked state: while module.subscription_boxes is OFF (the seeded
// default — paid add-on), the page renders the lock panel instead
// of data, matching the sibling vertical pages. The config and
// contents APIs stay reachable without the flag (settings-guarded)
// so a merchant can prepare boxes before enabling the module —
// but generation additionally needs the engine flag
// module.subscriptions ON, which the header copy states plainly.

export const dynamic = "force-dynamic";

export default function BoxesPage() {
  if (!subscriptionBoxesEnabled()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>সাবস্ক্রিপশন বক্স</h1>
        <p role="status">
          🔒 This module is locked for this install. Subscription boxes is a paid add-on —
          enable <code>module.subscription_boxes</code> (and the subscription engine,{" "}
          <code>module.subscriptions</code>) in Admin &gt; Settings &gt; Feature Flags to
          unlock it.
        </p>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="সাবস্ক্রিপশন বক্স"
        description={
          subscriptionsEnabled()
            ? "কিউরেটেড রিকারিং বক্স — প্রতি সাইকেলের তালিকা অনুযায়ী অর্ডার তৈরি হয়। তালিকা নির্ধারণ না থাকলে ওই সাইকেল বাদ যায় (আগের বাক্স কখনো পাঠানো হয় না)। অর্ডার তৈরি হয় শুধু ওয়ার্কার সুইপ চললে।"
            : "সতর্কতা: সাবস্ক্রিপশন ইঞ্জিন (module.subscriptions) বন্ধ আছে — বক্স সাবস্ক্রিপশন তৈরি বা অর্ডার জেনারেশন কোনোটাই হবে না। আগে Feature Flags থেকে ইঞ্জিন চালু করুন।"
        }
      />
      <BoxesList />
      <BoxesContentsCard />
      <BoxesConfigCard />
    </div>
  );
}

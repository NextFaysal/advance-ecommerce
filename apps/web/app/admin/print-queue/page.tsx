import { PageHeader } from "@/components/ui/page-header";
import { isPodEnabled } from "@/pod/flags";
import { PrintQueueBoard } from "./print-queue-board";
import { PodConfigCard } from "./pod-config-card";

// Admin > Print Queue — ADV-23 vertical 5 (doc 23, wave 56).
// Locked state: while module.print_on_demand is OFF (the seeded
// default — paid add-on), the page renders the lock panel instead
// of data, matching the APIs' 403 FEATURE_LOCKED. Data: real
// orders whose create-time note carries a frozen custom print
// (src/pod/customisation.ts) — the board below self-fetches and
// polls. "ছাপানো হয়েছে" is a staff ATTESTATION: it appends a
// [pod-printed] note to the order and removes it from the queue;
// it changes no order status and moves no money. There is no POD
// table and no artwork upload in v1 — the customisation is text +
// an optional palette colour, frozen on the order note.

export const dynamic = "force-dynamic";

export default function PrintQueuePage() {
  if (!isPodEnabled()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>প্রিন্ট কিউ</h1>
        <p role="status">
          🔒 This module is locked for this install. Print-on-demand is a paid add-on —
          enable <code>module.print_on_demand</code> in Admin &gt; Settings &gt; Feature Flags to unlock it.
        </p>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="প্রিন্ট কিউ"
        description="কাস্টম প্রিন্টের অপেক্ষমাণ অর্ডার — সবচেয়ে পুরনোটি আগে। ছাপানো শেষ হলে ‘ছাপানো হয়েছে’ চাপুন — অর্ডারে একটি নোট যোগ হয়ে সেটি কিউ থেকে সরে যাবে। বোর্ডটি প্রতি ৩০ সেকেন্ডে নিজে হালনাগাদ হয় (polling — live realtime নয়)।"
      />
      <PrintQueueBoard />
      <PodConfigCard />
    </div>
  );
}

"use client";

// Campaign cost-estimate panel — Agent 25 (marketing page).
// ESTIMATE ONLY. This panel calls the pure estimate functions from
// src/marketing/service (smsSegments / estimateCampaignCost) in the
// browser and shows the segment math. It NEVER sends a message: real
// dispatch is a BullMQ job via the admin-configured SMS provider, and
// no provider credential exists in this page.
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { estimateCampaignCost } from "@/marketing/service";

const SAMPLE_MESSAGE =
  "অফার! আজ সব পণ্যে ১০% ছাড়। WELCOME10 কোড ব্যবহার করুন। অর্ডার: example.com";

export default function CampaignEstimate() {
  const [message, setMessage] = useState(SAMPLE_MESSAGE);
  const [recipients, setRecipients] = useState("1000");
  const [pricePerSegment, setPricePerSegment] = useState("45"); // poisha, demo rate

  const estimate = useMemo(() => {
    const recipientCount = Number.parseInt(recipients, 10);
    const rate = Number.parseInt(pricePerSegment, 10);
    return estimateCampaignCost({
      channel: "sms",
      segmentRef: "demo-segment",
      templateKey: "demo-template",
      messageText: message,
      recipientCount: Number.isFinite(recipientCount) ? recipientCount : 0,
      pricePerSegmentPoisha: Number.isFinite(rate) ? rate : 0,
      scheduledAt: null,
    });
  }, [message, recipients, pricePerSegment]);

  return (
    <Card>
      <h3 className="mb-1 font-semibold">ক্যাম্পেইন খরচের হিসাব (শুধু আনুমানিক)</h3>
      <p className="mb-4 text-xs text-text-muted">
        এই প্যানেল শুধু সেগমেন্ট ও খরচের হিসাব দেখায় — <strong>কোনো SMS পাঠানো হয় না।</strong>{" "}
        বাংলা (Unicode) মেসেজে প্রতি সেগমেন্ট ৭০ অক্ষর, দীর্ঘ মেসেজে ৬৭ অক্ষর করে ভাগ হয়;
        ইংরেজি (GSM) হলে ১৬০/১৫৩। আসল পাঠানো BullMQ জবের মাধ্যমে অ্যাডমিন-কনফিগার করা
        SMS প্রোভাইডার দিয়ে হয়।
      </p>
      <div className="grid gap-3">
        <label className="text-sm">
          মেসেজের লেখা
          <textarea
            className="mt-1 w-full rounded-[10px] border border-border bg-card px-3 py-2"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            প্রাপকের সংখ্যা
            <input
              className="mt-1 w-full rounded-[10px] border border-border bg-card px-3 py-2"
              type="number"
              min={0}
              value={recipients}
              onChange={(e) => setRecipients(e.target.value)}
            />
          </label>
          <label className="text-sm">
            প্রতি সেগমেন্টের দাম (পয়সা, ডেমো রেট)
            <input
              className="mt-1 w-full rounded-[10px] border border-border bg-card px-3 py-2"
              type="number"
              min={0}
              value={pricePerSegment}
              onChange={(e) => setPricePerSegment(e.target.value)}
            />
          </label>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-text-muted">এনকোডিং</dt>
          <dd className="font-semibold">{estimate.isUnicode ? "Unicode (বাংলা)" : "GSM (ইংরেজি)"}</dd>
        </div>
        <div>
          <dt className="text-text-muted">প্রতি মেসেজে সেগমেন্ট</dt>
          <dd className="font-semibold">{estimate.segmentsPerMessage}</dd>
        </div>
        <div>
          <dt className="text-text-muted">অক্ষর সংখ্যা</dt>
          <dd className="font-semibold">{message.length}</dd>
        </div>
        <div>
          <dt className="text-text-muted">আনুমানিক মোট খরচ</dt>
          <dd className="font-semibold">
            <Money poisha={estimate.costEstimatePoisha} />
          </dd>
        </div>
      </dl>
    </Card>
  );
}

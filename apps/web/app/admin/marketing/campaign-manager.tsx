"use client";

// Campaign manager — real DB-backed admin UI (2026-10-25).
// The list arrives from the server page (listCampaignsDb) and creates
// go through POST /api/v1/admin/campaigns, which persists a Campaign
// row with its computed cost estimate. NOTHING IS SENT from here:
// dispatch needs a BullMQ worker + a configured SMS/email provider,
// neither of which exists yet — a created campaign is a record
// (draft, or scheduled when a time is given), and the copy says so.
// The API's answer is shown as-is.
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Money } from "@/components/ui/money";
import type { Campaign, CampaignStatus } from "@/marketing/campaign";
import { estimateCampaignCost } from "@/marketing/campaign-cost";

const STATUS_META: Record<CampaignStatus, { label: string; tone: "success" | "info" | "warning" | "danger" | "neutral" }> = {
  draft: { label: "খসড়া", tone: "warning" },
  scheduled: { label: "নির্ধারিত", tone: "info" },
  sending: { label: "পাঠানো হচ্ছে", tone: "info" },
  sent: { label: "পাঠানো হয়েছে", tone: "success" },
  cancelled: { label: "বাতিল", tone: "danger" },
};

function dhakaLocalToIso(local: string): string {
  return new Date(`${local}:00+06:00`).toISOString();
}

function formatDhaka(iso: string): string {
  return new Intl.DateTimeFormat("bn-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

const inputClass = "mt-1 min-h-[44px] w-full rounded-xl border border-border bg-card px-3 py-2 text-text-main";

export default function CampaignManager({
  initialCampaigns,
  dbReady,
}: {
  initialCampaigns: Campaign[];
  dbReady: boolean;
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [segmentRef, setSegmentRef] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [messageText, setMessageText] = useState("");
  const [recipientCount, setRecipientCount] = useState("0");
  const [pricePerSegment, setPricePerSegment] = useState("45");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const recipients = Number.parseInt(recipientCount, 10);
  const rate = Number.parseInt(pricePerSegment, 10);
  const estimate = useMemo(
    () =>
      estimateCampaignCost({
        channel,
        segmentRef: segmentRef || "—",
        templateKey: templateKey || "—",
        messageText,
        recipientCount: Number.isFinite(recipients) ? recipients : 0,
        pricePerSegmentPoisha: Number.isFinite(rate) ? rate : 0,
        scheduledAt: null,
      }),
    [channel, segmentRef, templateKey, messageText, recipients, rate],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setStatus(null);
    const body = {
      channel,
      segmentRef: segmentRef.trim(),
      templateKey: templateKey.trim(),
      messageText,
      recipientCount: Number.isFinite(recipients) ? recipients : 0,
      pricePerSegmentPoisha: Number.isFinite(rate) ? rate : 0,
      scheduledAt: scheduledLocal ? dhakaLocalToIso(scheduledLocal) : null,
    };
    try {
      const res = await fetch("/api/v1/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: { campaign?: Campaign };
        error?: { message?: string };
      };
      if (!res.ok || !data.data?.campaign) {
        setStatus(data.error?.message ?? `ব্যর্থ হয়েছে (${res.status}) — কিছুই সংরক্ষিত হয়নি।`);
        return;
      }
      setCampaigns((prev) => [data.data!.campaign!, ...prev]);
      setStatus(
        "ক্যাম্পেইনটি ডাটাবেসে রেকর্ড হয়েছে — তবে কোনো মেসেজ পাঠানো হয়নি। পাঠানোর জন্য ওয়ার্কার ও প্রোভাইডার গেটওয়ে লাগবে, যা এখনো নেই।",
      );
    } catch {
      setStatus("নেটওয়ার্ক ত্রুটি — কিছুই সংরক্ষিত হয়নি।");
    } finally {
      setSending(false);
    }
  }

  if (!dbReady) {
    return (
      <Card>
        <h3 className="font-semibold text-text-main">ক্যাম্পেইন তালিকা পাওয়া যাচ্ছে না</h3>
        <p className="mt-1 text-sm text-text-muted">
          ডাটাবেস থেকে ক্যাম্পেইন পড়া যায়নি — কোনো নমুনা সারি দেখানো হচ্ছে না। ডাটাবেস চালু
          হলে আসল ক্যাম্পেইনগুলো এখানে আসবে।
        </p>
      </Card>
    );
  }

  const rows = campaigns.map((c) => {
    const meta = STATUS_META[c.status] ?? STATUS_META.draft;
    return {
      template: <span className="font-mono">{c.templateKey || "—"}</span>,
      channel: c.channel.toUpperCase(),
      segment: c.segmentRef || "—",
      // recipientCount is echoed by the create response but is NOT a
      // Campaign column — after a reload the repository reports 0, so
      // an unknown count renders as "—", never as a false zero.
      recipients: c.recipientCount > 0 ? <span className="tnum">{c.recipientCount}</span> : "—",
      estimate: c.costEstimatePoisha !== null ? <Money poisha={c.costEstimatePoisha} /> : "—",
      sent: <span className="tnum">{`${c.sentCount} / ${c.deliveredCount} / ${c.failedCount}`}</span>,
      scheduled: c.scheduledAt ? formatDhaka(c.scheduledAt) : "—",
      status: <Badge tone={meta.tone}>{meta.label}</Badge>,
    };
  });

  return (
    <div>
      <DataTable
        caption="ক্যাম্পেইন তালিকা — আসল ডাটাবেস থেকে (Campaign টেবিল)। এগুলো শুধু রেকর্ড ও খরচের হিসাব; কোনো মেসেজ পাঠানো হয়নি — পাঠানোর ওয়ার্কার ও গেটওয়ে এখনো নেই। প্রাপক সংখ্যা Campaign টেবিলে সংরক্ষিত হয় না, তাই পুনরায় লোডের পর '—' দেখায়।"
        columns={[
          { key: "template", header: "টেমপ্লেট" },
          { key: "channel", header: "চ্যানেল" },
          { key: "segment", header: "সেগমেন্ট" },
          { key: "recipients", header: "প্রাপক" },
          { key: "estimate", header: "আনুমানিক খরচ" },
          { key: "sent", header: "পাঠানো / ডেলিভার্ড / ব্যর্থ" },
          { key: "scheduled", header: "নির্ধারিত সময়" },
          { key: "status", header: "অবস্থা" },
        ]}
        rows={rows}
      />
      {campaigns.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">
          এখনো কোনো ক্যাম্পেইন রেকর্ড হয়নি — নিচের ফর্ম থেকে প্রথমটি তৈরি করুন।
        </p>
      ) : null}

      <Card className="mt-6">
        <h3 className="mb-1 font-semibold text-text-main">নতুন ক্যাম্পেইন রেকর্ড করুন</h3>
        <p className="mb-4 text-xs text-text-muted">
          এই ফর্ম ক্যাম্পেইনটি ডাটাবেসে রেকর্ড করে ও খরচের হিসাব সংরক্ষণ করে —{" "}
          <strong>কোনো SMS/ইমেইল পাঠায় না।</strong> আসল পাঠানো হবে BullMQ ওয়ার্কার ও
          কনফিগার-করা প্রোভাইডার গেটওয়ে চালু হলে।
        </p>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            চ্যানেল
            <select
              className={inputClass}
              value={channel}
              onChange={(e) => setChannel(e.target.value as "sms" | "email")}
            >
              <option value="sms">SMS</option>
              <option value="email">ইমেইল</option>
            </select>
          </label>
          <label className="text-sm">
            সেগমেন্ট (segmentRef)
            <input
              className={inputClass}
              value={segmentRef}
              onChange={(e) => setSegmentRef(e.target.value)}
              placeholder="যেমন: all-customers"
              required
            />
          </label>
          <label className="text-sm">
            টেমপ্লেট (templateKey)
            <input
              className={inputClass}
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
              placeholder="যেমন: offer-bn"
              required
            />
          </label>
          <label className="text-sm">
            নির্ধারিত সময় (ঐচ্ছিক, ঢাকা সময়)
            <input
              className={inputClass}
              type="datetime-local"
              value={scheduledLocal}
              onChange={(e) => setScheduledLocal(e.target.value)}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            মেসেজের লেখা
            <textarea
              className={inputClass}
              rows={3}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              maxLength={2000}
              required
            />
          </label>
          <label className="text-sm">
            প্রাপকের সংখ্যা
            <input
              className={inputClass}
              type="number"
              min={0}
              value={recipientCount}
              onChange={(e) => setRecipientCount(e.target.value)}
            />
          </label>
          <label className="text-sm">
            প্রতি সেগমেন্টের দাম (পয়সা)
            <input
              className={inputClass}
              type="number"
              min={0}
              value={pricePerSegment}
              onChange={(e) => setPricePerSegment(e.target.value)}
            />
          </label>
          <p className="text-sm text-text-muted sm:col-span-2">
            আনুমানিক খরচ: <Money poisha={estimate.costEstimatePoisha} />
            {channel === "sms"
              ? ` — প্রতি মেসেজে ${estimate.segmentsPerMessage} সেগমেন্ট (${estimate.isUnicode ? "Unicode" : "GSM"})`
              : " — ইমেইলে সেগমেন্ট খরচ নেই"}
          </p>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={sending}>
              {sending ? "রেকর্ড হচ্ছে…" : "ক্যাম্পেইন রেকর্ড করুন"}
            </Button>
            {status ? (
              <p role="status" className="mt-2 text-sm text-text-muted">
                {status}
              </p>
            ) : null}
          </div>
        </form>
      </Card>
    </div>
  );
}

"use client";

/**
 * Daily digest panel (ADV-27 remainder) — preview the digest for a
 * Dhaka date, manage recipient emails, and enqueue a send.
 *
 * HONESTY: the send result is rendered EXACTLY as the API reports it.
 * "queued" means the job landed in Redis — it is NOT sent. There is
 * no worker in production yet and the email transport must also be
 * configured, so this panel never claims delivery. Telegram/Slack
 * are not offered: no notify service exists in the codebase
 * (src/connectors does not exist), so email is the only channel and
 * the panel says why.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface DigestData {
  textBn: string;
  recipients: string[];
}

interface SendResult {
  delivery: "queued" | "not_queued" | "no_recipients";
  results: { email: string; outcome: { email: string; jobId?: string; reason?: string } }[];
  note: string;
}

function todayDhaka(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function DigestPanel() {
  const [date, setDate] = useState(todayDhaka());
  const [text, setText] = useState("");
  const [recipientsText, setRecipientsText] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [sendResult, setSendResult] = useState<SendResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (d: string) => {
    try {
      const res = await fetch(`/api/v1/admin/team/digest?date=${d}`, { cache: "no-store" });
      const json = (await res.json()) as { data?: DigestData; error?: { message: string } };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "ডাইজেস্ট আনা যায়নি।");
        return;
      }
      setText(json.data.textBn);
      setRecipientsText(json.data.recipients.join("\n"));
      setError("");
    } catch {
      setError("নেটওয়ার্ক ত্রুটি।");
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [load, date]);

  const saveRecipients = async () => {
    setBusy(true);
    setNote("");
    try {
      const emails = recipientsText.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
      const res = await fetch("/api/v1/admin/team/digest/recipients", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const json = (await res.json()) as { error?: { message: string } };
      setNote(res.ok ? "প্রাপকের তালিকা সংরক্ষিত হয়েছে।" : (json.error?.message ?? "সংরক্ষণ হয়নি।"));
    } catch {
      setNote("নেটওয়ার্ক ত্রুটি।");
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setBusy(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/v1/admin/team/digest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const json = (await res.json()) as { data?: SendResult; error?: { message: string } };
      if (!res.ok || !json.data) {
        setNote(json.error?.message ?? "পাঠানোর চেষ্টা ব্যর্থ হয়েছে।");
        return;
      }
      setSendResult(json.data);
    } catch {
      setNote("নেটওয়ার্ক ত্রুটি।");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h3">দৈনিক ডাইজেস্ট (ইমেইল)</h2>
        <label className="flex items-center gap-2 text-small">
          তারিখ
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
        </label>
      </div>
      {error !== "" && <p className="text-small font-medium text-rose-600">{error}</p>}
      {text !== "" && (
        <pre className="mb-4 whitespace-pre-wrap rounded-md bg-surface-2 p-4 font-sans text-small leading-relaxed">
          {text}
        </pre>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <label className="text-small font-medium" htmlFor="digest-recipients">
            প্রাপকদের ইমেইল (প্রতি লাইনে একটি)
          </label>
          <textarea
            id="digest-recipients"
            className="mt-2 min-h-28 w-full rounded-md border border-border bg-card p-3 text-small"
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
            placeholder="owner@example.com"
          />
          <Button variant="secondary" onClick={() => void saveRecipients()} disabled={busy} className="mt-2">
            প্রাপক সংরক্ষণ করুন
          </Button>
        </div>
        <div>
          <p className="text-small leading-relaxed text-text-subtle">
            পাঠানো মানে ইমেইল কিউতে (Redis) জব জমা দেওয়া — <strong>queued মানে পাঠানো হয়েছে নয়</strong>।
            আসল ডেলিভারির জন্য worker প্রসেস ও কনফিগার করা email transport দরকার (production-এ worker এখনো
            চালু হয়নি)। Telegram/Slack চ্যানেল এখানে নেই — codebase-এ কোনো notify service নেই, তাই ভুয়া
            অপশন দেখানো হয়নি।
          </p>
          <Button onClick={() => void send()} disabled={busy} className="mt-3 min-h-[44px]">
            এখন পাঠান (কিউতে)
          </Button>
          {note !== "" && <p className="mt-2 text-small font-medium">{note}</p>}
          {sendResult !== null && (
            <div className="mt-3 rounded-md border border-border p-3 text-small">
              <p className="font-semibold">
                ফলাফল:{" "}
                {sendResult.delivery === "queued"
                  ? "সব প্রাপকের জন্য কিউতে জমা হয়েছে (পাঠানো হয়নি)"
                  : sendResult.delivery === "no_recipients"
                    ? "কোনো প্রাপক নেই — আগে প্রাপক যোগ করুন"
                    : "কিউতে জমা দেওয়া যায়নি"}
              </p>
              <ul className="mt-2 space-y-1">
                {sendResult.results.map((r) => (
                  <li key={r.email} className="tabular-nums">
                    {r.email} —{" "}
                    {r.outcome.email === "queued"
                      ? `queued (job ${r.outcome.jobId ?? "—"})`
                      : `not queued (${r.outcome.reason ?? "unknown"})`}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-caption text-text-subtle">{sendResult.note}</p>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

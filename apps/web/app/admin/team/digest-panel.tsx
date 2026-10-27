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
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { TEAM_STRINGS } from "./strings";

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
  const { locale } = useLocale();
  const s = pick(locale, TEAM_STRINGS);
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
        setError(json.error?.message ?? s.digestLoadFailed);
        return;
      }
      setText(json.data.textBn);
      setRecipientsText(json.data.recipients.join("\n"));
      setError("");
    } catch {
      setError(s.networkError);
    }
  }, [s]);

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
      setNote(res.ok ? s.recipientsSaved : (json.error?.message ?? s.digestSaveFailed));
    } catch {
      setNote(s.networkError);
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
        setNote(json.error?.message ?? s.sendFailed);
        return;
      }
      setSendResult(json.data);
    } catch {
      setNote(s.networkError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h3">{s.digestTitle}</h2>
        <label className="flex items-center gap-2 text-small">
          {s.dateLabel}
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
            {s.recipientsLabel}
          </label>
          <textarea
            id="digest-recipients"
            className="mt-2 min-h-28 w-full rounded-md border border-border bg-card p-3 text-small"
            value={recipientsText}
            onChange={(e) => setRecipientsText(e.target.value)}
            placeholder="owner@example.com"
          />
          <Button variant="secondary" onClick={() => void saveRecipients()} disabled={busy} className="mt-2">
            {s.saveRecipientsBtn}
          </Button>
        </div>
        <div>
          <p className="text-small leading-relaxed text-text-subtle">
            {s.digestHonestyBefore}<strong>{s.digestHonestyStrong}</strong>{s.digestHonestyAfter}
          </p>
          <Button onClick={() => void send()} disabled={busy} className="mt-3 min-h-[44px]">
            {s.sendNowBtn}
          </Button>
          {note !== "" && <p className="mt-2 text-small font-medium">{note}</p>}
          {sendResult !== null && (
            <div className="mt-3 rounded-md border border-border p-3 text-small">
              <p className="font-semibold">
                {s.resultLabel}
                {sendResult.delivery === "queued"
                  ? s.resultQueued
                  : sendResult.delivery === "no_recipients"
                    ? s.resultNoRecipients
                    : s.resultNotQueued}
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

"use client";

// Outbound connector settings card — Settings > Connectors
// (ADV-25 part 2, doc 22). Edits the connectors.* keys the fan-out
// in src/connectors/* reads at send time.
//
// Write-only secrets, exactly like the SMS card: the server sends
// only PRESENCE booleans for credential fields — never a value. A
// credential input left blank means "keep the stored value"; it is
// written only when the admin types a new one. Saves go through the
// standard Settings API (POST /api/v1/admin/settings
// { key, value, reason }), so every change is audited, a reason is
// required, and secrets are encrypted at rest.
//
// The "টেস্ট পাঠান" buttons call POST /api/v1/admin/connectors/test,
// which performs ONE REAL attempt (real Slack webhook POST, real
// Telegram sendMessage, real Sheets append of a TEST row) and the
// verbatim outcome is shown next to the button. A test needs the
// credentials saved first; the enabled switch is not required.
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import type { AttemptRecord, ConnectorChannel } from "@/connectors/types";

export interface ConnectorChannelInitial {
  enabled: boolean;
  /** Stored comma-separated event subset ("" for sheets). */
  events: string;
  /** Presence booleans per credential field key — never values. */
  present: Record<string, boolean>;
  /** Plain (non-secret) stored values by field key. */
  values: Record<string, string>;
  /** Sheets only: the service account's client_email (an identifier,
   *  not the key) when a parseable JSON is stored. */
  serviceAccountEmail?: string;
  serviceAccountValid?: boolean;
}

export interface ConnectorsInitial {
  slack: ConnectorChannelInitial;
  telegram: ConnectorChannelInitial;
  sheets: ConnectorChannelInitial;
  attempts: AttemptRecord[];
}

const EVENT_DEFS = [
  { name: "order.created", label: "নতুন অর্ডার · order.created" },
  { name: "order.status_changed", label: "স্ট্যাটাস বদল · order.status_changed" },
  { name: "payment.succeeded", label: "পেমেন্ট সফল · payment.succeeded" },
  { name: "stock.low", label: "স্টক কম · stock.low" },
] as const;

type EventName = (typeof EVENT_DEFS)[number]["name"];

const CHANNELS: ConnectorChannel[] = ["slack", "telegram", "sheets"];

const CHANNEL_TITLES: Record<ConnectorChannel, string> = {
  slack: "Slack",
  telegram: "Telegram",
  sheets: "Google Sheets",
};

/** Stored-state readiness: enabled AND every credential present —
 *  mirrors the fan-out's own resolution (src/connectors/config.ts). */
function channelConfigured(
  channel: ConnectorChannel,
  initial: ConnectorChannelInitial,
): boolean {
  if (!initial.enabled) return false;
  if (channel === "slack") return initial.present.webhook_url === true;
  if (channel === "telegram") return initial.present.bot_token === true;
  return initial.present.service_account_json === true;
}

function parseEvents(raw: string): Set<EventName> {
  const out = new Set<EventName>();
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (EVENT_DEFS.some((d) => d.name === name)) out.add(name as EventName);
  }
  return out;
}

function joinEvents(set: Set<EventName>): string {
  return EVENT_DEFS.map((d) => d.name).filter((n) => set.has(n)).join(",");
}

interface ConnectorsCardProps {
  initial: ConnectorsInitial;
  dbReady: boolean;
}

export function ConnectorsCard({ initial, dbReady }: ConnectorsCardProps) {
  const [enabled, setEnabled] = useState<Record<ConnectorChannel, boolean>>({
    slack: initial.slack.enabled,
    telegram: initial.telegram.enabled,
    sheets: initial.sheets.enabled,
  });
  const [events, setEvents] = useState<Record<"slack" | "telegram", Set<EventName>>>({
    slack: parseEvents(initial.slack.events),
    telegram: parseEvents(initial.telegram.events),
  });
  const [plainInputs, setPlainInputs] = useState<Record<string, string>>({
    "telegram.chat_id": initial.telegram.values.chat_id ?? "",
    "telegram.api_base": initial.telegram.values.api_base ?? "",
    "sheets.spreadsheet_id": initial.sheets.values.spreadsheet_id ?? "",
    "sheets.sheet_name": initial.sheets.values.sheet_name ?? "",
  });
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({
    "slack.webhook_url": "",
    "telegram.bot_token": "",
    "sheets.service_account_json": "",
  });
  const [attempts, setAttempts] = useState<AttemptRecord[]>(initial.attempts);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<ConnectorChannel | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  async function postSetting(key: string, value: string): Promise<string | null> {
    const res = await fetch("/api/v1/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, reason: reason.trim() }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return data.error?.message ?? `সেভ করা যায়নি (${res.status})`;
  }

  async function handleSave() {
    setStatus("");
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus("পরিবর্তনের কারণ লিখুন — এটি অডিট লগে সংরক্ষিত থাকে।");
      return;
    }
    const writes: { key: string; value: string }[] = [];
    for (const channel of CHANNELS) {
      if (enabled[channel] !== initial[channel].enabled) {
        writes.push({
          key: `connectors.${channel}.enabled`,
          value: enabled[channel] ? "true" : "false",
        });
      }
    }
    for (const channel of ["slack", "telegram"] as const) {
      const joined = joinEvents(events[channel]);
      if (joined !== joinEvents(parseEvents(initial[channel].events))) {
        writes.push({ key: `connectors.${channel}.events`, value: joined });
      }
    }
    const plainKeys: Record<string, string> = {
      "telegram.chat_id": "connectors.telegram.chat_id",
      "telegram.api_base": "connectors.telegram.api_base",
      "sheets.spreadsheet_id": "connectors.sheets.spreadsheet_id",
      "sheets.sheet_name": "connectors.sheets.sheet_name",
    };
    for (const [field, key] of Object.entries(plainKeys)) {
      const channel = field.split(".")[0] as ConnectorChannel;
      const name = field.split(".")[1] as string;
      const current = (plainInputs[field] ?? "").trim();
      const stored = (initial[channel].values[name] ?? "").trim();
      if (current !== stored) writes.push({ key, value: current });
    }
    const secretKeys: Record<string, string> = {
      "slack.webhook_url": "connectors.slack.webhook_url",
      "telegram.bot_token": "connectors.telegram.bot_token",
      "sheets.service_account_json": "connectors.sheets.service_account_json",
    };
    for (const [field, key] of Object.entries(secretKeys)) {
      const raw = (secretInputs[field] ?? "").trim();
      if (raw !== "") writes.push({ key, value: raw });
    }

    if (writes.length === 0) {
      setStatusOk(true);
      setStatus("কোনো পরিবর্তন নেই — সব মান আগের মতোই আছে, কিছুই সেভ করা হয়নি।");
      return;
    }
    setSaving(true);
    const savedKeys: string[] = [];
    try {
      for (const w of writes) {
        const failure = await postSetting(w.key, w.value);
        if (failure !== null) {
          setStatusOk(false);
          setStatus(
            savedKeys.length > 0
              ? `${w.key} সেভ করা যায়নি: ${failure} — তবে আগের ${savedKeys.length}টি পরিবর্তন সেভ হয়ে গেছে (${savedKeys.join(", ")})।`
              : `${w.key} সেভ করা যায়নি: ${failure}`,
          );
          return;
        }
        savedKeys.push(w.key);
      }
      setStatusOk(true);
      setStatus(
        `সেভ হয়েছে — ${savedKeys.length}টি সেটিং বদলেছে। নতুন মান পরের ইভেন্ট থেকেই কার্যকর। ক্রেডেনশিয়াল ঘরগুলো নিরাপত্তার জন্য খালি দেখানো হচ্ছে; পেজ আবার লোড করলে কোন চ্যানেল প্রস্তুত তা দেখা যাবে।`,
      );
      setSecretInputs({
        "slack.webhook_url": "",
        "telegram.bot_token": "",
        "sheets.service_account_json": "",
      });
    } catch {
      setStatusOk(false);
      setStatus("সার্ভারের সঙ্গে যোগাযোগ করা যায়নি — কোন সেটিং সেভ হয়েছে তা নিশ্চিত নয়; পেজটি আবার লোড করে যাচাই করুন।");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(channel: ConnectorChannel) {
    setTesting(channel);
    try {
      const res = await fetch("/api/v1/admin/connectors/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: { message?: string };
        error?: { code?: string; message?: string };
      };
      const message = res.ok
        ? (data.data?.message ?? "টেস্ট পাঠানো হয়েছে।")
        : (data.error?.message ?? `টেস্ট ব্যর্থ (${res.status})`);
      setTestResults((prev) => ({ ...prev, [channel]: message }));
      setAttempts((prev) =>
        [
          {
            at: new Date().toISOString(),
            channel,
            event: "test" as const,
            status: res.ok
              ? ("sent" as const)
              : data.error?.code === "NOT_CONFIGURED"
                ? ("not_configured" as const)
                : ("failed" as const),
            ...(res.ok
              ? {}
              : { errorCode: (data.error?.code ?? "error").toLowerCase() }),
            detail: message,
          },
          ...prev,
        ].slice(0, 15),
      );
    } catch {
      setTestResults((prev) => ({ ...prev, [channel]: "সার্ভারের সঙ্গে যোগাযোগ করা যায়নি।" }));
    } finally {
      setTesting(null);
    }
  }

  const inputClass =
    "mt-1 block min-h-[44px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100";

  function secretField(
    channel: ConnectorChannel,
    field: string,
    label: string,
    help: string,
  ) {
    const id = `${channel}.${field}`;
    const present = initial[channel].present[field] === true;
    return (
      <label className="block">
        <span className="text-sm font-medium">
          {label}
          {present ? (
            <span className="ml-2 text-xs font-normal text-emerald-700">
              সেট আছে — বদলাতে চাইলে নতুন মান লিখুন
            </span>
          ) : (
            <span className="ml-2 text-xs font-normal text-rose-600">সেট নেই</span>
          )}
        </span>
        <input
          type="password"
          value={secretInputs[id] ?? ""}
          onChange={(e) => setSecretInputs((prev) => ({ ...prev, [id]: e.target.value }))}
          disabled={saving}
          autoComplete="off"
          placeholder="••••••••"
          className={inputClass}
        />
        <span className="mt-1 block text-xs leading-relaxed text-text-muted">{help}</span>
      </label>
    );
  }

  function plainField(channel: ConnectorChannel, field: string, label: string, help?: string) {
    const id = `${channel}.${field}`;
    return (
      <label className="block">
        <span className="text-sm font-medium">{label}</span>
        <input
          type="text"
          value={plainInputs[id] ?? ""}
          onChange={(e) => setPlainInputs((prev) => ({ ...prev, [id]: e.target.value }))}
          disabled={saving}
          autoComplete="off"
          className={inputClass}
        />
        {help && (
          <span className="mt-1 block text-xs leading-relaxed text-text-muted">{help}</span>
        )}
      </label>
    );
  }

  function eventsFieldset(channel: "slack" | "telegram") {
    return (
      <fieldset className="mt-4">
        <legend className="text-sm font-medium">কোন ইভেন্টে পাঠানো হবে</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {EVENT_DEFS.map((def) => (
            <label key={def.name} className="flex min-h-[44px] items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={events[channel].has(def.name)}
                onChange={(e) =>
                  setEvents((prev) => {
                    const next = new Set(prev[channel]);
                    if (e.target.checked) next.add(def.name);
                    else next.delete(def.name);
                    return { ...prev, [channel]: next };
                  })
                }
                disabled={saving}
                className="h-5 w-5"
              />
              <span>{def.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  function channelShell(channel: ConnectorChannel, children: React.ReactNode) {
    const configuredNow = channelConfigured(channel, initial[channel]);
    return (
      <fieldset key={channel} className="mt-8 rounded-xl border border-border p-4">
        <legend className="px-1 text-sm font-semibold text-text-main">
          {CHANNEL_TITLES[channel]}{" "}
          <span
            className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${
              configuredNow ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
            }`}
          >
            {configuredNow ? "প্রস্তুত (আসল সংযোগ)" : "প্রস্তুত নয়"}
          </span>
        </legend>
        <label className="mt-2 flex min-h-[44px] items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={enabled[channel]}
            onChange={(e) => setEnabled((prev) => ({ ...prev, [channel]: e.target.checked }))}
            disabled={saving}
            className="h-5 w-5"
          />
          <span>এই চ্যানেল চালু রাখুন (enabled)</span>
        </label>
        {children}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleTest(channel)}
            disabled={testing !== null}
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testing === channel ? "টেস্ট পাঠানো হচ্ছে…" : "টেস্ট পাঠান (আসল কল)"}
          </button>
          {testResults[channel] && (
            <span role="status" className="text-sm leading-relaxed text-text-muted">
              {testResults[channel]}
            </span>
          )}
        </div>
      </fieldset>
    );
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-card">
      <div className="brand-gradient h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="bell" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">আউটবাউন্ড কানেক্টর</h2>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-sm">
          <p className="leading-relaxed">
            প্রতিটি চ্যানেল আলাদাভাবে কনফিগার হয়। চ্যানেল তখনই &quot;প্রস্তুত&quot; যখন সেটি চালু
            (enabled) থাকে এবং সব ক্রেডেনশিয়াল ঘর পূর্ণ থাকে। প্রস্তুত না থাকলে ইভেন্টের সময়
            NOT_CONFIGURED হিসেবে লেজারে রেকর্ড হয় — কোনো বার্তা পাঠানো হয়েছে বলে দাবি করা হয় না।
            ফোন নম্বর সবসময় মাস্ক করে পাঠানো হয়; ঠিকানা কখনো পাঠানো হয় না।
          </p>
          {!dbReady && (
            <span className="mt-1.5 block leading-relaxed text-rose-600">
              সতর্কতা: ডাটাবেস থেকে বর্তমান মান পড়া যায়নি — খালি/ডিফল্ট অবস্থা দেখানো হচ্ছে। সেভ করলে সার্ভার ত্রুটি দেখালে কিছুই বদলাবে না।
            </span>
          )}
        </div>

        {channelShell(
          "slack",
          <>
            <div className="mt-3 grid gap-5 md:grid-cols-2">
              {secretField(
                "slack",
                "webhook_url",
                "Incoming Webhook URL",
                "Slack অ্যাপের Incoming Webhooks থেকে পাওয়া URL। URL-টাই ক্রেডেনশিয়াল — এনক্রিপ্ট হয়ে থাকে, কখনো দেখানো হয় না; খালি রাখলে আগের মানই থাকবে।",
              )}
            </div>
            {eventsFieldset("slack")}
          </>,
        )}

        {channelShell(
          "telegram",
          <>
            <div className="mt-3 grid gap-5 md:grid-cols-2">
              {secretField(
                "telegram",
                "bot_token",
                "Bot Token",
                "@BotFather থেকে পাওয়া টোকেন। এনক্রিপ্ট হয়ে থাকে, লগে বা রিপোর্টে কখনো লেখা হয় না; খালি রাখলে আগের মানই থাকবে।",
              )}
              {plainField(
                "telegram",
                "chat_id",
                "Chat ID",
                "যে চ্যাট/গ্রুপে বার্তা যাবে তার আইডি (যেমন: -1001234567890)। বটকে আগে ওই চ্যাটে যোগ করতে হবে।",
              )}
              {plainField(
                "telegram",
                "api_base",
                "API Base (অ্যাডভান্সড)",
                "সাধারণত https://api.telegram.org — নিজস্ব Bot API সার্ভার বা টেস্টের জন্য বদলানো যায়।",
              )}
            </div>
            {eventsFieldset("telegram")}
          </>,
        )}

        {channelShell(
          "sheets",
          <>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              Google Sheets শুধু <strong>নতুন অর্ডারে (order.created)</strong> একটি সারি যোগ করে —
              শিটটি অর্ডার লগ; স্ট্যাটাস বদলের চ্যাট-বার্তা Slack/Telegram-এ যায়। সার্ভিস
              অ্যাকাউন্টটিকে আগে স্প্রেডশিটে Editor হিসেবে শেয়ার করতে হবে।
              {initial.sheets.serviceAccountEmail && (
                <>
                  {" "}
                  সংরক্ষিত সার্ভিস অ্যাকাউন্ট: <code>{initial.sheets.serviceAccountEmail}</code>
                  {initial.sheets.serviceAccountValid === false && (
                    <span className="text-rose-600"> (JSON-টি পড়া যাচ্ছে না — নতুন করে বসান)</span>
                  )}
                </>
              )}
            </p>
            <div className="mt-3 grid gap-5 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium">
                  Service Account JSON
                  {initial.sheets.present.service_account_json ? (
                    <span className="ml-2 text-xs font-normal text-emerald-700">
                      সেট আছে — বদলাতে চাইলে নতুন JSON বসান
                    </span>
                  ) : (
                    <span className="ml-2 text-xs font-normal text-rose-600">সেট নেই</span>
                  )}
                </span>
                <textarea
                  value={secretInputs["sheets.service_account_json"] ?? ""}
                  onChange={(e) =>
                    setSecretInputs((prev) => ({
                      ...prev,
                      "sheets.service_account_json": e.target.value,
                    }))
                  }
                  disabled={saving}
                  autoComplete="off"
                  rows={4}
                  placeholder='{"type":"service_account","client_email":"...","private_key":"..."}'
                  className={`${inputClass} font-mono text-xs`}
                />
                <span className="mt-1 block text-xs leading-relaxed text-text-muted">
                  পুরো JSON ফাইলটি বসান — প্রাইভেট কীসহ এনক্রিপ্ট হয়ে থাকে, কখনো দেখানো হয় না;
                  খালি রাখলে আগের মানই থাকবে।
                </span>
              </label>
              <div className="grid gap-5">
                {plainField("sheets", "spreadsheet_id", "Spreadsheet ID", "শিটের URL-এর মাঝের দীর্ঘ আইডি অংশটি।")}
                {plainField("sheets", "sheet_name", "Sheet-এর নাম", "যেমন: Orders — এই ট্যাবে সারি যোগ হবে।")}
              </div>
            </div>
          </>,
        )}

        <div className="mt-8 rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-sm leading-relaxed">
          <strong>Zapier / Make:</strong> এদের জন্য আলাদা কানেক্টর লাগে না — এরা generic
          ওয়েবহুক (webhook) ব্যবহার করে। ওয়েবহুক সেটিংস থেকে ইভেন্ট সাবস্ক্রাইব করে
          Zapier/Make-এর দেওয়া webhook URL বসালেই অর্ডার ইভেন্ট সরাসরি সেখানে পৌঁছাবে।
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-text-main">সাম্প্রতিক প্রচেষ্টা (লেজার)</h3>
          {attempts.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">
              এখনো কোনো প্রচেষ্টা রেকর্ড হয়নি — চ্যানেল চালু করে টেস্ট পাঠালে বা অর্ডার ইভেন্ট
              ঘটলে এখানে দেখা যাবে।
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
              {attempts.map((a, i) => (
                <li key={`${a.at}-${i}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      a.status === "sent"
                        ? "bg-emerald-100 text-emerald-800"
                        : a.status === "not_configured"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-rose-100 text-rose-800"
                    }`}
                  >
                    {a.status}
                  </span>
                  <span className="font-medium">{CHANNEL_TITLES[a.channel]}</span>
                  <span className="text-text-muted">{a.event}</span>
                  <span className="text-xs text-text-muted">
                    {new Date(a.at).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })}
                  </span>
                  {a.errorCode && <code className="text-xs text-rose-700">{a.errorCode}</code>}
                  {a.detail && <span className="w-full text-xs leading-relaxed text-text-muted">{a.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-3">
          <label className="block grow basis-56">
            <span className="text-sm font-medium">পরিবর্তনের কারণ (অডিটের জন্য আবশ্যিক)</span>
            <input
              type="text"
              placeholder="যেমন: টিমের Slack চ্যানেলে অর্ডার অ্যালার্ট চালু করা হলো"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              className="mt-1 block min-h-[44px] w-full max-w-md rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="brand-gradient inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "সেভ হচ্ছে…" : "সেটিংস সেভ করুন"}
          </button>
        </div>

        {status && (
          <div
            role="status"
            className={`anim-pop-in mt-4 flex items-start gap-3 rounded-lg border px-4 py-3.5 text-sm ${
              statusOk ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                statusOk ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
              }`}
            >
              <Icon name={statusOk ? "check" : "alert"} size={16} />
            </span>
            <p className="leading-relaxed">{status}</p>
          </div>
        )}
      </div>
    </section>
  );
}

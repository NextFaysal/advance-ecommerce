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
import { useLocale } from "@/i18n/LocaleProvider";
import { intlLocale, interpolate, pick } from "@/i18n/locale";
import { SETTINGS_B_STRINGS, type SettingsBStrings } from "../strings-b";

type SKey = keyof SettingsBStrings;

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

const EVENT_DEFS: { name: string; labelKey: SKey }[] = [
  { name: "order.created", labelKey: "connEvOrderCreated" },
  { name: "order.status_changed", labelKey: "connEvStatus" },
  { name: "payment.succeeded", labelKey: "connEvPayment" },
  { name: "stock.low", labelKey: "connEvStock" },
];

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
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
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
    return data.error?.message ?? interpolate(s.saveFailedStatus, { status: res.status });
  }

  async function handleSave() {
    setStatus("");
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus(s.reasonRequired);
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
      setStatus(s.noChanges);
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
              ? interpolate(s.partialSave, { key: w.key, failure, count: savedKeys.length, keys: savedKeys.join(", ") })
              : interpolate(s.singleSaveFailed, { key: w.key, failure }),
          );
          return;
        }
        savedKeys.push(w.key);
      }
      setStatusOk(true);
      setStatus(interpolate(s.connSavedMany, { count: savedKeys.length }));
      setSecretInputs({
        "slack.webhook_url": "",
        "telegram.bot_token": "",
        "sheets.service_account_json": "",
      });
    } catch {
      setStatusOk(false);
      setStatus(s.networkUncertainSettings);
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
        ? (data.data?.message ?? s.connTestSent)
        : (data.error?.message ?? interpolate(s.connTestFailed, { status: res.status }));
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
      setTestResults((prev) => ({ ...prev, [channel]: s.networkOnly }));
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
            <span className="ml-2 text-xs font-normal text-emerald-700">{s.secretSet}</span>
          ) : (
            <span className="ml-2 text-xs font-normal text-rose-600">{s.secretNotSet}</span>
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
        <legend className="text-sm font-medium">{s.connEventsLegend}</legend>
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
              <span>{s[def.labelKey]} · {def.name}</span>
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
            {configuredNow ? s.readyRealConn : s.notReady}
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
          <span>{s.connEnabledChannel}</span>
        </label>
        {children}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleTest(channel)}
            disabled={testing !== null}
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {testing === channel ? s.connTesting : s.connTest}
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
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
      <div className="bg-brand-600 h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="bg-brand-soft flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-brand-ink shadow-md">
            <Icon name="bell" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">{s.connCardTitle}</h2>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-sm">
          <p className="leading-relaxed">{s.connIntro}</p>
          {!dbReady && <span className="mt-1.5 block leading-relaxed text-rose-600">{s.dbWarning}</span>}
        </div>

        {channelShell(
          "slack",
          <>
            <div className="mt-3 grid gap-5 md:grid-cols-2">
              {secretField(
                "slack",
                "webhook_url",
                "Incoming Webhook URL",
                s.connSlackHelp,
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
                s.connBotHelp,
              )}
              {plainField(
                "telegram",
                "chat_id",
                "Chat ID",
                s.connChatHelp,
              )}
              {plainField(
                "telegram",
                "api_base",
                "API Base",
                s.connApiBaseHelp,
              )}
            </div>
            {eventsFieldset("telegram")}
          </>,
        )}

        {channelShell(
          "sheets",
          <>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">
              {s.connSheetsIntroA}
              <strong>{s.connSheetsIntroStrong}</strong>
              {s.connSheetsIntroB}
              {initial.sheets.serviceAccountEmail && (
                <>
                  {s.connSheetsAccount}
                  <code>{initial.sheets.serviceAccountEmail}</code>
                  {initial.sheets.serviceAccountValid === false && (
                    <span className="text-rose-600">{s.connSheetsInvalid}</span>
                  )}
                </>
              )}
            </p>
            <div className="mt-3 grid gap-5 md:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium">
                  Service Account JSON
                  {initial.sheets.present.service_account_json ? (
                    <span className="ml-2 text-xs font-normal text-emerald-700">{s.connServiceJsonSet}</span>
                  ) : (
                    <span className="ml-2 text-xs font-normal text-rose-600">{s.secretNotSet}</span>
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
                <span className="mt-1 block text-xs leading-relaxed text-text-muted">{s.connServiceJsonHelp}</span>
              </label>
              <div className="grid gap-5">
                {plainField("sheets", "spreadsheet_id", "Spreadsheet ID", s.connSpreadsheetHelp)}
                {plainField("sheets", "sheet_name", "Sheet Name", s.connSheetNameHelp)}
              </div>
            </div>
          </>,
        )}

        <div className="mt-8 rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-sm leading-relaxed">
          <strong>{s.connZapierA}</strong>
          {s.connZapierB}
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-text-main">{s.connLedgerTitle}</h3>
          {attempts.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">{s.connLedgerEmpty}</p>
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
                    {new Date(a.at).toLocaleString(intlLocale(locale), { timeZone: "Asia/Dhaka" })}
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
            <span className="text-sm font-medium">{s.reasonRequiredShort}</span>
            <input
              type="text"
              placeholder={s.connReasonPlaceholder}
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
            {saving ? s.saving : s.saveSettings}
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

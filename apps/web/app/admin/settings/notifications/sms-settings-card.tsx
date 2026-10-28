"use client";

// SMS gateway settings card — Settings > Notifications (ADV-2, doc 22).
// Edits the keys src/integrations/sms-resolver.ts reads at send time:
//   sms.provider, sms.fallback_provider, sms.sender_id
//   sms.<provider>.enabled, sms.<provider>.api_key / api_token / token /
//   sid (secrets, encrypted at rest), sms.bulksmsbd.sender_id.
//
// Write-only secrets: the server sends this component only PRESENCE
// booleans for credential fields — never a value. A credential input
// left blank means "keep the stored value"; it is only written when
// the admin types a new one. Saves go through the standard Settings
// API (POST /api/v1/admin/settings { key, value, reason }), so every
// change is audited and a reason is required. Only changed keys are
// written — saving an untouched form is a true no-op.
//
// The "ব্যালেন্স যাচাই" button calls POST /api/v1/admin/settings/test
// { category: "sms", provider }, which performs a REAL balance call
// through the named provider's adapter (never the fallback, never
// faked): the balance comes back in poisha and is shown as taka.
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import type { SmsProviderName } from "@/integrations/sms";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_B_STRINGS, type SettingsBStrings } from "../strings-b";

type SKey = keyof SettingsBStrings;

/** Localized label for a provider field def (labels are UI copy). */
function fieldLabel(def: { key: string; label: string }, s: SettingsBStrings): string {
  if (def.key === "sender_id") return s.smsFieldSenderProvider;
  return def.label; // API Key / API Token / SID — technical names, same in both locales
}

export const SMS_FIELD_DEFS: Record<
  SmsProviderName,
  { key: string; label: string; secret: boolean }[]
> = {
  bulksmsbd: [
    { key: "api_key", label: "API Key", secret: true },
    { key: "sender_id", label: "sender_id", secret: false },
  ],
  sslwireless: [
    { key: "api_token", label: "API Token", secret: true },
    { key: "sid", label: "SID", secret: true },
  ],
  greenweb: [{ key: "token", label: "API Token", secret: true }],
};

const PROVIDER_LABELS: Record<SmsProviderName, string> = {
  bulksmsbd: "BulkSMSBD",
  sslwireless: "SSL Wireless (SMSPlus)",
  greenweb: "GreenWeb",
};

const PROVIDER_NAMES = Object.keys(PROVIDER_LABELS) as SmsProviderName[];

export interface SmsProviderInitial {
  enabled: boolean;
  /** Presence booleans per field key — never values. */
  present: Record<string, boolean>;
  /** bulksmsbd's own sender_id (a public sender identity, not a secret). */
  senderId: string;
}

export interface SmsSettingsInitial {
  activeProvider: string;
  fallbackProvider: string;
  senderId: string;
  providers: Record<SmsProviderName, SmsProviderInitial>;
}

interface SmsSettingsCardProps {
  initial: SmsSettingsInitial;
  dbReady: boolean;
}

/** A provider routes real sends iff enabled AND every required field
 *  is present — mirrors diagnoseSmsProvider in sms-resolver.ts. The
 *  sender_id field is optional for bulksmsbd, so it is excluded here. */
function providerConfigured(
  name: SmsProviderName,
  state: { enabled: boolean; present: Record<string, boolean> },
): boolean {
  if (!state.enabled) return false;
  const required = SMS_FIELD_DEFS[name].filter((f) => f.key !== "sender_id");
  return required.every((f) => state.present[f.key] === true);
}

export function SmsSettingsCard({ initial, dbReady }: SmsSettingsCardProps) {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  const [activeProvider, setActiveProvider] = useState(initial.activeProvider);
  const [fallbackProvider, setFallbackProvider] = useState(initial.fallbackProvider);
  const [senderId, setSenderId] = useState(initial.senderId);
  const [enabled, setEnabled] = useState<Record<SmsProviderName, boolean>>(() => {
    const out = {} as Record<SmsProviderName, boolean>;
    for (const name of PROVIDER_NAMES) out[name] = initial.providers[name].enabled;
    return out;
  });
  // Credential inputs start EMPTY (write-only); bulksmsbd sender_id is
  // a plain value and starts from the stored one.
  const [fieldInputs, setFieldInputs] = useState<Record<string, string>>(() => ({
    "bulksmsbd.sender_id": initial.providers.bulksmsbd.senderId,
  }));
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<SmsProviderName | null>(null);
  const [testResults, setTestResults] = useState<Record<string, string>>({});

  const effectiveActive = activeProvider === "" ? "bulksmsbd" : (activeProvider as SmsProviderName);
  const activeConfigured = providerConfigured(effectiveActive, {
    enabled: initial.providers[effectiveActive].enabled,
    present: initial.providers[effectiveActive].present,
  });
  const fallbackConfigured =
    fallbackProvider !== "" &&
    fallbackProvider !== effectiveActive &&
    providerConfigured(fallbackProvider as SmsProviderName, {
      enabled: initial.providers[fallbackProvider as SmsProviderName].enabled,
      present: initial.providers[fallbackProvider as SmsProviderName].present,
    });
  const routingLabel = activeConfigured
    ? interpolate(s.smsRouteActive, { provider: PROVIDER_LABELS[effectiveActive] })
    : fallbackConfigured
      ? interpolate(s.smsRouteFallback, { provider: PROVIDER_LABELS[fallbackProvider as SmsProviderName] })
      : s.smsRouteSandbox;

  function fieldId(name: SmsProviderName, key: string): string {
    return `${name}.${key}`;
  }

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
    if (activeProvider !== initial.activeProvider) {
      writes.push({ key: "sms.provider", value: activeProvider });
    }
    if (fallbackProvider !== initial.fallbackProvider) {
      writes.push({ key: "sms.fallback_provider", value: fallbackProvider });
    }
    if (senderId !== initial.senderId) {
      writes.push({ key: "sms.sender_id", value: senderId });
    }
    for (const name of PROVIDER_NAMES) {
      if (enabled[name] !== initial.providers[name].enabled) {
        writes.push({ key: `sms.${name}.enabled`, value: enabled[name] ? "true" : "false" });
      }
      for (const def of SMS_FIELD_DEFS[name]) {
        const raw = fieldInputs[fieldId(name, def.key)] ?? "";
        if (def.secret) {
          // Write-only: blank keeps the stored credential.
          if (raw.trim() !== "") writes.push({ key: `sms.${name}.${def.key}`, value: raw.trim() });
        } else if (def.key === "sender_id") {
          if (raw !== initial.providers[name].senderId) {
            writes.push({ key: `sms.${name}.sender_id`, value: raw });
          }
        }
      }
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
      setStatus(interpolate(s.smsSavedMany, { count: savedKeys.length }));
      setFieldInputs((prev) => {
        const next = { ...prev };
        for (const name of PROVIDER_NAMES) {
          for (const def of SMS_FIELD_DEFS[name]) {
            if (def.secret) next[fieldId(name, def.key)] = "";
          }
        }
        return next;
      });
    } catch {
      setStatusOk(false);
      setStatus(s.networkUncertainSettings);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(name: SmsProviderName) {
    setTesting(name);
    try {
      const res = await fetch("/api/v1/admin/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: "sms", provider: name }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: { balancePoisha?: number; message?: string };
        error?: { message?: string };
      };
      if (res.ok && data.data) {
        const taka =
          typeof data.data.balancePoisha === "number"
            ? (data.data.balancePoisha / 100).toFixed(2)
            : "?";
        setTestResults((prev) => ({
          ...prev,
          [name]: interpolate(s.smsBalanceOk, { taka }),
        }));
      } else {
        setTestResults((prev) => ({
          ...prev,
          [name]: data.error?.message ?? interpolate(s.smsTestFailed, { status: res.status }),
        }));
      }
    } catch {
      setTestResults((prev) => ({ ...prev, [name]: s.networkOnly }));
    } finally {
      setTesting(null);
    }
  }

  const inputClass =
    "mt-1 block min-h-[44px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100";
  const selectClass = inputClass;

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
      <div className="brand-gradient h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="phone" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">{s.smsTitle}</h2>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-sm">
          <p className="leading-relaxed">
            {s.smsRoutingPrefix}
            <strong>{routingLabel}</strong>
          </p>
          {!dbReady && <span className="mt-1.5 block leading-relaxed text-rose-600">{s.smsDbWarning}</span>}
          <span className="mt-1.5 block leading-relaxed text-text-muted">{s.smsReadyExplain}</span>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium">{s.smsActiveProvider}</span>
            <select
              value={activeProvider}
              onChange={(e) => setActiveProvider(e.target.value)}
              disabled={saving}
              className={selectClass}
            >
              <option value="">{s.smsNoProvider}</option>
              {PROVIDER_NAMES.map((name) => (
                <option key={name} value={name}>
                  {PROVIDER_LABELS[name]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">{s.smsFallbackProvider}</span>
            <select
              value={fallbackProvider}
              onChange={(e) => setFallbackProvider(e.target.value)}
              disabled={saving}
              className={selectClass}
            >
              <option value="">{s.smsNone}</option>
              {PROVIDER_NAMES.map((name) => (
                <option key={name} value={name}>
                  {PROVIDER_LABELS[name]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs leading-relaxed text-text-muted">{s.smsFallbackHelp}</span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">{s.smsSenderId}</span>
            <input
              type="text"
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              disabled={saving}
              placeholder={s.smsSenderPlaceholder}
              className={inputClass}
            />
            <span className="mt-1 block text-xs leading-relaxed text-text-muted">{s.smsSenderHelp}</span>
          </label>
        </div>

        {PROVIDER_NAMES.map((name) => {
          const providerInitial = initial.providers[name];
          const configuredNow = providerConfigured(name, {
            enabled: providerInitial.enabled,
            present: providerInitial.present,
          });
          return (
            <fieldset key={name} className="mt-8 rounded-xl border border-border p-4">
              <legend className="px-1 text-sm font-semibold text-text-main">
                {PROVIDER_LABELS[name]}{" "}
                <span
                  className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                    configuredNow
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {configuredNow ? s.readyReal : s.notReady}
                </span>
              </legend>
              <label className="mt-2 flex min-h-[44px] items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={enabled[name]}
                  onChange={(e) =>
                    setEnabled((prev) => ({ ...prev, [name]: e.target.checked }))
                  }
                  disabled={saving}
                  className="h-5 w-5"
                />
                <span>{s.enabledLabel}</span>
              </label>
              <div className="mt-3 grid gap-5 md:grid-cols-2">
                {SMS_FIELD_DEFS[name].map((def) => {
                  const id = fieldId(name, def.key);
                  const present = providerInitial.present[def.key] === true;
                  return (
                    <label key={def.key} className="block">
                      <span className="text-sm font-medium">
                        {fieldLabel(def, s)}
                        {def.secret && present && (
                          <span className="ml-2 text-xs font-normal text-emerald-700">{s.secretSet}</span>
                        )}
                        {def.secret && !present && (
                          <span className="ml-2 text-xs font-normal text-rose-600">{s.secretNotSet}</span>
                        )}
                      </span>
                      <input
                        type={def.secret ? "password" : "text"}
                        value={fieldInputs[id] ?? ""}
                        onChange={(e) =>
                          setFieldInputs((prev) => ({ ...prev, [id]: e.target.value }))
                        }
                        disabled={saving}
                        autoComplete="off"
                        placeholder={def.secret ? "••••••••" : ""}
                        className={inputClass}
                      />
                      {def.secret && (
                        <span className="mt-1 block text-xs leading-relaxed text-text-muted">{s.secretNeverShown}</span>
                      )}
                    </label>
                  );
                })}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleTest(name)}
                  disabled={testing !== null}
                  className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {testing === name ? s.smsTesting : s.smsTestBalance}
                </button>
                {testResults[name] && (
                  <span role="status" className="text-sm leading-relaxed text-text-muted">
                    {testResults[name]}
                  </span>
                )}
              </div>
            </fieldset>
          );
        })}

        <div className="mt-6 flex flex-wrap items-end gap-3">
          <label className="block grow basis-56">
            <span className="text-sm font-medium">{s.reasonRequiredShort}</span>
            <input
              type="text"
              placeholder={s.smsReasonPlaceholder}
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

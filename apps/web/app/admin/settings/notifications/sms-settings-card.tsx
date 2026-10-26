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

export const SMS_FIELD_DEFS: Record<
  SmsProviderName,
  { key: string; label: string; secret: boolean }[]
> = {
  bulksmsbd: [
    { key: "api_key", label: "API Key", secret: true },
    { key: "sender_id", label: "Sender ID (শুধু এই প্রোভাইডারের জন্য)", secret: false },
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
    ? `আসল গেটওয়ে: ${PROVIDER_LABELS[effectiveActive]} দিয়ে SMS যাবে।`
    : fallbackConfigured
      ? `সক্রিয় প্রোভাইডার প্রস্তুত নয় — ফলব্যাক ${PROVIDER_LABELS[fallbackProvider as SmsProviderName]} দিয়ে আসল SMS যাবে।`
      : "কোনো গেটওয়ে প্রস্তুত নয় — SMS sandbox simulator দিয়ে যাবে (simulated হিসেবে চিহ্নিত থাকবে)।";

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
        `সেভ হয়েছে — ${savedKeys.length}টি সেটিং বদলেছে। নতুন মান পরের SMS পাঠানোর মুহূর্ত থেকেই কার্যকর। ক্রেডেনশিয়াল ঘরগুলো নিরাপত্তার জন্য খালি দেখানো হচ্ছে; পেজ আবার লোড করলে কোন প্রোভাইডার প্রস্তুত তা দেখা যাবে।`,
      );
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
      setStatus("সার্ভারের সঙ্গে যোগাযোগ করা যায়নি — কোন সেটিং সেভ হয়েছে তা নিশ্চিত নয়; পেজটি আবার লোড করে যাচাই করুন।");
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
          [name]: `সংযোগ সফল — বর্তমান ব্যালেন্স ৳${taka} (আসল প্রোভাইডার কল)।`,
        }));
      } else {
        setTestResults((prev) => ({
          ...prev,
          [name]: data.error?.message ?? `যাচাই করা যায়নি (${res.status})`,
        }));
      }
    } catch {
      setTestResults((prev) => ({ ...prev, [name]: "সার্ভারের সঙ্গে যোগাযোগ করা যায়নি।" }));
    } finally {
      setTesting(null);
    }
  }

  const inputClass =
    "mt-1 block min-h-[44px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100";
  const selectClass = inputClass;

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-card">
      <div className="brand-gradient h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="phone" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">SMS গেটওয়ে</h2>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-sm">
          <p className="leading-relaxed">
            সংরক্ষিত অবস্থা অনুযায়ী বর্তমান রাউটিং: <strong>{routingLabel}</strong>
          </p>
          {!dbReady && (
            <span className="mt-1.5 block leading-relaxed text-rose-600">
              সতর্কতা: ডাটাবেস থেকে বর্তমান মান পড়া যায়নি — খালি/ডিফল্ট অবস্থা দেখানো হচ্ছে। সেভ করলে সার্ভার ত্রুটি দেখালে কিছুই বদলাবে না।
            </span>
          )}
          <span className="mt-1.5 block leading-relaxed text-text-muted">
            প্রোভাইডার তখনই &quot;প্রস্তুত&quot; যখন সেটি চালু (enabled) থাকে এবং সব ক্রেডেনশিয়াল ঘর পূর্ণ থাকে।
            পাঠাতে ব্যর্থ হলে SMS queue-তে retry হয় এবং শেষ পর্যন্ত dead-letter-এ যায় — নীরবে হারিয়ে যায় না।
          </span>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium">সক্রিয় প্রোভাইডার</span>
            <select
              value={activeProvider}
              onChange={(e) => setActiveProvider(e.target.value)}
              disabled={saving}
              className={selectClass}
            >
              <option value="">— সেট করা নেই (ডিফল্ট BulkSMSBD)</option>
              {PROVIDER_NAMES.map((name) => (
                <option key={name} value={name}>
                  {PROVIDER_LABELS[name]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">ফলব্যাক প্রোভাইডার</span>
            <select
              value={fallbackProvider}
              onChange={(e) => setFallbackProvider(e.target.value)}
              disabled={saving}
              className={selectClass}
            >
              <option value="">— নেই</option>
              {PROVIDER_NAMES.map((name) => (
                <option key={name} value={name}>
                  {PROVIDER_LABELS[name]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs leading-relaxed text-text-muted">
              সক্রিয় প্রোভাইডার প্রস্তুত না থাকলে প্রস্তুত ফলব্যাক দিয়ে যাবে।
            </span>
          </label>
          <label className="block">
            <span className="text-sm font-medium">সাধারণ Sender ID</span>
            <input
              type="text"
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
              disabled={saving}
              placeholder="যেমন: 8809612XXXXXX বা ব্র্যান্ড নাম"
              className={inputClass}
            />
            <span className="mt-1 block text-xs leading-relaxed text-text-muted">
              প্রোভাইডার-নির্দিষ্ট Sender ID না থাকলে এটি ব্যবহৃত হয় (BulkSMSBD)।
            </span>
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
                  {configuredNow ? "প্রস্তুত (আসল গেটওয়ে)" : "প্রস্তুত নয়"}
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
                <span>এই প্রোভাইডার চালু রাখুন (enabled)</span>
              </label>
              <div className="mt-3 grid gap-5 md:grid-cols-2">
                {SMS_FIELD_DEFS[name].map((def) => {
                  const id = fieldId(name, def.key);
                  const present = providerInitial.present[def.key] === true;
                  return (
                    <label key={def.key} className="block">
                      <span className="text-sm font-medium">
                        {def.label}
                        {def.secret && present && (
                          <span className="ml-2 text-xs font-normal text-emerald-700">
                            সেট আছে — বদলাতে চাইলে নতুন মান লিখুন
                          </span>
                        )}
                        {def.secret && !present && (
                          <span className="ml-2 text-xs font-normal text-rose-600">সেট নেই</span>
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
                        <span className="mt-1 block text-xs leading-relaxed text-text-muted">
                          মান কখনো দেখানো হয় না; খালি রাখলে আগের মানই থাকবে।
                        </span>
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
                  {testing === name ? "যাচাই হচ্ছে…" : "ব্যালেন্স যাচাই করুন (আসল কল)"}
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
            <span className="text-sm font-medium">পরিবর্তনের কারণ (অডিটের জন্য আবশ্যিক)</span>
            <input
              type="text"
              placeholder="যেমন: BulkSMSBD লাইভ অ্যাকাউন্টের API key বসানো হলো"
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

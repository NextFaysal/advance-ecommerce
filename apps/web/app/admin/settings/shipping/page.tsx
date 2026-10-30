"use client";

// Admin > Settings > Shipping — per-courier REAL credential forms.
//
// Each provider section writes the exact Settings keys its live
// resolver reads (src/integrations/<provider>-resolver.ts):
//   courier.<provider>.enabled + courier.<provider>.<field>
// Secret fields (suffix rule in src/lib/settings.isSecretSettingKey)
// are encrypted at rest by the Settings API and are NEVER returned —
// the inputs are write-only: blank = keep the saved value, typing
// replaces it. Plain fields (client_id, username, store_id, user_id)
// come back in GET /api/v1/admin/settings -> integrationValues and
// are prefilled. The per-provider `configured` flag from that same GET
// drives the honest status line: live only when enabled AND the
// credential set is present; otherwise bookings stay on the
// sandbox/manual path and the UI says so.
//
// Save/Test call the Settings API contract:
//   GET  /api/v1/admin/settings
//   POST /api/v1/admin/settings       { key, value, reason }
//   POST /api/v1/admin/settings/test  { category: "courier", provider }
// Zones: Inside Dhaka / Outside Dhaka / district.
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_STRINGS, type SettingsStrings } from "../strings";
import { PageHeader } from "@/components/ui/page-header";

const inputCls =
  "mt-1 block w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-text-main shadow-xs focus:border-ring focus:outline-none";
const zoneInputCls =
  "w-32 rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm text-text-main shadow-xs focus:border-ring focus:outline-none";
const saveBtnCls =
  "rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90";
const testBtnCls =
  "rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-text-main shadow-xs transition duration-fast hover:bg-surface-2";

const PROVIDERS = [
  { key: "steadfast", label: "Steadfast" },
  { key: "pathao", label: "Pathao" },
  { key: "redx", label: "RedX" },
  { key: "paperfly", label: "Paperfly" },
  { key: "ecourier", label: "eCourier" },
] as const;

type ProviderKey = (typeof PROVIDERS)[number]["key"];

interface FieldDef {
  suffix: string;
  labelKey: keyof SettingsStrings;
  secret: boolean;
}

// The credential set each live resolver requires/uses. webhook_secret
// is the HMAC secret the public webhook receiver verifies against
// (app/api/v1/public/couriers/webhook) — same key for every provider.
const PROVIDER_FIELDS: Record<ProviderKey, FieldDef[]> = {
  steadfast: [
    { suffix: "api_key", labelKey: "shipFApiKey", secret: true },
    { suffix: "secret_key", labelKey: "shipFSecretKey", secret: true },
    { suffix: "webhook_secret", labelKey: "shipFWebhookSecret", secret: true },
  ],
  pathao: [
    { suffix: "client_id", labelKey: "shipFClientId", secret: false },
    { suffix: "client_secret", labelKey: "shipFClientSecret", secret: true },
    { suffix: "username", labelKey: "shipFUsername", secret: false },
    { suffix: "password", labelKey: "shipFPassword", secret: true },
    { suffix: "store_id", labelKey: "shipFStoreId", secret: false },
    { suffix: "webhook_secret", labelKey: "shipFWebhookSecret", secret: true },
  ],
  redx: [
    { suffix: "access_token", labelKey: "shipFAccessToken", secret: true },
    { suffix: "webhook_secret", labelKey: "shipFWebhookSecret", secret: true },
  ],
  paperfly: [
    { suffix: "username", labelKey: "shipFUsername", secret: false },
    { suffix: "password", labelKey: "shipFPassword", secret: true },
    { suffix: "api_key", labelKey: "shipFApiKey", secret: true },
    { suffix: "webhook_secret", labelKey: "shipFWebhookSecret", secret: true },
  ],
  ecourier: [
    { suffix: "user_id", labelKey: "shipFUserId", secret: false },
    { suffix: "api_key", labelKey: "shipFApiKey", secret: true },
    { suffix: "api_secret", labelKey: "shipFApiSecret", secret: true },
    { suffix: "webhook_secret", labelKey: "shipFWebhookSecret", secret: true },
  ],
};

const ZONE_KEYS = ["inside_dhaka", "outside_dhaka", "district"] as const;

function zoneLabel(s: SettingsStrings, key: (typeof ZONE_KEYS)[number]): string {
  return { inside_dhaka: s.shipZoneInside, outside_dhaka: s.shipZoneOutside, district: s.shipZoneDistrict }[key];
}

interface SettingsLoad {
  values: Record<string, string>;
  configured: Record<string, boolean>;
}

async function postJson(url: string, body: Record<string, string>, s: SettingsStrings): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      data?: { message?: string };
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        message:
          res.status === 404
            ? s.shipApiMissing
            : (data.error?.message ?? interpolate(s.shipSaveFailed, { status: res.status })),
      };
    }
    return { ok: true, message: data.data?.message ?? s.shipSavedDot };
  } catch {
    return { ok: false, message: s.shipNetwork };
  }
}

function ProviderSection({
  providerKey,
  label,
  load,
  reload,
}: {
  providerKey: ProviderKey;
  label: string;
  load: SettingsLoad | null;
  reload: () => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  const fields = PROVIDER_FIELDS[providerKey];
  const [enabled, setEnabled] = useState(false);
  const [plain, setPlain] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Hydrate from the loaded settings whenever they (re)arrive.
  useEffect(() => {
    if (!load) return;
    setEnabled(load.values[`courier.${providerKey}.enabled`] === "true");
    const next: Record<string, string> = {};
    for (const f of fields) {
      if (!f.secret) next[f.suffix] = load.values[`courier.${providerKey}.${f.suffix}`] ?? "";
    }
    setPlain(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, providerKey]);

  const configured = load?.configured[providerKey] ?? false;
  const derivedStatus = !enabled ? s.shipOff : configured ? s.shipLiveReady : s.shipIncomplete;
  const status = message !== "" ? message : derivedStatus;

  async function handleSave() {
    const reason = interpolate(s.shipReasonCourier, { provider: providerKey });
    const entries: Array<[string, string]> = [[`courier.${providerKey}.enabled`, String(enabled)]];
    for (const f of fields) {
      const value = f.secret ? (secrets[f.suffix] ?? "") : (plain[f.suffix] ?? "");
      if (f.secret && value === "") continue; // blank secret = keep saved value
      entries.push([`courier.${providerKey}.${f.suffix}`, value]);
    }
    for (const [key, value] of entries) {
      const result = await postJson("/api/v1/admin/settings", { key, value, reason }, s);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
    }
    setSecrets({});
    setMessage(s.shipSaved);
    reload();
  }

  async function handleTest() {
    const result = await postJson("/api/v1/admin/settings/test", {
      category: "courier",
      provider: providerKey,
    }, s);
    setMessage(result.ok ? s.shipTestPassed : result.message);
  }

  return (
    <section className="rounded-3xl border border-border/60 bg-card p-5 shadow-card">
      <h2 className="font-display text-base font-semibold text-text-main">{label}</h2>
      <p className="mt-1 text-sm text-text-muted">{s.shipKeysFrom}</p>
      <div className="mt-4">
        <label className="flex items-center gap-2 text-sm font-medium text-text-main">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
          />
          {s.shipEnabled}
        </label>
      </div>
      <div className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.suffix} className="block text-xs font-semibold text-text-main">
            {s[f.labelKey]}
            <input
              type={f.secret ? "password" : "text"}
              placeholder={f.secret ? "••••••••" : ""}
              value={f.secret ? (secrets[f.suffix] ?? "") : (plain[f.suffix] ?? "")}
              onChange={(e) =>
                f.secret
                  ? setSecrets((v) => ({ ...v, [f.suffix]: e.target.value }))
                  : setPlain((v) => ({ ...v, [f.suffix]: e.target.value }))
              }
              autoComplete="off"
              className={inputCls}
            />
            {f.secret && <span className="mt-1 block font-normal text-text-muted">{s.shipSecretKeep}</span>}
          </label>
        ))}
      </div>
      <div className="mt-4 max-w-2xl">
        <p className="text-xs font-semibold text-text-main">{s.shipWebhook}</p>
        <p className="mt-1 break-all rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-text-muted">
          {origin}/api/v1/public/couriers/webhook?provider={providerKey}
        </p>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
        <p className="mr-auto text-sm text-text-muted">{s.shipStatusPrefix}{status}</p>
        <button type="button" onClick={handleSave} className={saveBtnCls}>
          {s.shipSave}
        </button>
        <button type="button" onClick={handleTest} className={testBtnCls}>
          {s.shipTest}
        </button>
      </div>
      <p className="mt-2 text-xs text-text-muted">{s.shipSaveThenTest}</p>
    </section>
  );
}

function ZonesSection() {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  const [charges, setCharges] = useState<Record<string, string>>({});
  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");

  async function handleSave() {
    for (const zoneKey of ZONE_KEYS) {
      const zone = { key: zoneKey };
      const charge = charges[zone.key] ?? "";
      const freeAbove = thresholds[zone.key] ?? "";
      if (charge !== "") {
        const result = await postJson("/api/v1/admin/settings", {
          key: `courier.${zone.key}.charge_poisha`,
          value: charge,
          reason: s.shipReasonCharge,
        }, s);
        if (!result.ok) {
          setStatus(result.message);
          return;
        }
      }
      if (freeAbove !== "") {
        const result = await postJson("/api/v1/admin/settings", {
          key: `courier.${zone.key}.free_above_poisha`,
          value: freeAbove,
          reason: s.shipReasonFree,
        }, s);
        if (!result.ok) {
          setStatus(result.message);
          return;
        }
      }
    }
    setStatus(s.shipSaved);
  }

  return (
    <section className="rounded-3xl border border-border/60 bg-card p-5 shadow-card">
      <h2 className="font-display text-base font-semibold text-text-main">{s.shipZonesTitle}</h2>
      <div className="mt-4 space-y-3">
        {ZONE_KEYS.map((zoneKey) => {
          const zone = { key: zoneKey, label: zoneLabel(s, zoneKey) };
          return (
            <div key={zone.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span className="w-36 shrink-0 font-medium text-text-main">{zone.label}</span>
              <label className="flex items-center gap-2 text-text-muted">
                {s.shipCharge}
                <input
                  type="number"
                  placeholder="0"
                  value={charges[zone.key] ?? ""}
                  onChange={(e) => setCharges((c) => ({ ...c, [zone.key]: e.target.value }))}
                  className={zoneInputCls}
                />
              </label>
              <label className="flex items-center gap-2 text-text-muted">
                {s.shipFreeAbove}
                <input
                  type="number"
                  placeholder="—"
                  value={thresholds[zone.key] ?? ""}
                  onChange={(e) => setThresholds((t) => ({ ...t, [zone.key]: e.target.value }))}
                  className={zoneInputCls}
                />
              </label>
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
        {status !== "" && <p className="mr-auto text-sm text-text-muted">{s.shipStatusPrefix}{status}</p>}
        <button type="button" onClick={handleSave} className={`${saveBtnCls} ml-auto`}>
          {s.shipSaveZones}
        </button>
      </div>
      <p className="mt-3 text-sm text-text-muted">{s.shipCodNote}</p>
    </section>
  );
}

export default function ShippingSettingsPage() {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  const [load, setLoad] = useState<SettingsLoad | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/settings");
      const data = (await res.json().catch(() => ({}))) as {
        data?: {
          integrationValues?: Record<string, string>;
          integrations?: { courier?: Array<{ provider: string; configured: boolean }> };
        };
      };
      const configured: Record<string, boolean> = {};
      for (const row of data.data?.integrations?.courier ?? []) configured[row.provider] = row.configured;
      setLoad({ values: data.data?.integrationValues ?? {}, configured });
    } catch {
      setLoad({ values: {}, configured: {} });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <main className="min-w-0">
      <PageHeader title={s.shipTitle} description={s.shipIntro} />
      <div className="space-y-6">
        {PROVIDERS.map((provider) => (
          <ProviderSection key={provider.key} providerKey={provider.key} label={provider.label} load={load} reload={reload} />
        ))}
        <ZonesSection />
      </div>
    </main>
  );
}

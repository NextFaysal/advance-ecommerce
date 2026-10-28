"use client";

// Admin > Settings > Shipping — Agent 5 shell, wired by Agent 9.
// Save/Test call the Settings API contract in
// src/integrations/sandbox/SETTINGS-API-CONTRACT.md:
//   POST /api/v1/admin/settings       { key, value, reason }
//   POST /api/v1/admin/settings/test  { category: "courier", provider }
// That API route does NOT exist yet (settings owner's file). If it is
// missing or rejects, this page shows the error — it never fakes success.
// Credential field is a REFERENCE only; the real credential lives in
// Settings, encrypted, server-side. Live mode requires a credential reference.
// Zones: Inside Dhaka / Outside Dhaka / district.
import { useState } from "react";
import { liveModeGuardMessage } from "../../../../src/integrations/sandbox/live-guard";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_STRINGS, type SettingsStrings } from "../strings";
import { PageHeader } from "@/components/ui/page-header";

const inputCls =
  "mt-1 block w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-text-main shadow-xs focus:border-ring focus:outline-none";
const inlineInputCls =
  "ml-2 rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-text-main shadow-xs focus:border-ring focus:outline-none";
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

const ZONE_KEYS = ["inside_dhaka", "outside_dhaka", "district"] as const;

function zoneLabel(s: SettingsStrings, key: (typeof ZONE_KEYS)[number]): string {
  return { inside_dhaka: s.shipZoneInside, outside_dhaka: s.shipZoneOutside, district: s.shipZoneDistrict }[key];
}

interface ProviderState {
  enabled: boolean;
  mode: "sandbox" | "live";
  credentialRef: string;
  status: string;
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

function ProviderSection({ providerKey, label }: { providerKey: ProviderKey; label: string }) {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  const [state, setState] = useState<ProviderState>({
    enabled: false,
    mode: "sandbox",
    credentialRef: "",
    status: "",
  });
  const status = state.status === "" ? s.shipNotConnected : state.status;
  const set = (patch: Partial<ProviderState>) => setState((s) => ({ ...s, ...patch }));

  async function handleSave() {
    if (state.mode === "live") {
      const guard = liveModeGuardMessage(state.credentialRef !== "", state.credentialRef || null);
      if (guard) {
        set({ status: guard });
        return;
      }
    }
    const entries: Array<[string, string]> = [
      [`courier.${providerKey}.enabled`, String(state.enabled)],
      [`courier.${providerKey}.mode`, state.mode],
      [`courier.${providerKey}.credential_ref`, state.credentialRef],
    ];
    for (const [key, value] of entries) {
      if (value === "" && key.endsWith(".credential_ref")) continue;
      const result = await postJson("/api/v1/admin/settings", {
        key,
        value,
        reason: interpolate(s.shipReasonCourier, { provider: providerKey }),
      }, s);
      if (!result.ok) {
        set({ status: result.message });
        return;
      }
    }
    set({ status: s.shipSaved });
  }

  async function handleTest() {
    const result = await postJson("/api/v1/admin/settings/test", {
      category: "courier",
      provider: providerKey,
    }, s);
    set({ status: result.ok ? s.shipTestPassed : result.message });
  }

  return (
    <section className="rounded-3xl border border-border/60 bg-card p-5 shadow-card">
      <h2 className="font-display text-base font-semibold text-text-main">{label}</h2>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm font-medium text-text-main">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
            className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
          />
          {s.shipEnabled}
        </label>
        <label className="text-sm font-medium text-text-main">
          {s.shipMode}
          <select value={state.mode} onChange={(e) => set({ mode: e.target.value as ProviderState["mode"] })} className={inlineInputCls}>
            <option value="sandbox">sandbox</option>
            <option value="live">live</option>
          </select>
        </label>
      </div>
      <div className="mt-4 max-w-md">
        <label className="block text-xs font-semibold text-text-main">
          {s.shipCredential}
          <input
            type="password"
            placeholder="••••••••"
            value={state.credentialRef}
            onChange={(e) => set({ credentialRef: e.target.value })}
            autoComplete="off"
            className={inputCls}
          />
        </label>
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
  return (
    <main className="min-w-0">
      <PageHeader title={s.shipTitle} description={s.shipIntro} />
      <div className="space-y-6">
        {PROVIDERS.map((provider) => (
          <ProviderSection key={provider.key} providerKey={provider.key} label={provider.label} />
        ))}
        <ZonesSection />
      </div>
    </main>
  );
}

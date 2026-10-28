"use client";

// Admin > Settings > Payments — Agent 5 shell, wired by Agent 9.
// Save/Test now call the Settings API contract in
// src/integrations/sandbox/SETTINGS-API-CONTRACT.md:
//   POST /api/v1/admin/settings       { key, value, reason }
//   POST /api/v1/admin/settings/test  { category: "payment", provider }
// That API route does NOT exist yet (settings owner's file). If it is
// missing or rejects, this page shows the error — it never fakes success.
// No credential value is stored here: the credential field is a REFERENCE
// only; the real credential lives in Settings, encrypted, server-side.
// Live-mode guard: live cannot be saved without a credential reference.
// UI copy: doc-30 dictionary (../strings-b) — locale-selected, no mixing.
import { useState } from "react";
import { liveModeGuardMessage } from "../../../../src/integrations/sandbox/live-guard";
import { isAdapterlessGatewayMethod } from "../../../../src/checkout/payment-methods";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_B_STRINGS, type SettingsBStrings } from "../strings-b";
import { PageHeader } from "@/components/ui/page-header";

const inputCls =
  "mt-1 block w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-text-main shadow-xs focus:border-ring focus:outline-none";
const inlineInputCls =
  "ml-2 rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-text-main shadow-xs focus:border-ring focus:outline-none";
const saveBtnCls =
  "rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90";
const testBtnCls =
  "rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-text-main shadow-xs transition duration-fast hover:bg-surface-2";

const METHODS = [
  { key: "cod", label: "COD" },
  { key: "bkash", label: "bKash" },
  { key: "nagad", label: "Nagad" },
  { key: "rocket", label: "Rocket" },
  { key: "upay", label: "Upay" },
  { key: "sslcommerz", label: "SSLCommerz" },
  { key: "aamarpay", label: "AamarPay" },
  { key: "shurjopay", label: "ShurjoPay" },
  { key: "stripe", label: "Stripe (optional)" },
  { key: "paypal", label: "PayPal (optional)" },
] as const;

type MethodKey = (typeof METHODS)[number]["key"];

interface MethodState {
  enabled: boolean;
  mode: "sandbox" | "live";
  credentialRef: string;
  minPoisha: string;
  maxPoisha: string;
  feePoisha: string;
  status: string;
  merchantNumber: string;
  accountName: string;
}

function initialState(s: SettingsBStrings): MethodState {
  return {
    enabled: false,
    mode: "sandbox",
    credentialRef: "",
    minPoisha: "",
    maxPoisha: "",
    feePoisha: "0",
    status: s.payNotConnected,
    merchantNumber: "",
    accountName: "",
  };
}

async function postJson(
  url: string,
  body: Record<string, string>,
  s: SettingsBStrings,
): Promise<{ ok: boolean; message: string }> {
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
            ? s.payApiMissing
            : (data.error?.message ?? interpolate(s.paySaveFailed, { status: res.status })),
      };
    }
    return { ok: true, message: data.data?.message ?? s.paySaved };
  } catch {
    return { ok: false, message: s.payNetworkError };
  }
}

function MethodSection({ methodKey, label, s }: { methodKey: MethodKey; label: string; s: SettingsBStrings }) {
  const [state, setState] = useState<MethodState>(() => initialState(s));
  const set = (patch: Partial<MethodState>) => setState((prev) => ({ ...prev, ...patch }));
  const adapterless = isAdapterlessGatewayMethod(methodKey);

  async function handleSave() {
    if (state.mode === "live") {
      const guard = liveModeGuardMessage(state.credentialRef !== "", state.credentialRef || null);
      if (guard) {
        set({ status: guard });
        return;
      }
    }
    const entries: Array<[string, string]> = [
      [`payment.${methodKey}.enabled`, String(adapterless ? false : state.enabled)],
      [`payment.${methodKey}.mode`, state.mode],
      [`payment.${methodKey}.credential_ref`, state.credentialRef],
      [`payment.${methodKey}.min_poisha`, state.minPoisha],
      [`payment.${methodKey}.max_poisha`, state.maxPoisha],
      [`payment.${methodKey}.fee_poisha`, state.feePoisha],
    ];
    if (methodKey === "rocket") {
      entries.push([`payment.rocket.merchant_number`, state.merchantNumber]);
      entries.push([`payment.rocket.account_name`, state.accountName]);
    }
    for (const [key, value] of entries) {
      if (value === "" && !key.endsWith(".enabled") && !key.endsWith(".mode")) continue;
      const result = await postJson(
        "/api/v1/admin/settings",
        { key, value, reason: `Update payment method ${methodKey} from Settings UI` },
        s,
      );
      if (!result.ok) {
        set({ status: result.message });
        return;
      }
    }
    set({ status: s.paySavedViaApi });
  }

  async function handleTest() {
    const result = await postJson(
      "/api/v1/admin/settings/test",
      { category: "payment", provider: methodKey },
      s,
    );
    set({ status: result.ok ? s.payTestPassed : result.message });
  }

  return (
    <section className="rounded-3xl border border-border/60 bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-base font-semibold text-text-main">{label}</h2>
        {adapterless ? (
          <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning-solid">
            {s.payAdapterBadge}
          </span>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2 text-sm font-medium text-text-main">
          <input
            type="checkbox"
            checked={adapterless ? false : state.enabled}
            disabled={adapterless}
            onChange={(e) => set({ enabled: e.target.checked })}
            className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
          />
          {s.payEnabled}
        </label>
        <label className="text-sm font-medium text-text-main">
          {s.payMode}
          <select value={state.mode} onChange={(e) => set({ mode: e.target.value as MethodState["mode"] })} className={inlineInputCls}>
            <option value="sandbox">sandbox</option>
            <option value="live">live</option>
          </select>
        </label>
      </div>
      {adapterless ? (
        <p className="mt-2 text-[13px] text-warning-solid">{s.payAdapterNote}</p>
      ) : null}
      <div className="mt-4 max-w-md">
        <label className="block text-xs font-semibold text-text-main">
          {s.payCredentialRef}
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
      {methodKey === "rocket" ? (
        <div className="mt-4">
          <p className="text-[13px] text-text-muted">{s.payRocketNote}</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-text-main">
              {s.payRocketNumber}
              <input
                type="tel"
                placeholder="01XXXXXXXXX"
                value={state.merchantNumber}
                onChange={(e) => set({ merchantNumber: e.target.value })}
                autoComplete="off"
                className={inputCls}
              />
            </label>
            <label className="block text-xs font-semibold text-text-main">
              {s.payRocketName}
              <input
                type="text"
                placeholder={s.payRocketNamePlaceholder}
                value={state.accountName}
                onChange={(e) => set({ accountName: e.target.value })}
                autoComplete="off"
                className={inputCls}
              />
            </label>
          </div>
        </div>
      ) : null}
      {methodKey === "upay" ? (
        <p className="mt-4 text-[13px] text-text-muted">{s.payUpayNote}</p>
      ) : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="block text-xs font-semibold text-text-main">
          {s.payMin}
          <input type="number" placeholder="0" value={state.minPoisha} onChange={(e) => set({ minPoisha: e.target.value })} className={inputCls} />
        </label>
        <label className="block text-xs font-semibold text-text-main">
          {s.payMax}
          <input type="number" placeholder="—" value={state.maxPoisha} onChange={(e) => set({ maxPoisha: e.target.value })} className={inputCls} />
        </label>
        <label className="block text-xs font-semibold text-text-main">
          {s.payFee}
          <input type="number" placeholder="0" value={state.feePoisha} onChange={(e) => set({ feePoisha: e.target.value })} className={inputCls} />
        </label>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
        <p className="mr-auto text-sm text-text-muted">{interpolate(s.payStatus, { status: state.status })}</p>
        <button type="button" onClick={handleSave} className={saveBtnCls}>
          {s.paySaveBtn}
        </button>
        <button type="button" onClick={handleTest} className={testBtnCls}>
          {s.payTestBtn}
        </button>
      </div>
    </section>
  );
}

export default function PaymentsSettingsPage() {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  return (
    <main className="min-w-0">
      <PageHeader title={s.payTitle} description={s.payIntro} />
      <div className="space-y-6">
        <div className="space-y-1.5 rounded-2xl border border-border/60 bg-surface-2/40 p-4 text-sm leading-relaxed text-text-muted">
          <p>{s.payCheckoutNote}</p>
          <p>{s.payTrxRule}</p>
          <p>{s.payManualNote}</p>
        </div>
        {METHODS.map((method) => (
          <MethodSection key={method.key} methodKey={method.key} label={method.label} s={s} />
        ))}
        <p className="text-sm text-text-muted">{s.payFooterNote}</p>
      </div>
    </main>
  );
}

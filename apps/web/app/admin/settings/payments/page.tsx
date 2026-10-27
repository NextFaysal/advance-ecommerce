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
    <section style={{ border: "1px solid #E6E8F2", padding: 16, marginBottom: 12 }}>
      <h2>
        {label}
        {adapterless ? (
          <span
            style={{
              marginLeft: 8,
              padding: "2px 8px",
              borderRadius: 999,
              background: "#FEF3C7",
              color: "#92400E",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {s.payAdapterBadge}
          </span>
        ) : null}
      </h2>
      <label>
        {s.payEnabled}{" "}
        <input
          type="checkbox"
          checked={adapterless ? false : state.enabled}
          disabled={adapterless}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
      </label>{" "}
      {adapterless ? (
        <p style={{ color: "#92400E", fontSize: 13, margin: "6px 0" }}>{s.payAdapterNote}</p>
      ) : null}
      <label>
        {s.payMode}{" "}
        <select value={state.mode} onChange={(e) => set({ mode: e.target.value as MethodState["mode"] })}>
          <option value="sandbox">sandbox</option>
          <option value="live">live</option>
        </select>
      </label>
      <div>
        <label>
          {s.payCredentialRef}{" "}
          <input
            type="password"
            placeholder="••••••••"
            value={state.credentialRef}
            onChange={(e) => set({ credentialRef: e.target.value })}
            autoComplete="off"
          />
        </label>
      </div>
      {methodKey === "rocket" ? (
        <div>
          <p style={{ fontSize: 13, margin: "6px 0" }}>{s.payRocketNote}</p>
          <label>
            {s.payRocketNumber}{" "}
            <input
              type="tel"
              placeholder="01XXXXXXXXX"
              value={state.merchantNumber}
              onChange={(e) => set({ merchantNumber: e.target.value })}
              autoComplete="off"
            />
          </label>{" "}
          <label>
            {s.payRocketName}{" "}
            <input
              type="text"
              placeholder={s.payRocketNamePlaceholder}
              value={state.accountName}
              onChange={(e) => set({ accountName: e.target.value })}
              autoComplete="off"
            />
          </label>
        </div>
      ) : null}
      {methodKey === "upay" ? (
        <p style={{ fontSize: 13, margin: "6px 0" }}>{s.payUpayNote}</p>
      ) : null}
      <div>
        <label>
          {s.payMin}{" "}
          <input type="number" placeholder="0" value={state.minPoisha} onChange={(e) => set({ minPoisha: e.target.value })} />
        </label>{" "}
        <label>
          {s.payMax}{" "}
          <input type="number" placeholder="—" value={state.maxPoisha} onChange={(e) => set({ maxPoisha: e.target.value })} />
        </label>{" "}
        <label>
          {s.payFee}{" "}
          <input type="number" placeholder="0" value={state.feePoisha} onChange={(e) => set({ feePoisha: e.target.value })} />
        </label>
      </div>
      <p>{interpolate(s.payStatus, { status: state.status })}</p>
      <button type="button" onClick={handleSave}>
        {s.paySaveBtn}
      </button>{" "}
      <button type="button" onClick={handleTest}>
        {s.payTestBtn}
      </button>
    </section>
  );
}

export default function PaymentsSettingsPage() {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  return (
    <main>
      <h1>{s.payTitle}</h1>
      <p>{s.payIntro}</p>
      <p>{s.payCheckoutNote}</p>
      <p>{s.payTrxRule}</p>
      <p>{s.payManualNote}</p>
      {METHODS.map((method) => (
        <MethodSection key={method.key} methodKey={method.key} label={method.label} s={s} />
      ))}
      <p>{s.payFooterNote}</p>
    </main>
  );
}

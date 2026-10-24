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
import { useState } from "react";
import { liveModeGuardMessage } from "../../../../src/integrations/sandbox/live-guard";

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
}

const initialState = (): MethodState => ({
  enabled: false,
  mode: "sandbox",
  credentialRef: "",
  minPoisha: "",
  maxPoisha: "",
  feePoisha: "0",
  status: "Not connected",
});

async function postJson(url: string, body: Record<string, string>): Promise<{ ok: boolean; message: string }> {
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
            ? "Settings API is not available yet (route missing) — nothing was saved."
            : (data.error?.message ?? `Save failed (${res.status}).`),
      };
    }
    return { ok: true, message: data.data?.message ?? "Saved." };
  } catch {
    return { ok: false, message: "Network error — nothing was saved." };
  }
}

function MethodSection({ methodKey, label }: { methodKey: MethodKey; label: string }) {
  const [state, setState] = useState<MethodState>(initialState);
  const set = (patch: Partial<MethodState>) => setState((s) => ({ ...s, ...patch }));

  async function handleSave() {
    if (state.mode === "live") {
      const guard = liveModeGuardMessage(state.credentialRef !== "", state.credentialRef || null);
      if (guard) {
        set({ status: guard });
        return;
      }
    }
    const entries: Array<[string, string]> = [
      [`payment.${methodKey}.enabled`, String(state.enabled)],
      [`payment.${methodKey}.mode`, state.mode],
      [`payment.${methodKey}.credential_ref`, state.credentialRef],
      [`payment.${methodKey}.min_poisha`, state.minPoisha],
      [`payment.${methodKey}.max_poisha`, state.maxPoisha],
      [`payment.${methodKey}.fee_poisha`, state.feePoisha],
    ];
    for (const [key, value] of entries) {
      if (value === "" && !key.endsWith(".enabled") && !key.endsWith(".mode")) continue;
      const result = await postJson("/api/v1/admin/settings", {
        key,
        value,
        reason: `Update payment method ${methodKey} from Settings UI`,
      });
      if (!result.ok) {
        set({ status: result.message });
        return;
      }
    }
    set({ status: "Saved via Settings API." });
  }

  async function handleTest() {
    const result = await postJson("/api/v1/admin/settings/test", {
      category: "payment",
      provider: methodKey,
    });
    set({ status: result.ok ? "Test passed via Settings API (sandbox is simulated)." : result.message });
  }

  return (
    <section style={{ border: "1px solid #E6E8F2", padding: 16, marginBottom: 12 }}>
      <h2>{label}</h2>
      <label>
        Enabled{" "}
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
        />
      </label>{" "}
      <label>
        Mode{" "}
        <select
          value={state.mode}
          onChange={(e) => set({ mode: e.target.value as MethodState["mode"] })}
        >
          <option value="sandbox">sandbox</option>
          <option value="live">live</option>
        </select>
      </label>
      <div>
        <label>
          Credential reference (encrypted, never shown){" "}
          <input
            type="password"
            placeholder="••••••••"
            value={state.credentialRef}
            onChange={(e) => set({ credentialRef: e.target.value })}
            autoComplete="off"
          />
        </label>
      </div>
      <div>
        <label>
          Min amount (poisha){" "}
          <input type="number" placeholder="0" value={state.minPoisha} onChange={(e) => set({ minPoisha: e.target.value })} />
        </label>{" "}
        <label>
          Max amount (poisha){" "}
          <input type="number" placeholder="—" value={state.maxPoisha} onChange={(e) => set({ maxPoisha: e.target.value })} />
        </label>{" "}
        <label>
          Flat fee (poisha){" "}
          <input type="number" placeholder="0" value={state.feePoisha} onChange={(e) => set({ feePoisha: e.target.value })} />
        </label>
      </div>
      <p>Status: {state.status}</p>
      <button type="button" onClick={handleSave}>
        Save
      </button>{" "}
      <button type="button" onClick={handleTest}>
        Test connection
      </button>
    </section>
  );
}

export default function PaymentsSettingsPage() {
  return (
    <main>
      <h1>Settings — Payments</h1>
      <p>
        Admin-configurable: env is only a default. Live mode must not turn on without a
        verified credential reference, and sandbox is the default for every new method.
      </p>
      <p>
        Manual TrxID rule: the same (method, TrxID) can never be approved twice —
        duplicate TrxID detection is enforced in the manual TrxID review API
        (Agent 9, sandbox).
      </p>
      <p>Manual mobile banking (TrxID approve/reject) is reviewed in Admin &gt; Payments, not configured here.</p>
      {METHODS.map((method) => (
        <MethodSection key={method.key} methodKey={method.key} label={method.label} />
      ))}
      <p>
        Note: Save/Test call the Settings API (see SETTINGS-API-CONTRACT.md in
        src/integrations/sandbox). Until that route exists, this page shows an
        error instead of claiming a save happened.
      </p>
    </main>
  );
}

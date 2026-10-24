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

const PROVIDERS = [
  { key: "steadfast", label: "Steadfast" },
  { key: "pathao", label: "Pathao" },
  { key: "redx", label: "RedX" },
  { key: "paperfly", label: "Paperfly" },
  { key: "ecourier", label: "eCourier" },
] as const;

type ProviderKey = (typeof PROVIDERS)[number]["key"];

const ZONES = [
  { key: "inside_dhaka", label: "Inside Dhaka" },
  { key: "outside_dhaka", label: "Outside Dhaka" },
  { key: "district", label: "District-wise" },
] as const;

interface ProviderState {
  enabled: boolean;
  mode: "sandbox" | "live";
  credentialRef: string;
  status: string;
}

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

function ProviderSection({ providerKey, label }: { providerKey: ProviderKey; label: string }) {
  const [state, setState] = useState<ProviderState>({
    enabled: false,
    mode: "sandbox",
    credentialRef: "",
    status: "Not connected",
  });
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
        reason: `Update courier ${providerKey} from Settings UI`,
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
      category: "courier",
      provider: providerKey,
    });
    set({ status: result.ok ? "Test passed via Settings API (sandbox is simulated)." : result.message });
  }

  return (
    <section style={{ border: "1px solid #E6E8F2", padding: 16, marginBottom: 12 }}>
      <h2>{label}</h2>
      <label>
        Enabled{" "}
        <input type="checkbox" checked={state.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
      </label>{" "}
      <label>
        Mode{" "}
        <select value={state.mode} onChange={(e) => set({ mode: e.target.value as ProviderState["mode"] })}>
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

function ZonesSection() {
  const [charges, setCharges] = useState<Record<string, string>>({});
  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");

  async function handleSave() {
    for (const zone of ZONES) {
      const charge = charges[zone.key] ?? "";
      const freeAbove = thresholds[zone.key] ?? "";
      if (charge !== "") {
        const result = await postJson("/api/v1/admin/settings", {
          key: `courier.${zone.key}.charge_poisha`,
          value: charge,
          reason: "Update shipping zone charge from Settings UI",
        });
        if (!result.ok) {
          setStatus(result.message);
          return;
        }
      }
      if (freeAbove !== "") {
        const result = await postJson("/api/v1/admin/settings", {
          key: `courier.${zone.key}.free_above_poisha`,
          value: freeAbove,
          reason: "Update shipping free-above threshold from Settings UI",
        });
        if (!result.ok) {
          setStatus(result.message);
          return;
        }
      }
    }
    setStatus("Saved via Settings API.");
  }

  return (
    <section style={{ border: "1px solid #E6E8F2", padding: 16 }}>
      <h2>Zones &amp; rates</h2>
      {ZONES.map((zone) => (
        <div key={zone.key}>
          {zone.label}: charge (poisha){" "}
          <input
            type="number"
            placeholder="0"
            value={charges[zone.key] ?? ""}
            onChange={(e) => setCharges((c) => ({ ...c, [zone.key]: e.target.value }))}
          />{" "}
          — free above (poisha){" "}
          <input
            type="number"
            placeholder="—"
            value={thresholds[zone.key] ?? ""}
            onChange={(e) => setThresholds((t) => ({ ...t, [zone.key]: e.target.value }))}
          />
        </div>
      ))}
      <button type="button" onClick={handleSave} style={{ marginTop: 8 }}>
        Save zones
      </button>
      {status !== "" && <p>Status: {status}</p>}
      <p>
        COD settlement outline: courier-collected cash minus courier charge is reconciled
        in the admin COD settlement report (Step 22, sandbox route:
        /api/v1/admin/payments/cod-settlement). If a courier API is down, bookings
        queue with auto-retry and manual booking + manual tracking ID is the fallback.
      </p>
    </section>
  );
}

export default function ShippingSettingsPage() {
  return (
    <main>
      <h1>Settings — Shipping</h1>
      <p>
        Admin-configurable: per-courier on/off, sandbox/live, credential reference
        (encrypted, never shown), zone rates, weight rules and free-shipping threshold.
      </p>
      {PROVIDERS.map((provider) => (
        <ProviderSection key={provider.key} providerKey={provider.key} label={provider.label} />
      ))}
      <ZonesSection />
    </main>
  );
}

"use client";

/**
 * BD Tools — ডিভাইস টোকেন panel (wave 58 server companion).
 *
 * Provisions per-device tokens for the Android SMS forwarder app
 * (apps/android-sms-forwarder/): instead of holding a staff session
 * (7-day expiry, unusable with TOTP accounts), each forwarder phone
 * gets its OWN revocable token, sent as
 * `Authorization: Bearer ae_dev_…` to POST /api/v1/admin/bd/sms-ingest.
 *
 * SECRETS: the server stores only a SHA-256 hash (src/bd/devices.ts).
 * The plaintext token is returned ONCE by the create API and lives
 * in this panel's state only until dismissed — it is never written
 * to storage, never re-fetched, and the list API cannot return it.
 * Token hashes never reach the browser either: rows come from the
 * hash-free SmsDeviceView.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick, type Locale } from "@/i18n/locale";
import { BD_TOOLS_STRINGS } from "./strings";

interface DeviceView {
  id: string;
  label: string;
  createdAt: string;
  createdById: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked";
}

function fmtDhaka(iso: string | null, locale: Locale): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: "Asia/Dhaka",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function SmsDevicesPanel() {
  const { locale } = useLocale();
  const s = pick(locale, BD_TOOLS_STRINGS);
  const [devices, setDevices] = useState<DeviceView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [createReason, setCreateReason] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /** The one-time plaintext token — component state only, cleared on dismiss. */
  const [freshToken, setFreshToken] = useState<{ label: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeReason, setRevokeReason] = useState<Record<string, string>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/bd/devices", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(json?.error?.message ?? interpolate(s.devLoadFailedHttp, { status: res.status }));
        return;
      }
      setDevices(json.data.devices as DeviceView[]);
      setLoadError(null);
    } catch {
      setLoadError(s.devLoadFailedNet);
    }
  }, [s]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreateError(null);
    if (!label.trim()) return setCreateError(s.devLabelRequired);
    if (!createReason.trim()) return setCreateError(s.devReasonRequired);
    setCreating(true);
    try {
      const res = await fetch("/api/v1/admin/bd/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), reason: createReason.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setCreateError(json?.error?.message ?? interpolate(s.devCreateFailedHttp, { status: res.status }));
        return;
      }
      setFreshToken({ label: json.data.device.label as string, token: json.data.token as string });
      setCopied(false);
      setLabel("");
      setCreateReason("");
      await load();
    } catch {
      setCreateError(s.devCreateFailedNet);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (device: DeviceView) => {
    setRevokeError(null);
    const reason = (revokeReason[device.id] ?? "").trim();
    if (!reason) return setRevokeError(s.devRevokeReasonRequired);
    try {
      const res = await fetch(`/api/v1/admin/bd/devices/${device.id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setRevokeError(json?.error?.message ?? interpolate(s.devRevokeFailedHttp, { status: res.status }));
        return;
      }
      setConfirmingId(null);
      await load();
    } catch {
      setRevokeError(s.devRevokeFailedNet);
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-text-muted">
        {s.devIntro1}
        <span className="font-mono text-xs">Authorization: Bearer ae_dev_…</span>
        {s.devIntro2}
      </p>

      {freshToken ? (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            {interpolate(s.devFreshTitle, { label: freshToken.label })}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {s.devFreshText}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="break-all rounded-md bg-white px-3 py-2 font-mono text-sm text-amber-950 ring-1 ring-amber-200">
              {freshToken.token}
            </code>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(freshToken.token);
                setCopied(true);
              }}
            >
              {copied ? s.copied : s.copy}
            </Button>
            <Button type="button" onClick={() => setFreshToken(null)}>
              {s.devSavedClose}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-surface-2 p-4">
        <h3 className="text-sm font-semibold">{s.devNewTitle}</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block min-w-52 flex-1">
            <span className="mb-1 block text-xs font-medium text-text-muted">{s.devNameLabel}</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
              placeholder={s.devNamePlaceholder}
            />
          </label>
          <label className="block min-w-52 flex-1">
            <span className="mb-1 block text-xs font-medium text-text-muted">{s.devReasonLabel}</span>
            <input
              value={createReason}
              onChange={(e) => setCreateReason(e.target.value)}
              className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
              placeholder={s.devReasonPlaceholder}
            />
          </label>
          <Button type="button" onClick={create} disabled={creating}>
            {creating ? s.devCreating : s.devCreate}
          </Button>
        </div>
        {createError ? (
          <p role="alert" className="mt-2 text-sm text-rose-700">{createError}</p>
        ) : null}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{s.devListTitle}</h3>
        {loadError ? (
          <p role="alert" className="text-sm text-rose-700">{loadError}</p>
        ) : devices === null ? (
          <p className="text-sm text-text-muted">{s.devLoading}</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-text-muted">
            {s.devEmpty}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {devices.map((device) => (
              <li key={device.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {device.label}
                    {device.status === "active" ? (
                      <Badge tone="success">{s.devActive}</Badge>
                    ) : (
                      <Badge tone="danger">{s.devRevoked}</Badge>
                    )}
                  </span>
                  <span className="font-mono text-xs text-text-muted">{device.id}</span>
                </div>
                <p className="text-xs text-text-muted">
                  {interpolate(s.devMeta, {
                    created: fmtDhaka(device.createdAt, locale),
                    lastSeen: device.lastSeenAt ? fmtDhaka(device.lastSeenAt, locale) : s.devNeverSeen,
                  })}
                  {device.revokedAt
                    ? interpolate(s.devRevokedSuffix, { at: fmtDhaka(device.revokedAt, locale) })
                    : ""}
                </p>
                {device.status === "active" ? (
                  confirmingId === device.id ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="block min-w-52 flex-1">
                        <span className="mb-1 block text-xs font-medium text-text-muted">{s.devRevokeReasonLabel}</span>
                        <input
                          value={revokeReason[device.id] ?? ""}
                          onChange={(e) =>
                            setRevokeReason((prev) => ({ ...prev, [device.id]: e.target.value }))
                          }
                          className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
                          placeholder={s.devRevokeReasonPlaceholder}
                        />
                      </label>
                      <Button type="button" variant="destructive" onClick={() => void revoke(device)}>
                        {s.devConfirmRevoke}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setConfirmingId(null)}>
                        {s.devBack}
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" variant="secondary" onClick={() => setConfirmingId(device.id)}>
                      {s.devRevoke}
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {revokeError ? (
          <p role="alert" className="mt-2 text-sm text-rose-700">{revokeError}</p>
        ) : null}
      </div>
    </div>
  );
}

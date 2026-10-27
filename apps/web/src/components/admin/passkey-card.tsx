"use client";

/**
 * Staff passkeys card — /admin/security (doc 23 wave 55).
 *
 * Self-fetching: lists the signed-in staff member's own passkeys
 * from GET /api/v1/admin/auth/passkey/credentials. Registration runs
 * the WebAuthn ceremony in the browser (@simplewebauthn/browser):
 * options from the server, create() on the authenticator, verify on
 * the server — the card never sees or stores any secret (a passkey
 * has none to show). Delete is a two-step inline confirm, mirroring
 * the sessions card. Browsers without WebAuthn get an honest note
 * instead of a dead button.
 */
import { useCallback, useEffect, useState } from "react";
import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick, type Locale } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";

interface PasskeyRow {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ListResponse {
  data?: { passkeys: PasskeyRow[] };
  error?: { message?: string };
}

function absolute(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(intlLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PasskeyCard() {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const [rows, setRows] = useState<PasskeyRow[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [registering, setRegistering] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/auth/passkey/credentials");
      const json = (await res.json().catch(() => ({}))) as ListResponse;
      if (!res.ok) {
        setError(json.error?.message ?? s.pkLoadFailed);
        return;
      }
      setError("");
      setRows(json.data?.passkeys ?? []);
    } catch {
      setError(s.secSessNetworkError);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRegister() {
    const label = deviceLabel.trim();
    if (label === "") {
      setActionError(s.pkNameRequired);
      return;
    }
    setRegistering(true);
    setActionError("");
    setNotice("");
    try {
      const optionsRes = await fetch("/api/v1/admin/auth/passkey/register/options", {
        method: "POST",
      });
      const optionsJson = (await optionsRes.json().catch(() => ({}))) as {
        data?: { options: Parameters<typeof startRegistration>[0]["optionsJSON"] };
        error?: { message?: string };
      };
      if (!optionsRes.ok || !optionsJson.data?.options) {
        setActionError(optionsJson.error?.message ?? s.pkRegisterStartFailed);
        return;
      }
      let attestation;
      try {
        attestation = await startRegistration({ optionsJSON: optionsJson.data.options });
      } catch {
        // NotAllowedError (cancelled / timed out) and unsupported
        // authenticators both land here — say so plainly, no blame.
        setActionError(s.pkRegisterIncomplete);
        return;
      }
      const verifyRes = await fetch("/api/v1/admin/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation, deviceLabel: label }),
      });
      const verifyJson = (await verifyRes.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!verifyRes.ok) {
        setActionError(verifyJson.error?.message ?? s.pkSaveFailed);
        return;
      }
      setDeviceLabel("");
      setNotice(s.pkAdded);
      await load();
    } catch {
      setActionError(s.secSessNetworkError);
    } finally {
      setRegistering(false);
    }
  }

  async function handleDelete(row: PasskeyRow) {
    setBusyId(row.id);
    setActionError("");
    setNotice("");
    try {
      const res = await fetch("/api/v1/admin/auth/passkey/credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setActionError(json.error?.message ?? s.pkDeleteFailed);
        return;
      }
      setConfirmDeleteId(null);
      setNotice(interpolate(s.pkDeleted, { label: row.deviceLabel }));
      await load();
    } catch {
      setActionError(s.secSessNetworkError);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-text-main">{s.pkTitle}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {s.pkDesc}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          {s.secSessRefresh}
        </Button>
      </div>

      {notice ? (
        <p role="status" className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {actionError}
        </p>
      ) : null}

      {error ? (
        <div className="mt-4">
          <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
            {s.secSessRetry}
          </Button>
        </div>
      ) : rows === null ? (
        <p role="status" className="mt-4 text-sm text-text-muted">
          {s.pkLoading}
        </p>
      ) : rows.length === 0 ? (
        <p role="status" className="mt-4 text-sm text-text-muted">
          {s.pkEmpty}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-semibold text-text-main">{row.deviceLabel}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  {s.pkAddedOn}: {absolute(row.createdAt, locale)}
                  {row.lastUsedAt ? ` · ${s.pkLastUsed}: ${absolute(row.lastUsedAt, locale)}` : ` · ${s.pkNeverUsed}`}
                </p>
              </div>
              {confirmDeleteId === row.id ? (
                <span className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyId === row.id}
                    onClick={() => void handleDelete(row)}
                  >
                    {busyId === row.id ? s.pkDeleting : s.pkConfirmDelete}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    {s.secSessKeep}
                  </Button>
                </span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDeleteId(row.id)}
                >
                  {s.pkDelete}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 border-t border-border pt-4">
        {supported === false ? (
          <p role="status" className="text-sm text-text-muted">
            {s.pkUnsupported}
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <Input
                label={s.pkDeviceName}
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
                placeholder={s.pkDevicePlaceholder}
                maxLength={80}
              />
            </div>
            <Button type="button" disabled={registering} onClick={() => void handleRegister()}>
              {registering ? s.pkRegistering : s.pkAddNew}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

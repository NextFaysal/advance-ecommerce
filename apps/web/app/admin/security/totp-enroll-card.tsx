"use client";

/**
 * Self-service TOTP (2FA) enrolment card — /admin/security.
 *
 * Talks to the session-guarded API:
 *   POST /api/v1/admin/auth/2fa/enroll  -> the plain secret, shown ONCE
 *   POST /api/v1/admin/auth/2fa/confirm -> { code } activates 2FA
 * The stored secret is an encrypted envelope server-side
 * (enrollTotpSecret in src/lib/auth.ts); this card only ever holds the
 * one-time display value in component state. Starting a new setup
 * REPLACES the stored secret — for an account with active 2FA that is
 * a reset, and the old authenticator codes stop working immediately.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { SECURITY_STRINGS } from "./strings";

interface EnrollResponse {
  data?: { secretBase32: string; otpauthUrl: string; account: string };
  error?: { message?: string };
}

export default function TotpEnrollCard({
  totpEnabled,
  enrolmentPending,
  accountLabel,
}: {
  totpEnabled: boolean;
  enrolmentPending: boolean;
  accountLabel: string;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const s = pick(locale, SECURITY_STRINGS);
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function startEnrolment() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/admin/auth/2fa/enroll", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as EnrollResponse;
      if (!res.ok || !body.data) {
        setError(body.error?.message ?? s.totpSetupFailed);
        return;
      }
      setSecret(body.data.secretBase32);
      setOtpauthUrl(body.data.otpauthUrl);
      setCode("");
    } catch {
      setError(s.totpNetworkError);
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrolment() {
    if (!/^\d{6}$/.test(code)) {
      setError(s.totpCodePrompt);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/auth/2fa/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        setError(s.totpCodeMismatch);
        return;
      }
      setSecret(null);
      setOtpauthUrl(null);
      setCode("");
      setMessage(s.totpEnabledMsg);
      router.refresh();
    } catch {
      setError(s.totpNetworkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{s.totpTitle}</h2>
        {totpEnabled ? (
          <Badge tone="success">{s.totpOn}</Badge>
        ) : enrolmentPending ? (
          <Badge tone="warning">{s.totpPending}</Badge>
        ) : (
          <Badge tone="warning">{s.totpOff}</Badge>
        )}
      </div>
      <p className="mt-2 text-sm text-text-muted">
        {s.totpAccountPrefix}: <span className="font-medium text-text-main">{accountLabel}</span>{s.totpIntro}
      </p>

      {message ? (
        <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      {secret ? (
        <div className="mt-4 space-y-3">
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {s.totpOnceWarningBefore}<strong>{s.totpOnceWarningStrong}</strong>{s.totpOnceWarningAfter}
          </p>
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">{s.totpSecretLabel}</span>
            <code className="block break-all rounded-md bg-surface-2 px-3 py-2 font-mono text-sm">{secret}</code>
          </div>
          {otpauthUrl ? (
            <div>
              <span className="mb-1 block text-xs font-medium text-text-muted">{s.totpOtpauthLabel}</span>
              <code className="block break-all rounded-md bg-surface-2 px-3 py-2 font-mono text-xs">{otpauthUrl}</code>
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-44 flex-1">
              <Input
                label={s.totpCodeLabel}
                placeholder="123456"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
            <Button onClick={confirmEnrolment} disabled={busy}>
              {busy ? s.totpVerifying : s.totpConfirmBtn}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {enrolmentPending && !totpEnabled ? (
            <p className="text-sm text-text-muted">
              {s.totpPendingNote}
            </p>
          ) : null}
          <Button onClick={startEnrolment} disabled={busy}>
            {busy ? s.totpWorking : totpEnabled ? s.totpResetBtn : s.totpStartBtn}
          </Button>
          {totpEnabled ? (
            <p className="text-sm text-rose-600">
              {s.totpResetWarning}
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

"use client";

/**
 * Pickup OTP panel — admin order detail rail (ADV-19 remainder).
 *
 * Self-fetching: GET /api/v1/admin/orders/[id]/pickup-otp. Renders
 * NOTHING for non-pickup orders (applicable === false), so it is safe
 * to mount unconditionally. For pickup orders it shows the handover
 * state and, while unverified, the verify form + resend button:
 *   - verify -> POST .../pickup-otp/verify (orders.edit)
 *   - resend -> POST .../pickup-otp/resend (orders.edit) — a fresh
 *     code supersedes the old one; the response's sms state is shown
 *     verbatim ("queued" is not "sent" — delivery needs the worker
 *     + a live SMS provider).
 * Until verification succeeds, the DELIVERED transition is blocked
 * server-side (409 PICKUP_OTP_INVALID) — this panel is the unlock.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatSubscriptionDate } from "@/subscriptions/labels";
import { pick } from "../../../../src/i18n/locale";
import { useLocale } from "../../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "../strings";

interface PickupOtpStatus {
  applicable: boolean;
  issued: boolean;
  verified: boolean;
  verifiedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  attemptsLeft: number | null;
}

export function PickupOtpPanel({ orderId }: { orderId: string }) {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const [status, setStatus] = useState<PickupOtpStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/orders/${orderId}/pickup-otp`);
      if (!res.ok) {
        setStatus(null);
        return;
      }
      const json = (await res.json()) as { data?: PickupOtpStatus };
      setStatus(json.data ?? null);
    } catch {
      setStatus(null);
    } finally {
      setLoaded(true);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function verify() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/admin/orders/${orderId}/pickup-otp/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: { message?: string; details?: string };
      } | null;
      if (!res.ok) {
        setError(
          json?.error?.details === "EXPIRED"
            ? s.otpExpiredErr
            : json?.error?.details === "TOO_MANY_ATTEMPTS"
              ? s.otpTooMany
              : (json?.error?.message ?? s.otpVerifyFail),
        );
        await load();
        return;
      }
      setCode("");
      setNotice(s.otpVerifiedNotice);
      await load();
    } catch {
      setError(s.otpVerifyConn);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/admin/orders/${orderId}/pickup-otp/resend`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => null)) as {
        data?: { sms?: string };
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(json?.error?.message ?? s.otpResendFail);
        return;
      }
      setNotice(
        json?.data?.sms === "queued"
          ? s.otpResendQueued
          : s.otpResendNoQueue,
      );
      await load();
    } catch {
      setError(s.otpResendConn);
    } finally {
      setBusy(false);
    }
  }

  if (!loaded || status === null || !status.applicable) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-text-main">{s.otpTitle}</h3>
        {status.verified ? (
          <Badge tone="success">{s.otpVerified}</Badge>
        ) : status.issued ? (
          <Badge tone="warning">{s.otpPending}</Badge>
        ) : (
          <Badge tone="neutral">{s.otpNotIssued}</Badge>
        )}
      </div>

      {status.verified ? (
        <p className="mt-2 text-sm leading-6 text-text-muted">
          {s.otpVerifiedBody1} ({formatSubscriptionDate(status.verifiedAt)}) {s.otpVerifiedBody2}
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            {s.otpIntro}
            {status.issued && !status.expired
              ? ` ${s.otpExpiry}: ${formatSubscriptionDate(status.expiresAt)}${status.attemptsLeft !== null ? ` · ${s.otpAttemptsLeft}: ${status.attemptsLeft}` : ""}.`
              : status.issued
                ? ` ${s.otpExpiredPrev}`
                : ` ${s.otpNotSent}`}
          </p>
          {status.issued && !status.expired ? (
            <div className="mt-3 flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={s.otpPlaceholder}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="font-mono"
              />
              <Button type="button" disabled={busy || code.length < 4} onClick={verify}>
                {s.otpVerifyBtn}
              </Button>
            </div>
          ) : null}
          <div className="mt-3">
            <Button type="button" variant="outline" disabled={busy} onClick={resend}>
              {s.otpResend}
            </Button>
          </div>
        </>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-3 text-sm font-medium text-success-solid">
          {notice}
        </p>
      ) : null}
    </Card>
  );
}

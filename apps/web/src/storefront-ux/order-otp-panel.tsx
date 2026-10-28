"use client";

/**
 * Order OTP verification panel (doc 21 G3-5, wave W0-B).
 *
 * The OTP endpoints have existed since doc 17 O3 —
 *   POST /api/v1/public/orders/[id]/otp         { phone, code }
 *   POST /api/v1/public/orders/[id]/otp/resend  { phone }
 * — but no customer-facing UI ever called them, so an OTP-flagged
 * order could not be confirmed by the customer at all. This panel is
 * that UI. It consumes the endpoints' contracts exactly:
 * - Both endpoints bind by phone: the phone must match the order's
 *   customerPhone (normalized) or the answer is a generic 404.
 * - Verify success is { data: { verified: true } }; failures are
 *   { error: { code, message, details? } } with codes OTP_MISMATCH
 *   (details.attemptsLeft), OTP_EXPIRED, OTP_TOO_MANY_ATTEMPTS,
 *   OTP_ALREADY_VERIFIED, OTP_NOT_REQUIRED, RATE_LIMITED. The
 *   endpoint's own bilingual message is shown — the half matching the
 *   active locale (doc 30) — no error copy is invented here.
 * - Resend enforces a 60-second cooldown server-side (429
 *   OTP_RESEND_COOLDOWN with details.retryAfterSeconds); the button
 *   mirrors that cooldown locally. A 200 resend means a code was
 *   issued and its SMS QUEUED (meta.sms) — not delivered; the copy
 *   below never claims an SMS arrived.
 *
 * Mounted where the caller genuinely holds the order id + the full
 * submitted phone + the requiresOtp fact (the checkout confirmation).
 * Account/track payloads expose neither the OTP state nor the full
 * phone, so the panel is deliberately NOT mounted there.
 */
import { useEffect, useState } from "react";
import { maskPhone } from "@/checkout/validation";
import { useDigitText } from "@/components/ui/numerals";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { UX_STRINGS } from "./strings";

interface OtpApiError {
  code?: string;
  message?: string;
  details?: { attemptsLeft?: number; retryAfterSeconds?: number };
}

interface OtpApiResponse {
  data?: { verified?: boolean; sent?: boolean; expiresInSeconds?: number };
  meta?: { sms?: string };
  error?: OtpApiError;
}

/** Endpoint messages are "বাংলা / English" pairs; show the active
 *  locale's half (doc 30 — no mixed UI). Falls back to the whole
 *  message when it is not a pair. */
function localizedMessage(message: string | undefined, fallback: string, locale: Locale): string {
  if (!message) return fallback;
  const parts = message.split(" / ").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return locale === "bn" ? parts[0]! : parts[1]!;
  return message;
}

export default function OrderOtpPanel({
  orderId,
  phone,
  smsState,
}: {
  orderId: string;
  /** The phone the order was placed with (as submitted at checkout). */
  phone: string;
  /** meta.otp.sms from the create response: "queued" when the first
   *  code's SMS job was queued; anything else means it was not. */
  smsState?: string;
}) {
  const digits = useDigitText();
  const { locale } = useLocale();
  const s = pick(locale, UX_STRINGS);
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"entry" | "verified" | "not_required">("entry");
  const [busy, setBusy] = useState<"verify" | "resend" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  async function verify() {
    if (busy || code.length !== 6) return;
    setBusy("verify");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/public/orders/${orderId}/otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const json = (await res.json().catch(() => null)) as OtpApiResponse | null;
      if (res.ok && json?.data?.verified) {
        setPhase("verified");
        setAttemptsLeft(null);
        return;
      }
      const e = json?.error;
      if (e?.code === "OTP_ALREADY_VERIFIED") {
        setPhase("verified");
        return;
      }
      if (e?.code === "OTP_NOT_REQUIRED") {
        setPhase("not_required");
        return;
      }
      setAttemptsLeft(
        typeof e?.details?.attemptsLeft === "number" ? e.details.attemptsLeft : null,
      );
      setError(localizedMessage(e?.message, s.otpVerifyFailed, locale));
    } catch {
      setError(s.otpNetworkError);
    } finally {
      setBusy(null);
    }
  }

  async function resend() {
    if (busy || cooldown > 0) return;
    setBusy("resend");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/public/orders/${orderId}/otp/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const json = (await res.json().catch(() => null)) as OtpApiResponse | null;
      if (res.ok) {
        setCode("");
        setAttemptsLeft(null);
        // The endpoint's own cooldown (60s between issues) starts now.
        setCooldown(60);
        setNotice(
          json?.meta?.sms === "queued" ? s.otpResendQueued : s.otpResendNoSms,
        );
        return;
      }
      const e = json?.error;
      if (e?.code === "OTP_ALREADY_VERIFIED") {
        setPhase("verified");
        return;
      }
      if (e?.code === "OTP_NOT_REQUIRED") {
        setPhase("not_required");
        return;
      }
      if (e?.code === "OTP_RESEND_COOLDOWN") {
        setCooldown(
          typeof e.details?.retryAfterSeconds === "number" ? e.details.retryAfterSeconds : 60,
        );
      }
      setError(localizedMessage(e?.message, s.otpSendFailed, locale));
    } catch {
      setError(s.otpNetworkError);
    } finally {
      setBusy(null);
    }
  }

  if (phase === "verified") {
    return (
      <div
        role="status"
        className="mt-4 rounded-xl bg-success-soft px-4 py-3.5 text-left text-sm font-medium text-success-solid"
      >
        {s.otpVerified}
      </div>
    );
  }

  if (phase === "not_required") {
    return (
      <div
        role="status"
        className="mt-4 rounded-xl bg-surface-2 px-4 py-3.5 text-left text-sm text-text-muted"
      >
        {s.otpNotRequired}
      </div>
    );
  }

  return (
    <section
      aria-label={s.otpAriaLabel}
      className="mt-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-4 text-left"
    >
      <h2 className="text-sm font-bold text-text-main">{s.otpTitle}</h2>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        {s.otpIntroBefore}
        <strong>{maskPhone(phone)}</strong>
        {s.otpIntroAfter}
        {smsState && smsState !== "queued" ? s.otpFirstSmsPending : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1">
          <span className="mb-1.5 block text-sm font-medium text-text-main">{s.otpCodeLabel}</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="------"
            aria-label={s.otpCodeAria}
            className="h-12 w-full rounded-xl border border-border bg-card px-4 text-center text-lg font-semibold tracking-[0.3em] text-text-main outline-none transition placeholder:text-text-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
        </label>
        <button
          type="button"
          onClick={verify}
          disabled={busy !== null || code.length !== 6}
          className="brand-gradient flex h-12 shrink-0 items-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "verify" ? s.otpVerifying : s.otpVerify}
        </button>
      </div>
      {attemptsLeft !== null ? (
        <p className="mt-2 text-xs font-medium text-warning-solid">
          {interpolate(s.otpAttemptsLeft, { count: digits(String(attemptsLeft)) })}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-rose-600">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 text-sm font-medium text-success-solid">
          {notice}
        </p>
      ) : null}
      <button
        type="button"
        onClick={resend}
        disabled={busy !== null || cooldown > 0}
        className="mt-3 inline-flex h-10 items-center rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-text-main transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy === "resend"
          ? s.otpSending
          : cooldown > 0
            ? interpolate(s.otpResendWait, { seconds: digits(String(cooldown)) })
            : s.otpResend}
      </button>
    </section>
  );
}

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
 *   endpoint's own bilingual message is shown (Bangla half) — no
 *   error copy is invented here.
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

/** Endpoint messages are "বাংলা / English" pairs; the UI is Bangla. */
function bnMessage(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  const head = message.split(" / ")[0]?.trim();
  return head ? head : message;
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
      setError(bnMessage(e?.message, "যাচাই করা যায়নি। আবার চেষ্টা করুন।"));
    } catch {
      setError("নেটওয়ার্ক সমস্যা — সংযোগ যাচাই করে আবার চেষ্টা করুন।");
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
          json?.meta?.sms === "queued"
            ? "নতুন কোড পাঠানো হয়েছে — ১০ মিনিটের মধ্যে কোডটি ব্যবহার করুন।"
            : "নতুন কোড তৈরি হয়েছে, তবে SMS এখন পাঠানো যায়নি — কিছুক্ষণ পরে আবার চেষ্টা করুন।",
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
      setError(bnMessage(e?.message, "কোড পাঠানো যায়নি। আবার চেষ্টা করুন।"));
    } catch {
      setError("নেটওয়ার্ক সমস্যা — সংযোগ যাচাই করে আবার চেষ্টা করুন।");
    } finally {
      setBusy(null);
    }
  }

  if (phase === "verified") {
    return (
      <div
        role="status"
        className="mt-4 rounded-xl bg-emerald-50 px-4 py-3.5 text-left text-sm font-medium text-emerald-700"
      >
        ✓ ফোন যাচাই সম্পন্ন হয়েছে — ধন্যবাদ! আপনার অর্ডারটি এখন নিশ্চিতকরণের ধাপে এগিয়ে যাবে।
      </div>
    );
  }

  if (phase === "not_required") {
    return (
      <div
        role="status"
        className="mt-4 rounded-xl bg-surface-2 px-4 py-3.5 text-left text-sm text-text-muted"
      >
        এই অর্ডারের জন্য ফোন যাচাই (OTP) প্রয়োজন নেই।
      </div>
    );
  }

  return (
    <section
      aria-label="ফোন যাচাই (OTP)"
      className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-4 text-left"
    >
      <h2 className="text-sm font-bold text-text-main">ফোন যাচাই (OTP) প্রয়োজন</h2>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        অর্ডারটি নিশ্চিত করতে <strong>{maskPhone(phone)}</strong> নম্বরে পাঠানো ৬ সংখ্যার
        কোডটি দিন।
        {smsState && smsState !== "queued"
          ? " প্রথম কোডের SMS এখনো পাঠানো সম্পূর্ণ হয়নি — কোড না পেলে নিচের “আবার কোড পাঠান” বোতামটি ব্যবহার করুন।"
          : ""}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1">
          <span className="mb-1.5 block text-sm font-medium text-text-main">৬ সংখ্যার কোড</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="------"
            aria-label="৬ সংখ্যার OTP কোড"
            className="h-12 w-full rounded-xl border border-border bg-card px-4 text-center text-lg font-semibold tracking-[0.3em] text-text-main outline-none transition placeholder:text-text-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
        </label>
        <button
          type="button"
          onClick={verify}
          disabled={busy !== null || code.length !== 6}
          className="brand-gradient flex h-12 shrink-0 items-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "verify" ? "যাচাই হচ্ছে…" : "যাচাই করুন"}
        </button>
      </div>
      {attemptsLeft !== null ? (
        <p className="mt-2 text-xs font-medium text-amber-700">
          আরও {digits(String(attemptsLeft))}বার ভুল কোড দেওয়ার সুযোগ বাকি আছে।
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-rose-600">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 text-sm font-medium text-emerald-700">
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
          ? "কোড পাঠানো হচ্ছে…"
          : cooldown > 0
            ? `আবার কোড পাঠাতে ${digits(String(cooldown))} সেকেন্ড অপেক্ষা করুন`
            : "আবার কোড পাঠান"}
      </button>
    </section>
  );
}

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
        setError(body.error?.message ?? "সেটআপ শুরু করা যায়নি — আবার চেষ্টা করুন।");
        return;
      }
      setSecret(body.data.secretBase32);
      setOtpauthUrl(body.data.otpauthUrl);
      setCode("");
    } catch {
      setError("সার্ভারে পৌঁছানো যাচ্ছে না — নেটওয়ার্ক দেখে আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrolment() {
    if (!/^\d{6}$/.test(code)) {
      setError("অথেনটিকেটর অ্যাপের ৬ সংখ্যার কোডটি লিখুন।");
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
        setError("কোডটি মেলেনি — অ্যাপে দেখানো বর্তমান কোডটি আবার লিখুন।");
        return;
      }
      setSecret(null);
      setOtpauthUrl(null);
      setCode("");
      setMessage("2FA চালু হয়েছে। পরের লগইন থেকে পাসওয়ার্ডের পর কোড লাগবে।");
      router.refresh();
    } catch {
      setError("সার্ভারে পৌঁছানো যাচ্ছে না — নেটওয়ার্ক দেখে আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">দুই-ধাপ যাচাই (TOTP 2FA)</h2>
        {totpEnabled ? (
          <Badge tone="success">চালু আছে</Badge>
        ) : enrolmentPending ? (
          <Badge tone="warning">সেটআপ অসম্পূর্ণ</Badge>
        ) : (
          <Badge tone="warning">বন্ধ আছে</Badge>
        )}
      </div>
      <p className="mt-2 text-sm text-text-muted">
        অ্যাকাউন্ট: <span className="font-medium text-text-main">{accountLabel}</span>। Google Authenticator / Microsoft
        Authenticator-এর মতো অ্যাপ দিয়ে লগইনের সময় ৬ সংখ্যার কোড লাগবে — পাসওয়ার্ড ফাঁস হলেও অ্যাকাউন্ট সুরক্ষিত থাকবে।
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
            এই গোপন কীটি <strong>শুধু একবারই</strong> দেখানো হচ্ছে। এখনই অথেনটিকেটর অ্যাপে যোগ করুন — এই পেজ ছাড়লে এটি আর
            দেখা যাবে না, তখন নতুন করে সেটআপ শুরু করতে হবে।
          </p>
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">গোপন কী (হাতে লিখুন)</span>
            <code className="block break-all rounded-md bg-surface-2 px-3 py-2 font-mono text-sm">{secret}</code>
          </div>
          {otpauthUrl ? (
            <div>
              <span className="mb-1 block text-xs font-medium text-text-muted">otpauth লিংক (QR-এর বদলে কপি করে অ্যাপে নিন)</span>
              <code className="block break-all rounded-md bg-surface-2 px-3 py-2 font-mono text-xs">{otpauthUrl}</code>
            </div>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-44 flex-1">
              <Input
                label="অ্যাপের ৬ সংখ্যার কোড"
                placeholder="123456"
                inputMode="numeric"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
            <Button onClick={confirmEnrolment} disabled={busy}>
              {busy ? "যাচাই হচ্ছে…" : "কোড দিয়ে চালু করুন"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          {enrolmentPending && !totpEnabled ? (
            <p className="text-sm text-text-muted">
              আগের সেটআপের গোপন কী আবার দেখা সম্ভব নয় (নিরাপত্তার কারণে শুধু একবারই দেখানো হয়) — নতুন করে শুরু করুন।
            </p>
          ) : null}
          <Button onClick={startEnrolment} disabled={busy}>
            {busy ? "হচ্ছে…" : totpEnabled ? "2FA আবার সেটআপ করুন (রিসেট)" : "2FA সেটআপ শুরু করুন"}
          </Button>
          {totpEnabled ? (
            <p className="text-sm text-rose-600">
              সতর্কতা: নতুন সেটআপ শুরু করলেই পুরনো অ্যাপের কোড কাজ করা বন্ধ করে দেবে — নতুন কী অ্যাপে যোগ করে কোড দিয়ে
              নিশ্চিত না করা পর্যন্ত 2FA সম্পূর্ণ হবে না।
            </p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

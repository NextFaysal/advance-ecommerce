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
            ? "কোডটির মেয়াদ শেষ — নতুন কোড পাঠান।"
            : json?.error?.details === "TOO_MANY_ATTEMPTS"
              ? "অনেকবার ভুল কোড দেওয়া হয়েছে — নতুন কোড পাঠান।"
              : (json?.error?.message ?? "যাচাই করা যায়নি।"),
        );
        await load();
        return;
      }
      setCode("");
      setNotice("OTP যাচাই হয়েছে — এখন অর্ডারটি ডেলিভার্ড করা যাবে।");
      await load();
    } catch {
      setError("যাচাই করা যায়নি — সংযোগ যাচাই করুন।");
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
        setError(json?.error?.message ?? "নতুন কোড পাঠানো যায়নি।");
        return;
      }
      setNotice(
        json?.data?.sms === "queued"
          ? "নতুন কোড পাঠানো হয়েছে (SMS queue-তে আছে — worker চালু থাকলে ডেলিভার হবে)।"
          : "নতুন কোড তৈরি হয়েছে, তবে SMS queue-তে পাঠানো যায়নি — কোডটি কাস্টমারকে ফোনে জানিয়ে দিন।",
      );
      await load();
    } catch {
      setError("নতুন কোড পাঠানো যায়নি — সংযোগ যাচাই করুন।");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded || status === null || !status.applicable) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-text-main">পিকআপ OTP</h3>
        {status.verified ? (
          <Badge tone="success">যাচাই হয়েছে</Badge>
        ) : status.issued ? (
          <Badge tone="warning">যাচাই বাকি</Badge>
        ) : (
          <Badge tone="neutral">কোড ইস্যু হয়নি</Badge>
        )}
      </div>

      {status.verified ? (
        <p className="mt-2 text-sm leading-6 text-text-muted">
          কাস্টমারের পিকআপ OTP যাচাই হয়েছে ({formatSubscriptionDate(status.verifiedAt)}) —
          অর্ডারটি ডেলিভার্ড করা যাবে।
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            পিকআপের সময় কাস্টমারের ফোনে পাঠানো ৬-সংখ্যার কোডটি যাচাই করুন। যাচাই ছাড়া এই
            অর্ডার ডেলিভার্ড করা যাবে না।
            {status.issued && !status.expired
              ? ` কোডের মেয়াদ: ${formatSubscriptionDate(status.expiresAt)}${status.attemptsLeft !== null ? ` · চেষ্টা বাকি: ${status.attemptsLeft}` : ""}।`
              : status.issued
                ? " আগের কোডটির মেয়াদ শেষ — নতুন কোড পাঠান।"
                : " এখনো কোনো কোড পাঠানো হয়নি — নতুন কোড পাঠান।"}
          </p>
          {status.issued && !status.expired ? (
            <div className="mt-3 flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="OTP কোড"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="font-mono"
              />
              <Button type="button" disabled={busy || code.length < 4} onClick={verify}>
                যাচাই
              </Button>
            </div>
          ) : null}
          <div className="mt-3">
            <Button type="button" variant="outline" disabled={busy} onClick={resend}>
              নতুন কোড পাঠান
            </Button>
          </div>
        </>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}
    </Card>
  );
}

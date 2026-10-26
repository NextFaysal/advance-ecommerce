"use client";

/**
 * Danger zone: revoke ALL vendor portal sessions (doc 23 wave 54-7
 * follow-up UI). POSTs to /api/v1/admin/vendors/revoke-sessions
 * (vendors.manage server-side), which bumps the vendor portal's
 * token version — every outstanding vendor_session dies at its next
 * request and vendors log in again (phone + OTP). A reason is
 * required by the API (audited as vendors.sessions.revoke_all).
 * The response reports the version bump only — stateless tokens
 * have no live session list, so no session count is shown or
 * invented. Errors (including a 403 for staff without
 * vendors.manage) surface verbatim from the API.
 */
import { useState } from "react";

export default function RevokeVendorSessions() {
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ previousVersion: number; currentVersion: number } | null>(null);

  async function onRevoke() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/v1/admin/vendors/revoke-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            data?: { previousVersion: number; currentVersion: number };
            error?: { code: string; message: string };
          }
        | null;
      if (res.ok && body?.data) {
        setDone({
          previousVersion: body.data.previousVersion,
          currentVersion: body.data.currentVersion,
        });
        setReason("");
        setConfirming(false);
      } else {
        setError(
          body?.error
            ? `${body.error.code}: ${body.error.message}`
            : `HTTP ${res.status} — সেশন বাতিল করা যায়নি।`,
        );
      }
    } catch {
      setError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন। (Network error — try again.)");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-rose-200 bg-rose-50 px-4 py-4 shadow-card">
      <h2 className="text-lg font-semibold text-rose-900">
        বিপজ্জনক এলাকা — সব পোর্টাল সেশন বাতিল
      </h2>
      <p className="mt-1 text-small leading-relaxed text-text-muted">
        সব ভেন্ডরের পোর্টাল সেশন সঙ্গে সঙ্গে বাতিল হয়ে যাবে — পরের অনুরোধেই তাদের আবার
        লগইন (ফোন + OTP) করতে হবে। জরুরি পরিস্থিতিতে (যেমন সেশন টোকেন ফাঁসের সন্দেহে)
        ব্যবহার করুন। কাজটি অডিট লগে থাকে। (Revokes every vendor portal session; audited.)
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-[280px] flex-1 text-small font-semibold">
          কারণ (আবশ্যক)
          <input
            className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-normal"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="কেন সব সেশন বাতিল করা হচ্ছে"
            maxLength={500}
          />
        </label>
        {!confirming ? (
          <button
            type="button"
            disabled={reason.trim().length === 0}
            onClick={() => setConfirming(true)}
            className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            সব পোর্টাল সেশন বাতিল
          </button>
        ) : (
          <>
            <span className="text-small font-semibold text-rose-900">
              নিশ্চিত তো? সব ভেন্ডর লগআউট হয়ে যাবে।
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={onRevoke}
              className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-wait disabled:opacity-50"
            >
              {busy ? "বাতিল হচ্ছে…" : "হ্যাঁ, বাতিল করুন"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold transition hover:bg-surface-2"
            >
              ফিরে যান
            </button>
          </>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-small font-medium text-rose-700">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="mt-2 text-small font-medium text-emerald-700">
          সম্পন্ন হয়েছে — পোর্টাল টোকেন সংস্করণ {done.previousVersion} থেকে{" "}
          <strong>{done.currentVersion}</strong>-এ উন্নীত। সব বিদ্যমান ভেন্ডর সেশন এখন
          অবৈধ; ভেন্ডরদের আবার লগইন করতে হবে।
        </p>
      ) : null}
    </section>
  );
}

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
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { VENDORS_STRINGS } from "./strings";

export default function RevokeVendorSessions() {
  const { locale } = useLocale();
  const s = pick(locale, VENDORS_STRINGS);
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
            : interpolate(s.revokeFailed, { status: res.status }),
        );
      }
    } catch {
      setError(s.networkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-rose-200 bg-rose-50 px-4 py-4 shadow-card">
      <h2 className="text-lg font-semibold text-rose-900">
        {s.dangerTitle}
      </h2>
      <p className="mt-1 text-small leading-relaxed text-text-muted">
        {s.dangerDesc}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-[280px] flex-1 text-small font-semibold">
          {s.reasonLabel}
          <input
            className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-normal"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={s.reasonPlaceholder}
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
            {s.revokeBtn}
          </button>
        ) : (
          <>
            <span className="text-small font-semibold text-rose-900">
              {s.confirmQ}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={onRevoke}
              className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-wait disabled:opacity-50"
            >
              {busy ? s.revoking : s.yesRevoke}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="rounded-md border border-border bg-card px-4 py-2 text-sm font-semibold transition hover:bg-surface-2"
            >
              {s.goBack}
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
          {interpolate(s.doneMsg, { prev: done.previousVersion, curr: done.currentVersion })}
        </p>
      ) : null}
    </section>
  );
}

"use client";

import { useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { RESELLERS_STRINGS } from "./strings";

// Danger zone: revoke ALL reseller portal sessions (doc 23 wave 54-7
// follow-up UI). POSTs to /api/v1/admin/resellers/revoke-sessions
// (resellers.manage + module.reseller gate server-side), which bumps
// the reseller portal's token version — every outstanding portal
// session dies at its next request and resellers log in again.
// A reason is required by the API (the action is audited as
// resellers.sessions.revoke_all). The response reports the version
// bump only — stateless tokens have no live session list, so no
// session count is shown or invented. Errors (including a 403 for
// staff without resellers.manage) surface verbatim from the API.
// Styled plainly to match this legacy page.
export function RevokeResellerSessions() {
  const { locale } = useLocale();
  const s = pick(locale, RESELLERS_STRINGS);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ previousVersion: number; currentVersion: number } | null>(null);

  async function onRevoke() {
    setBusy(true);
    setError("");
    setDone(null);
    try {
      const res = await fetch("/api/v1/admin/resellers/revoke-sessions", {
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
    <section
      style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 8, padding: 16, margin: "16px 0" }}
    >
      <h2 style={{ marginTop: 0, fontSize: 17, color: "#991b1b" }}>{s.dangerTitle}</h2>
      <p style={{ color: "#475569", fontSize: 13, marginTop: 4 }}>{s.dangerDesc}</p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ flex: "1 1 320px", fontSize: 13, fontWeight: 600 }}>
          {s.reasonLabel}
          <input
            style={{
              display: "block",
              width: "100%",
              marginTop: 4,
              padding: "8px 10px",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              fontSize: 14,
            }}
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
            style={{
              padding: "9px 18px",
              borderRadius: 6,
              border: "none",
              background: reason.trim().length === 0 ? "#fca5a5" : "#dc2626",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: reason.trim().length === 0 ? "not-allowed" : "pointer",
            }}
          >
            {s.revokeBtn}
          </button>
        ) : (
          <>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#991b1b" }}>
              {s.confirmQ}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={onRevoke}
              style={{
                padding: "9px 18px",
                borderRadius: 6,
                border: "none",
                background: "#dc2626",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy ? s.revoking : s.yesRevoke}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              style={{
                padding: "9px 18px",
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {s.goBack}
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" style={{ color: "#b91c1c", fontSize: 13, marginBottom: 0 }}>
          {error}
        </p>
      )}
      {done && (
        <p role="status" style={{ color: "#166534", fontSize: 13, marginBottom: 0 }}>
          {interpolate(s.doneMsg, { prev: done.previousVersion, curr: done.currentVersion })}
        </p>
      )}
    </section>
  );
}

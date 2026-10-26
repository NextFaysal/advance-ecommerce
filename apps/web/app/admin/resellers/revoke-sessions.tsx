"use client";

import { useState } from "react";

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
    <section
      style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 8, padding: 16, margin: "16px 0" }}
    >
      <h2 style={{ marginTop: 0, fontSize: 17, color: "#991b1b" }}>
        বিপজ্জনক এলাকা / Danger zone — সব পোর্টাল সেশন বাতিল
      </h2>
      <p style={{ color: "#475569", fontSize: 13, marginTop: 4 }}>
        সব রিসেলারের পোর্টাল সেশন সঙ্গে সঙ্গে বাতিল হয়ে যাবে — পরের অনুরোধেই তাদের আবার
        লগইন করতে হবে। জরুরি পরিস্থিতিতে (যেমন সেশন টোকেন ফাঁসের সন্দেহে) ব্যবহার করুন।
        কাজটি অডিট লগে থাকে। (Revokes every reseller portal session; audited.)
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ flex: "1 1 320px", fontSize: 13, fontWeight: 600 }}>
          কারণ / Reason (আবশ্যক)
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
            placeholder="কেন সব সেশন বাতিল করা হচ্ছে"
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
            সব পোর্টাল সেশন বাতিল
          </button>
        ) : (
          <>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#991b1b" }}>
              নিশ্চিত তো? সব রিসেলার লগআউট হয়ে যাবে।
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
              {busy ? "বাতিল হচ্ছে…" : "হ্যাঁ, বাতিল করুন"}
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
              ফিরে যান
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
          সম্পন্ন হয়েছে — পোর্টাল টোকেন সংস্করণ {done.previousVersion} থেকে{" "}
          <strong>{done.currentVersion}</strong>-এ উন্নীত। সব বিদ্যমান রিসেলার সেশন এখন
          অবৈধ; রিসেলারদের আবার লগইন করতে হবে।
        </p>
      )}
    </section>
  );
}

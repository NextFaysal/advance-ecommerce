"use client";

/**
 * Admin payout decision buttons (ADV-12) — approve / mark-paid /
 * reject for one ResellerPayoutRequest, POSTing to
 * /api/v1/admin/resellers/payouts. "Mark PAID" records that staff paid
 * the reseller EXTERNALLY (bKash/Nagad/bank) — it moves no money here,
 * and the button label says so.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { RESELLERS_STRINGS } from "./strings";

export default function PayoutActions({
  payoutId,
  status,
}: {
  payoutId: string;
  status: string;
}) {
  const { locale } = useLocale();
  const s = pick(locale, RESELLERS_STRINGS);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status === "PAID" || status === "REJECTED") return <span>—</span>;

  async function decide(action: "APPROVED" | "PAID" | "REJECTED") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/resellers/payouts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payoutId, action }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(body.error?.message ?? s.decisionFailed);
        return;
      }
      router.refresh();
    } catch {
      setError(s.decisionFailed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      {status === "PENDING" ? (
        <button type="button" disabled={busy !== null} onClick={() => decide("APPROVED")}>
          {busy === "APPROVED" ? "…" : s.approve}
        </button>
      ) : null}
      {status === "APPROVED" ? (
        <button type="button" disabled={busy !== null} onClick={() => decide("PAID")}>
          {busy === "PAID" ? "…" : s.markPaid}
        </button>
      ) : null}
      <button type="button" disabled={busy !== null} onClick={() => decide("REJECTED")}>
        {busy === "REJECTED" ? "…" : s.reject}
      </button>
      {error ? (
        <span role="alert" style={{ color: "crimson" }}>
          {error}
        </span>
      ) : null}
    </span>
  );
}

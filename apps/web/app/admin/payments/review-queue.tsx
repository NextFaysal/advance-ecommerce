"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Money } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import { EmptyState } from "@/components/ui/empty-state";
import type { ManualTrxSubmission } from "@/integrations/payment";
import { normalizeTrxId } from "@/integrations/sandbox/store";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import {
  dhakaTime,
  findDuplicateTrxCollisions,
  paymentMethodLabel,
} from "./lib";
import { PAYMENTS_STRINGS } from "./strings";

// Manual TrxID review queue — REAL decisions (wired 2026-10-25).
// Approve/reject POSTs to /api/v1/admin/payments/manual-trx
// (permission payments.verify_manual, reason required, audited); the
// server enforces the sandbox rules from src/integrations/sandbox/manual-trx.ts:
//  1. the same (method, normalised TrxID) can never be approved twice;
//  2. a submission is reviewed once only — the action is one-way;
//  3. every review needs a reason of at least 3 characters.
// The duplicate warnings below are computed from the same list the
// server loaded — they are guidance; the server's verdict is final and
// its error message is shown verbatim when a decision is refused.

type ReviewStatus = ManualTrxSubmission["status"];

const STATUS_META: Record<ReviewStatus, { labelKey: "rqPending" | "rqApproved" | "rqRejected"; icon: string; tone: "warning" | "success" | "danger" }> = {
  pending: { labelKey: "rqPending", icon: "◷", tone: "warning" },
  approved: { labelKey: "rqApproved", icon: "✓", tone: "success" },
  rejected: { labelKey: "rqRejected", icon: "✕", tone: "danger" },
};

export function ManualTrxReviewQueue({ submissions }: { submissions: ManualTrxSubmission[] }) {
  const { locale } = useLocale();
  const t = pick(locale, PAYMENTS_STRINGS);
  const router = useRouter();
  const [localStatus, setLocalStatus] = useState<Record<string, ReviewStatus>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [decidedNote, setDecidedNote] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const collisions = useMemo(() => findDuplicateTrxCollisions(submissions), [submissions]);

  const statusOf = (s: ManualTrxSubmission): ReviewStatus => localStatus[s.id] ?? s.status;

  /** Ids (other than this one) whose TrxID is already approved. */
  function approvedTwins(s: ManualTrxSubmission): string[] {
    return submissions
      .filter(
        (o) =>
          o.id !== s.id &&
          o.method === s.method &&
          normalizeTrxId(o.trxId) === normalizeTrxId(s.trxId) &&
          statusOf(o) === "approved",
      )
      .map((o) => o.id);
  }

  async function decide(s: ManualTrxSubmission, action: "approve" | "reject") {
    const reason = (reasons[s.id] ?? "").trim();
    if (reason.length < 3 || busy[s.id]) return;
    if (action === "approve" && approvedTwins(s).length > 0) return; // rule 1 — server enforces too
    setBusy((prev) => ({ ...prev, [s.id]: true }));
    setErrors((prev) => ({ ...prev, [s.id]: "" }));
    try {
      const res = await fetch("/api/v1/admin/payments/manual-trx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: s.id, action, reason }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { data?: { paymentStatus?: string }; error?: { message?: string } }
        | null;
      if (!res.ok) {
        setErrors((prev) => ({
          ...prev,
          [s.id]: payload?.error?.message ?? interpolate(t.rqServerRefused, { status: res.status }),
        }));
        return;
      }
      setLocalStatus((prev) => ({ ...prev, [s.id]: action === "approve" ? "approved" : "rejected" }));
      setDecidedNote((prev) => ({
        ...prev,
        [s.id]:
          action === "approve"
            ? interpolate(t.rqApprovedNote, { status: payload?.data?.paymentStatus ?? "PAID", reason })
            : interpolate(t.rqRejectedNote, { status: payload?.data?.paymentStatus ?? "FAILED", reason }),
      }));
      router.refresh();
    } catch {
      setErrors((prev) => ({ ...prev, [s.id]: t.rqNetworkError }));
    } finally {
      setBusy((prev) => ({ ...prev, [s.id]: false }));
    }
  }

  if (submissions.length === 0) {
    return (
      <EmptyState title={t.rqEmptyTitle} description={t.rqEmptyDesc} />
    );
  }

  return (
    <div className="space-y-4">
      <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-text-muted">
        {t.rqIntro}
      </p>
      {submissions.map((s) => {
        const status = statusOf(s);
        const meta = STATUS_META[status];
        const twins = collisions.get(s.id) ?? [];
        const blockedBy = approvedTwins(s);
        const isDuplicate = twins.length > 0;
        const reason = reasons[s.id] ?? "";
        const canDecide = status === "pending" && reason.trim().length >= 3 && !busy[s.id];
        return (
          <Card key={s.id} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-display text-base font-semibold text-text-main">{t.rqOrder} <span className="tnum">#{s.orderId}</span></span>
              <Badge tone="brand">{paymentMethodLabel(locale, s.method)}</Badge>
              <Badge tone={meta.tone}>
                <span aria-hidden="true">{meta.icon}</span> {t[meta.labelKey]}
              </Badge>
              {isDuplicate ? (
                <Badge tone="danger">
                  <span aria-hidden="true">⚠</span> {t.rqDuplicateSuspect}
                </Badge>
              ) : null}
              <span className="ml-auto text-sm">
                {t.rqAmount}: <Money poisha={s.amountPoisha} />
              </span>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-text-muted">TrxID</dt>
                <dd className="tnum font-mono tabular-nums">{s.trxId}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">{t.rqSenderPhone}</dt>
                <dd><Phone phone={s.senderPhone} /></dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">{t.rqClaimedOrder}</dt>
                <dd className="tnum font-mono tabular-nums">#{s.orderId}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">{t.rqSubmittedAt}</dt>
                <dd className="tnum font-mono tabular-nums">{dhakaTime(s.submittedAt)}</dd>
              </div>
            </dl>

            {isDuplicate ? (
              <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
                ⚠️ {t.rqDupWarning1} ({normalizeTrxId(s.trxId)}) {t.rqDupWarning2}{" "}
                {twins.length} {t.rqDupWarning3}
              </p>
            ) : null}

            {status === "pending" ? (
              <div className="mt-3 space-y-2">
                {blockedBy.length > 0 ? (
                  <p className="rounded-md bg-danger-soft px-3 py-2 text-xs font-medium text-danger">
                    🚫 {t.rqBlocked}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`${t.rqReasonAria} #${s.orderId}`}
                    value={reason}
                    onChange={(e) => setReasons((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    placeholder={t.rqReasonPlaceholder}
                    className="h-10 min-w-0 flex-1 rounded-[10px] border border-border bg-surface-2 px-3 text-sm outline-none focus:border-brand-500"
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!canDecide || blockedBy.length > 0}
                    onClick={() => void decide(s, "approve")}
                  >
                    {t.rqApprove}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!canDecide}
                    onClick={() => void decide(s, "reject")}
                  >
                    {t.rqReject}
                  </Button>
                </div>
                {errors[s.id] ? (
                  <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{errors[s.id]}</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-xs text-text-muted">
                {decidedNote[s.id] ??
                  (s.reviewNote ? interpolate(t.rqPrevNote, { note: s.reviewNote }) : t.rqNoReviewAgain)}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}

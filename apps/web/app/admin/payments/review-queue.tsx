"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import type { ManualTrxSubmission } from "@/integrations/payment";
import { normalizeTrxId } from "@/integrations/sandbox/store";
import {
  dhakaTime,
  findDuplicateTrxCollisions,
  paymentMethodLabelBn,
} from "./lib";

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

const STATUS_META: Record<ReviewStatus, { label: string; icon: string; tone: "warning" | "success" | "danger" }> = {
  pending: { label: "অপেক্ষমাণ (Pending)", icon: "◷", tone: "warning" },
  approved: { label: "অনুমোদিত (Approved)", icon: "✓", tone: "success" },
  rejected: { label: "বাতিল (Rejected)", icon: "✕", tone: "danger" },
};

export function ManualTrxReviewQueue({ submissions }: { submissions: ManualTrxSubmission[] }) {
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
          [s.id]: payload?.error?.message ?? `সার্ভার সিদ্ধান্ত নেয়নি (HTTP ${res.status})।`,
        }));
        return;
      }
      setLocalStatus((prev) => ({ ...prev, [s.id]: action === "approve" ? "approved" : "rejected" }));
      setDecidedNote((prev) => ({
        ...prev,
        [s.id]:
          action === "approve"
            ? `অনুমোদিত ও সংরক্ষিত হয়েছে — অর্ডারের পেমেন্ট অবস্থা: ${payload?.data?.paymentStatus ?? "PAID"}। কারণ: ${reason}`
            : `বাতিল ও সংরক্ষিত হয়েছে — অর্ডারের পেমেন্ট অবস্থা: ${payload?.data?.paymentStatus ?? "FAILED"}। কারণ: ${reason}`,
      }));
      router.refresh();
    } catch {
      setErrors((prev) => ({ ...prev, [s.id]: "নেটওয়ার্ক সমস্যা — সিদ্ধান্ত পাঠানো যায়নি, আবার চেষ্টা করুন।" }));
    } finally {
      setBusy((prev) => ({ ...prev, [s.id]: false }));
    }
  }

  if (submissions.length === 0) {
    return (
      <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-text-muted">
        কোনো ম্যানুয়াল TrxID জমা নেই — গ্রাহক TrxID জমা দিলেই এখানে আসবে।
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-text-muted">
        সিদ্ধান্ত এখান থেকে নিলে তা ডাটাবেসে সংরক্ষিত হয় এবং অডিট লগে থাকে (কারণ বাধ্যতামূলক)।
        অনুমোদনে অর্ডারের পেমেন্ট PAID হয়, বাতিলে FAILED হয়।
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
          <div key={s.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">অর্ডার #{s.orderId}</span>
              <Badge tone="brand">{paymentMethodLabelBn(s.method)}</Badge>
              <Badge tone={meta.tone}>
                <span aria-hidden="true">{meta.icon}</span> {meta.label}
              </Badge>
              {isDuplicate ? (
                <Badge tone="danger">
                  <span aria-hidden="true">⚠</span> ডুপ্লিকেট TrxID সন্দেহ
                </Badge>
              ) : null}
              <span className="ml-auto text-sm">
                পরিমাণ: <Money poisha={s.amountPoisha} />
              </span>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-text-muted">TrxID</dt>
                <dd className="font-mono tabular-nums">{s.trxId}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">প্রেরকের ফোন (মাস্ক করা)</dt>
                <dd><Phone phone={s.senderPhone} /></dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">দাবিকৃত অর্ডার</dt>
                <dd className="font-mono tabular-nums">#{s.orderId}</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">জমার সময় (Asia/Dhaka)</dt>
                <dd className="font-mono tabular-nums">{dhakaTime(s.submittedAt)}</dd>
              </div>
            </dl>

            {isDuplicate ? (
              <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
                ⚠️ সতর্কতা: একই পদ্ধতিতে এই TrxID ({normalizeTrxId(s.trxId)}) আরও{" "}
                {twins.length}টি জমায় আছে। একই (পদ্ধতি, TrxID) কখনো দুইবার অনুমোদন করা যায় না —
                অনুমোদনের আগে কোনটি আসল যাচাই করুন।
              </p>
            ) : null}

            {status === "pending" ? (
              <div className="mt-3 space-y-2">
                {blockedBy.length > 0 ? (
                  <p className="rounded-md bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                    🚫 এই TrxID ইতিমধ্যে অনুমোদিত — নিয়ম ১ অনুযায়ী আবার অনুমোদন
                    সম্ভব নয়। এটি বাতিল করুন।
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`সিদ্ধান্তের কারণ — অর্ডার #${s.orderId}`}
                    value={reason}
                    onChange={(e) => setReasons((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    placeholder="সিদ্ধান্তের কারণ (কমপক্ষে ৩ অক্ষর) — বাধ্যতামূলক"
                    className="h-10 min-w-0 flex-1 rounded-[10px] border border-border bg-surface-2 px-3 text-sm outline-none focus:border-brand-500"
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!canDecide || blockedBy.length > 0}
                    onClick={() => void decide(s, "approve")}
                  >
                    ✓ অনুমোদন
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!canDecide}
                    onClick={() => void decide(s, "reject")}
                  >
                    ✕ বাতিল
                  </Button>
                </div>
                {errors[s.id] ? (
                  <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">{errors[s.id]}</p>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-xs text-text-muted">
                {decidedNote[s.id] ??
                  (s.reviewNote ? `আগের সিদ্ধান্তের নোট: ${s.reviewNote} — একবার সিদ্ধান্ত হলে আবার রিভিউ করা যায় না (নিয়ম ২)।` : "একবার সিদ্ধান্ত হলে আবার রিভিউ করা যায় না (নিয়ম ২)।")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

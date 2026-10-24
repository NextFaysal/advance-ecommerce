"use client";

import { useMemo, useState } from "react";
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
} from "./demo-data";

// Manual TrxID review queue — PAGE-STATE DEMO ONLY.
// Approve/reject here changes nothing outside this page: no API call is
// made and nothing is persisted. The real decision goes through
// POST /api/v1/admin/payments/manual-trx (permission payments.verify_manual,
// reason required, audited) once the DB wiring lands. The page mirrors the
// sandbox rules from src/integrations/sandbox/manual-trx.ts:
//  1. the same (method, normalised TrxID) can never be approved twice;
//  2. a submission is reviewed once only — the action is one-way;
//  3. every review needs a reason of at least 3 characters.

type ReviewStatus = ManualTrxSubmission["status"];

const STATUS_META: Record<ReviewStatus, { label: string; icon: string; tone: "warning" | "success" | "danger" }> = {
  pending: { label: "অপেক্ষমাণ (Pending)", icon: "◷", tone: "warning" },
  approved: { label: "অনুমোদিত (Approved)", icon: "✓", tone: "success" },
  rejected: { label: "বাতিল (Rejected)", icon: "✕", tone: "danger" },
};

export function ManualTrxReviewQueue({ submissions }: { submissions: ManualTrxSubmission[] }) {
  const [statuses, setStatuses] = useState<Record<string, ReviewStatus>>(() =>
    Object.fromEntries(submissions.map((s) => [s.id, s.status])),
  );
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [decidedNote, setDecidedNote] = useState<Record<string, string>>({});

  const collisions = useMemo(() => findDuplicateTrxCollisions(submissions), [submissions]);

  /** Ids (other than this one) whose TrxID is already approved — locally or in the demo data. */
  function approvedTwins(s: ManualTrxSubmission): string[] {
    return submissions
      .filter(
        (o) =>
          o.id !== s.id &&
          o.method === s.method &&
          normalizeTrxId(o.trxId) === normalizeTrxId(s.trxId) &&
          statuses[o.id] === "approved",
      )
      .map((o) => o.id);
  }

  function decide(s: ManualTrxSubmission, action: "approve" | "reject") {
    const reason = (reasons[s.id] ?? "").trim();
    if (reason.length < 3) return;
    if (action === "approve" && approvedTwins(s).length > 0) return; // sandbox rule 1
    setStatuses((prev) => ({ ...prev, [s.id]: action === "approve" ? "approved" : "rejected" }));
    setDecidedNote((prev) => ({
      ...prev,
      [s.id]:
        action === "approve"
          ? `ডেমো সিদ্ধান্ত: অনুমোদিত — আসল ফ্লোতে অর্ডারের পেমেন্ট PAID হতো। কারণ: ${reason}`
          : `ডেমো সিদ্ধান্ত: বাতিল — আসল ফ্লোতে অর্ডারের পেমেন্ট FAILED হতো। কারণ: ${reason}`,
    }));
  }

  return (
    <div className="space-y-3">
      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
        ⚠️ এই কিউয়ের সিদ্ধান্তগুলো <strong>শুধু এই পেজের state</strong> — কোনো API কল হয় না, কিছুই সংরক্ষিত হয় না।
        আসল সিদ্ধান্ত DB wiring-এর পর manual-trx API দিয়ে যাবে (কারণ বাধ্যতামূলক, অডিটসহ)।
      </p>
      {submissions.map((s) => {
        const status = statuses[s.id] ?? s.status;
        const meta = STATUS_META[status];
        const twins = collisions.get(s.id) ?? [];
        const blockedBy = approvedTwins(s);
        const isDuplicate = twins.length > 0;
        const reason = reasons[s.id] ?? "";
        const canDecide = status === "pending" && reason.trim().length >= 3;
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
                ⚠️ সতর্কতা (sandbox নিয়ম): একই পদ্ধতিতে এই TrxID ({normalizeTrxId(s.trxId)}) আরও{" "}
                {twins.length}টি জমায় আছে ({twins.join(", ")})। একই (পদ্ধতি, TrxID) কখনো দুইবার অনুমোদন করা যায় না —
                অনুমোদনের আগে কোনটি আসল যাচাই করুন।
              </p>
            ) : null}

            {status === "pending" ? (
              <div className="mt-3 space-y-2">
                {blockedBy.length > 0 ? (
                  <p className="rounded-md bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                    🚫 এই TrxID ইতিমধ্যে অনুমোদিত ({blockedBy.join(", ")}) — sandbox নিয়ম ১ অনুযায়ী আবার অনুমোদন
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
                    onClick={() => decide(s, "approve")}
                  >
                    ✓ অনুমোদন (ডেমো)
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!canDecide}
                    onClick={() => decide(s, "reject")}
                  >
                    ✕ বাতিল (ডেমো)
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-text-muted">
                {decidedNote[s.id] ??
                  (s.reviewNote ? `আগের সিদ্ধান্তের নোট: ${s.reviewNote} — একবার সিদ্ধান্ত হলে আবার রিভিউ করা যায় না (sandbox নিয়ম ২)।` : "একবার সিদ্ধান্ত হলে আবার রিভিউ করা যায় না (sandbox নিয়ম ২)।")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

"use client";

/**
 * Refund workbench panel — order detail page (doc 17, O0).
 *
 * Talks to /api/v1/admin/orders/[id]/refunds (GET list + summary,
 * POST create) and .../refunds/[refundId] (PATCH status moves).
 * Lifecycle: PENDING → SENT → CONFIRMED, PENDING → CANCELLED.
 *
 * HONEST COPY, by design: the system RECORDS refunds — staff send the
 * money themselves via bKash/Nagad/bank and log the payout reference
 * here. Nothing on this panel sends money, and nothing claims it does.
 *
 * Props are serializable only (the order id); all data is fetched
 * client-side, so a 403 (no payments.view) degrades to a quiet note
 * instead of breaking the order page.
 */
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { formatPoisha } from "@/components/ui/money";
import { RefundStatusBadge } from "../../../../src/orders/components/OrderStatusBadge";
import {
  REFUND_STATUS_VISUAL,
  STATUS_TONE_DOT_CLASS,
} from "../../../../src/orders/components/labels";
import type { RefundStatus as EngineRefundStatus } from "../../../../src/orders/refunds";
import { interpolate, pick, type Locale } from "../../../../src/i18n/locale";
import { useLocale } from "../../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "../strings";
import { formatOrderDateTime } from "../list-helpers";

type RefundMethod = "bkash" | "nagad" | "bank" | "cash" | "gateway" | "other";
type RefundStatus = "PENDING" | "SENT" | "CONFIRMED" | "CANCELLED" | "COMPLETED";

interface RefundView {
  id: string;
  amountPoisha: number;
  method: RefundMethod;
  reference: string | null;
  reason: string;
  status: RefundStatus | string;
  createdByName: string | null;
  createdAt: string;
}

interface RefundSummary {
  grossPaidPoisha: number;
  netPaidPoisha: number;
  refundedPoisha: number;
  pendingRefundPoisha: number;
  refundablePoisha: number;
  refundDuePoisha: number;
}

const METHOD_LABEL: Record<RefundMethod, Record<Locale, string>> = {
  bkash: { bn: "বিকাশ", en: "bKash" },
  nagad: { bn: "নগদ", en: "Nagad" },
  bank: { bn: "ব্যাংক", en: "Bank" },
  cash: { bn: "ক্যাশ", en: "Cash" },
  gateway: { bn: "গেটওয়ে", en: "Gateway" },
  other: { bn: "অন্যান্য", en: "Other" },
};

const STATUS_LABEL: Record<string, Record<Locale, string>> = {
  PENDING: { bn: "অপেক্ষমাণ", en: "Pending" },
  SENT: { bn: "পাঠানো হয়েছে", en: "Sent" },
  CONFIRMED: { bn: "নিশ্চিত", en: "Confirmed" },
  COMPLETED: { bn: "সম্পন্ন (গেটওয়ে)", en: "Completed (gateway)" },
  CANCELLED: { bn: "বাতিল", en: "Cancelled" },
};

const STATUS_TONE_MAP: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  PENDING: "warning",
  SENT: "info",
  CONFIRMED: "success",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

const inputCls =
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

/* OD4 (doc 19 §3-S4) — the refund lifecycle as a mini-stepper, drawn
 * from the OD0 status language (REFUND_STATUS_VISUAL tones/icons).
 * Presentation only: the legal moves stay in moveStatus + the API.
 * COMPLETED (gateway-final) renders as all steps done; CANCELLED
 * renders no stepper — its badge carries the state. */
const REFUND_STEPS: Array<{ status: EngineRefundStatus }> = [
  { status: "PENDING" },
  { status: "SENT" },
  { status: "CONFIRMED" },
];

function RefundStepper({ status }: { status: string }) {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const currentIdx =
    status === "COMPLETED" ? REFUND_STEPS.length - 1 : REFUND_STEPS.findIndex((st) => st.status === status);
  if (currentIdx < 0) return null;
  return (
    <ol className="mt-2.5 flex items-center gap-1.5" aria-label={s.rfStepsAria}>
      {REFUND_STEPS.map((step, i) => {
        const visual = REFUND_STATUS_VISUAL[step.status];
        const reached = i <= currentIdx;
        const isCurrent = i === currentIdx;
        return (
          <li key={step.status} className={`flex items-center gap-1.5 ${i < REFUND_STEPS.length - 1 ? "flex-1" : ""}`}>
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white ${
                reached ? STATUS_TONE_DOT_CLASS[visual.tone] : "bg-slate-200 text-slate-400"
              } ${isCurrent ? "ring-2 ring-offset-1 ring-border" : ""}`}
            >
              <Icon name={i < currentIdx ? "check" : visual.icon} size={11} />
            </span>
            <span className={`whitespace-nowrap text-caption ${isCurrent ? "font-semibold text-text-main" : reached ? "text-text-muted" : "text-text-subtle"}`}>
              {locale === "bn" ? visual.labelBn : visual.labelEn}
            </span>
            {i < REFUND_STEPS.length - 1 ? (
              <span aria-hidden="true" className={`h-px flex-1 ${i < currentIdx ? "bg-emerald-400" : "bg-border"}`} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

const CANONICAL_REFUND_STATUSES: ReadonlySet<string> = new Set(["PENDING", "SENT", "CONFIRMED", "CANCELLED"]);

export function RefundsPanel({ orderId }: { orderId: string }) {
  const { locale, t } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const [refunds, setRefunds] = useState<RefundView[] | null>(null);
  const [summary, setSummary] = useState<RefundSummary | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create-form state (amount entered in TAKA, sent as amountTaka).
  const [amountTaka, setAmountTaka] = useState("");
  const [method, setMethod] = useState<RefundMethod>("bkash");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  // Per-row payout reference input, used when marking SENT.
  const [sentRefs, setSentRefs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/refunds`);
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      const json = (await res.json().catch(() => ({}))) as {
        data?: { refunds: RefundView[]; summary: RefundSummary };
      };
      if (json.data) {
        setRefunds(json.data.refunds);
        setSummary(json.data.summary);
      }
    } catch {
      /* panel stays quiet on network failure; the page itself works */
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createRefund() {
    const taka = Number(amountTaka);
    if (!Number.isFinite(taka) || taka <= 0) {
      setError(s.rfInvalidAmount);
      return;
    }
    if (!reason.trim()) {
      setError(s.rfReasonRequired);
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/refunds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountTaka: taka,
          method,
          reference: reference.trim() || null,
          reason: reason.trim(),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(json.error?.message ?? s.rfCreateFail);
        return;
      }
      setAmountTaka("");
      setReference("");
      setReason("");
      setMessage(s.rfCreatedMsg);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function moveStatus(refund: RefundView, to: "SENT" | "CONFIRMED" | "CANCELLED") {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/v1/admin/orders/${encodeURIComponent(orderId)}/refunds/${encodeURIComponent(refund.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to,
            reference: to === "SENT" ? (sentRefs[refund.id]?.trim() || refund.reference || undefined) : undefined,
          }),
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(json.error?.message ?? s.rfMoveFail);
        return;
      }
      setMessage(
        to === "SENT" ? s.rfSentMsg : to === "CONFIRMED" ? s.rfConfirmedMsg : s.rfCancelledMsg,
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) {
    return (
      <Card className="p-5">
        <h3 className="font-display text-base font-semibold">{s.rfTitleShort}</h3>
        <p className="mt-2 text-small text-text-muted">{s.rfForbiddenNote}</p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h3 className="font-display text-base font-semibold">{s.rfTitle}</h3>
      <p className="mt-1.5 text-small leading-relaxed text-text-muted">
        {s.rfIntro1} <strong>{s.rfIntroStrong}</strong> {s.rfIntro2}
      </p>

      {summary && summary.refundDuePoisha > 0 && (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-warning-solid/40 bg-warning-soft px-4 py-3"
        >
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {interpolate(s.rfDueTitle, { amount: formatPoisha(summary.refundDuePoisha) })}
          </p>
          <p className="mt-0.5 text-small text-amber-800 dark:text-amber-300">{s.rfDueBody}</p>
        </div>
      )}

      {summary && (
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-surface-2 px-2 py-2.5">
            <dt className="text-caption text-text-subtle">{s.rfGrossPaid}</dt>
            <dd className="mt-0.5 text-sm font-semibold">{formatPoisha(summary.grossPaidPoisha)}</dd>
          </div>
          <div className="rounded-lg bg-surface-2 px-2 py-2.5">
            <dt className="text-caption text-text-subtle">{s.rfRefunded}</dt>
            <dd className="mt-0.5 text-sm font-semibold">{formatPoisha(summary.refundedPoisha)}</dd>
          </div>
          <div className="rounded-lg bg-surface-2 px-2 py-2.5">
            <dt className="text-caption text-text-subtle">{s.rfRefundable}</dt>
            <dd className="mt-0.5 text-sm font-semibold">{formatPoisha(summary.refundablePoisha)}</dd>
          </div>
        </dl>
      )}

      {/* History */}
      <div className="mt-4 space-y-2.5">
        {refunds === null ? (
          <p className="text-small text-text-subtle">{t.loading}</p>
        ) : refunds.length === 0 ? (
          <p className="text-small text-text-subtle">{s.rfNone}</p>
        ) : (
          refunds.map((r) => {
            const uiLabel = STATUS_LABEL[r.status]
              ? pick(locale, STATUS_LABEL[r.status])
              : r.status;
            const uiTone = STATUS_TONE_MAP[r.status] ?? "neutral";
            return (
              <div key={r.id} className="rounded-xl border border-border px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{formatPoisha(r.amountPoisha)}</span>
                  {CANONICAL_REFUND_STATUSES.has(r.status) ? (
                    <RefundStatusBadge status={r.status as EngineRefundStatus} lang={locale} />
                  ) : (
                    <Badge tone={uiTone}>{uiLabel}</Badge>
                  )}
                  <span className="text-caption text-text-subtle">
                    {METHOD_LABEL[r.method] ? pick(locale, METHOD_LABEL[r.method]) : r.method}
                    {r.reference ? ` · TrxID: ${r.reference}` : ""}
                  </span>
                </div>
                <RefundStepper status={r.status} />
                <p className="mt-1 text-small leading-relaxed text-text-muted">{r.reason}</p>
                <p className="mt-0.5 text-caption text-text-subtle">
                  {r.createdByName ? `${r.createdByName} · ` : ""}
                  {formatOrderDateTime(r.createdAt, locale)}
                </p>
                {r.status === "PENDING" && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {!r.reference && (
                      <input
                        aria-label={s.rfTrxAria}
                        value={sentRefs[r.id] ?? ""}
                        onChange={(e) => setSentRefs((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        placeholder={s.rfTrxPlaceholder}
                        className="h-10 min-w-44 flex-1 rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                      />
                    )}
                    <Button size="sm" disabled={busy} onClick={() => void moveStatus(r, "SENT")}>
                      {s.rfSentBtn}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void moveStatus(r, "CANCELLED")}>
                      {t.cancel}
                    </Button>
                  </div>
                )}
                {r.status === "SENT" && (
                  <div className="mt-2.5">
                    <Button size="sm" disabled={busy} onClick={() => void moveStatus(r, "CONFIRMED")}>
                      {s.rfConfirmBtn}
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Create form */}
      <div className="mt-5 border-t border-border pt-4">
        <h4 className="text-sm font-semibold">{s.rfNewTitle}</h4>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-text-muted">{s.rfAmountLabel}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amountTaka}
              onChange={(e) => setAmountTaka(e.target.value)}
              placeholder="500"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-caption font-medium text-text-muted">{s.rfMethodLabel}</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as RefundMethod)} className={inputCls}>
              {(Object.keys(METHOD_LABEL) as RefundMethod[]).map((m) => (
                <option key={m} value={m}>
                  {pick(locale, METHOD_LABEL[m])}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-2.5 block">
          <span className="mb-1 block text-caption font-medium text-text-muted">{s.rfRefLabel}</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={s.rfRefPlaceholder}
            className={inputCls}
          />
        </label>
        <label className="mt-2.5 block">
          <span className="mb-1 block text-caption font-medium text-text-muted">{s.rfReasonLabel}</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={s.rfReasonPlaceholder}
            className={inputCls}
          />
        </label>
        <Button className="mt-3.5 w-full" disabled={busy} onClick={() => void createRefund()}>
          {s.rfCreateBtn}
        </Button>
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3.5 py-2.5 text-small leading-relaxed text-danger">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="mt-3 rounded-md bg-surface-2 px-3.5 py-2.5 text-small leading-relaxed">
            {message}
          </p>
        )}
      </div>
    </Card>
  );
}

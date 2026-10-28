"use client";

/**
 * Approvals panel (ADV-27) — self-fetching over
 * GET /api/v1/admin/approvals + POST /api/v1/admin/approvals/[id]/decide.
 *
 * Shows the live orders.approvals.* configuration (so staff can see
 * WHICH rule produced the queue), the pending requests with the
 * exact numbers that blocked the action, and the recent decision
 * history. Approve/Reject call the decide route (orders.edit —
 * Owner/Manager); reject requires a reason, enforced server-side
 * and mirrored here. When approvals are disabled in Settings the
 * queue is informational only — new blocks stop occurring, and the
 * panel says so instead of implying the gate is live.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, type Locale } from "@/i18n/locale";
import { APPROVALS_STRINGS, type ApprovalsStrings } from "./strings";

interface ApprovalConfigView {
  enabled: boolean;
  discountThresholdBps: number;
  refundThresholdPoisha: number;
}

interface ApprovalEntry {
  id: string;
  kind: "discount" | "refund";
  orderId: string;
  refundId: string | null;
  discountPoisha: number | null;
  subtotalPoisha: number | null;
  discountBps: number | null;
  thresholdBps: number | null;
  amountPoisha: number | null;
  thresholdPoisha: number | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedById: string | null;
  requestedByName: string | null;
  requestedAt: string;
  decidedById: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  orderNo: string | null;
  orderStatus: string | null;
  customerName: string | null;
  refundStatus: string | null;
}

function makeDateFmt(locale: Locale): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeZone: "Asia/Dhaka",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function pctLabel(bps: number | null): string {
  if (bps === null) return "—";
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

function EntryCard({
  entry,
  busy,
  onDecide,
  t,
  dateFmt,
}: {
  entry: ApprovalEntry;
  busy: boolean;
  onDecide: (entry: ApprovalEntry, decision: "APPROVED" | "REJECTED", reason: string) => void;
  t: ApprovalsStrings;
  dateFmt: Intl.DateTimeFormat;
}) {
  const [reason, setReason] = useState("");
  const pending = entry.status === "PENDING";
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={entry.kind === "discount" ? "warning" : "info"}>
              {entry.kind === "discount" ? t.kindDiscount : t.kindRefund}
            </Badge>
            <Badge
              tone={entry.status === "PENDING" ? "warning" : entry.status === "APPROVED" ? "success" : "danger"}
            >
              {entry.status === "PENDING"
                ? t.statusPending
                : entry.status === "APPROVED"
                  ? t.statusApproved
                  : t.statusRejected}
            </Badge>
            {entry.orderNo && (
              <Link href={`/admin/orders/${entry.orderId}`} className="font-medium underline">
                {entry.orderNo}
              </Link>
            )}
            {entry.customerName && <span className="text-text-muted">{entry.customerName}</span>}
          </div>
          {entry.kind === "discount" ? (
            <p className="tnum text-sm">
              {entry.discountPoisha !== null && entry.subtotalPoisha !== null
                ? interpolate(t.discountLine, {
                    pct: pctLabel(entry.discountBps),
                    discount: formatBdt(entry.discountPoisha),
                    subtotal: formatBdt(entry.subtotalPoisha),
                    threshold: pctLabel(entry.thresholdBps),
                  })
                : interpolate(t.discountLineShort, {
                    pct: pctLabel(entry.discountBps),
                    threshold: pctLabel(entry.thresholdBps),
                  })}
            </p>
          ) : (
            <p className="tnum text-sm">
              {interpolate(t.refundLine, {
                amount: entry.amountPoisha !== null ? formatBdt(entry.amountPoisha) : "—",
                threshold: entry.thresholdPoisha !== null ? formatBdt(entry.thresholdPoisha) : "—",
              })}
              {entry.refundStatus && <> {interpolate(t.refundStatusNow, { status: entry.refundStatus })}</>}
            </p>
          )}
          <p className="text-xs text-text-muted">
            {t.requestedBy}: {entry.requestedByName ?? entry.requestedById ?? "—"} · {dateFmt.format(new Date(entry.requestedAt))}
            {entry.decidedAt && (
              <>
                {" "}
                · {t.decidedBy}: {entry.decidedByName ?? entry.decidedById ?? "—"} ·{" "}
                {dateFmt.format(new Date(entry.decidedAt))}
                {entry.decisionReason && <> · {t.reasonLabel}: {entry.decisionReason}</>}
              </>
            )}
          </p>
        </div>
        {pending && (
          <div className="flex min-w-64 flex-col gap-2">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.reasonPlaceholder}
              maxLength={500}
            />
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => onDecide(entry, "APPROVED", reason)}>
                {t.approve}
              </Button>
              <Button
                variant="outline"
                disabled={busy || reason.trim() === ""}
                onClick={() => onDecide(entry, "REJECTED", reason)}
              >
                {t.reject}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export function ApprovalsPanel() {
  const { locale } = useLocale();
  const t = APPROVALS_STRINGS[locale];
  const dateFmt = useMemo(() => makeDateFmt(locale), [locale]);
  const [config, setConfig] = useState<ApprovalConfigView | null>(null);
  const [entries, setEntries] = useState<ApprovalEntry[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await fetch("/api/v1/admin/approvals");
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      setConfig(body.data.config);
      setEntries(body.data.entries);
      setLoadState("ready");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t.loadFailed);
      setLoadState("error");
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (entry: ApprovalEntry, decision: "APPROVED" | "REJECTED", reason: string) => {
      setBusyId(entry.id);
      setMessage("");
      try {
        const res = await fetch(`/api/v1/admin/approvals/${entry.id}/decide`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision, reason: reason.trim() ? reason.trim() : undefined }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
        setMessage(decision === "APPROVED" ? t.approvedNote : t.rejectedNote);
        await load();
      } catch (e) {
        setMessage(e instanceof Error ? e.message : t.decideFailed);
      } finally {
        setBusyId(null);
      }
    },
    [load, t],
  );

  const pending = entries.filter((e) => e.status === "PENDING");
  const decided = entries.filter((e) => e.status !== "PENDING").slice(0, 50);

  return (
    <div className="space-y-6">
      {config && (
        <Card className="text-sm">
          {config.enabled ? (
            <p>
              {t.configEnabledA}
              <strong>{t.configEnabledOn}</strong>
              {interpolate(t.configEnabledB, {
                pct: pctLabel(config.discountThresholdBps),
                amount: formatBdt(config.refundThresholdPoisha),
              })}
            </p>
          ) : (
            <p>
              {t.configDisabledA}
              <strong>{t.configDisabledOff}</strong>
              {t.configDisabledB}
            </p>
          )}
        </Card>
      )}
      {message && <Card className="text-sm">{message}</Card>}
      {loadState === "loading" && <p className="text-sm text-text-muted">{t.loading}</p>}
      {loadState === "error" && <p className="text-sm text-danger">{t.loadError}</p>}
      {loadState === "ready" && pending.length === 0 && <Card className="text-sm">{t.noPending}</Card>}
      {pending.map((entry) => (
        <EntryCard key={entry.id} entry={entry} busy={busyId === entry.id} onDecide={decide} t={t} dateFmt={dateFmt} />
      ))}
      {decided.length > 0 && (
        <>
          <h2 className="font-display text-lg font-semibold text-text-main">{t.recentDecisions}</h2>
          {decided.map((entry) => (
            <EntryCard key={entry.id} entry={entry} busy={false} onDecide={decide} t={t} dateFmt={dateFmt} />
          ))}
        </>
      )}
    </div>
  );
}

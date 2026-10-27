"use client";

/**
 * Returns queue (RMA) — REAL data from GET /api/v1/admin/returns
 * (wave 25, doc 17 batch O7), lifecycle moves via
 * POST /api/v1/admin/returns/[id].
 *
 * Lifecycle: REQUESTED → APPROVED → RECEIVED → COMPLETED, with
 * REJECTED (reason required) and CLOSED (all-damaged, no refund) as
 * side exits. The RECEIVE step is where stock is decided: lines marked
 * "ভালো (restockable)" go back on the shelf server-side; "নষ্ট
 * (damaged)" lines never restock and are never refunded. COMPLETE
 * records ONE PENDING refund in the refund workbench for the
 * restockable lines' goods value — staff send the money themselves
 * and mark it SENT there. Nothing on this page moves money.
 *
 * Phones arrive MASKED from the API; the full number never reaches
 * this page.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { formatPoisha } from "@/components/ui/money";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick, type Locale } from "@/i18n/locale";
import { RETURNS_STRINGS, type ReturnsStrings } from "./strings";

type ReturnStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "RECEIVED" | "COMPLETED" | "CLOSED";

interface ReturnItemView {
  id: string;
  orderItemId: string;
  productName: string;
  sku: string;
  unitPricePoisha: number;
  orderedQuantity: number;
  quantity: number;
  reason: string | null;
  condition: "restockable" | "damaged" | null;
  lineValuePoisha: number;
}

interface ReturnView {
  id: string;
  orderId: string;
  orderNo: string;
  customerName: string;
  customerPhoneMasked: string;
  source: string;
  status: ReturnStatus | string;
  reason: string;
  customerNote: string | null;
  decisionReason: string | null;
  qcNote: string | null;
  restockDecision: string | null;
  refundId: string | null;
  items: ReturnItemView[];
  goodsValuePoisha: number;
  refundableValuePoisha: number;
  createdAt: string;
}

/* OD6 (doc 19 §3-S6) — return states in the OD0 visual shape
 * ({ tone, icon, labelBn }): same Badge tones as ORDER_STATUS_VISUAL,
 * icons verified against src/components/ui/icon.tsx. Return-specific
 * states live here, not in labels.ts, because the RMA lifecycle is not
 * the order state machine. */
const RETURN_STATUS_VISUAL: Record<
  string,
  { tone: "success" | "warning" | "danger" | "info" | "neutral"; icon: IconName; labelKey: keyof ReturnsStrings }
> = {
  REQUESTED: { tone: "warning", icon: "clock", labelKey: "statusRequested" },
  APPROVED: { tone: "info", icon: "check", labelKey: "statusApproved" },
  REJECTED: { tone: "danger", icon: "x", labelKey: "statusRejected" },
  RECEIVED: { tone: "info", icon: "package", labelKey: "statusReceived" },
  COMPLETED: { tone: "success", icon: "check", labelKey: "statusCompleted" },
  CLOSED: { tone: "neutral", icon: "x", labelKey: "statusClosed" },
  EXCHANGED: { tone: "info", icon: "refresh-ccw", labelKey: "statusExchanged" },
};

const FILTERS: { key: string; labelKey: keyof ReturnsStrings }[] = [
  { key: "", labelKey: "filterAll" },
  { key: "REQUESTED", labelKey: "filterRequested" },
  { key: "APPROVED", labelKey: "filterApproved" },
  { key: "RECEIVED", labelKey: "filterReceived" },
  { key: "COMPLETED", labelKey: "filterCompleted" },
  { key: "REJECTED", labelKey: "filterRejected" },
  { key: "CLOSED", labelKey: "filterClosed" },
];

const inputCls =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const selectCls =
  "h-10 rounded-md border border-border bg-card px-2 text-sm shadow-sm outline-none transition focus:border-brand-500";

function fmtDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(intlLocale(locale), {
    timeZone: "Asia/Dhaka",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AdminReturnsPage() {
  const { locale } = useLocale();
  const s = pick(locale, RETURNS_STRINGS);
  const [rows, setRows] = useState<ReturnView[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Per-expanded-row working state.
  const [conditions, setConditions] = useState<Record<string, "restockable" | "damaged">>({});
  const [qcNote, setQcNote] = useState("");
  const [decisionReason, setDecisionReason] = useState("");

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (status) qs.set("status", status);
      const res = await fetch(`/api/v1/admin/returns?${qs.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      setRows(json.data ?? []);
      setTotal(json.meta?.total ?? 0);
      setCounts(json.meta?.counts ?? {});
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : s.loadFailedFallback);
      setRows([]);
    }
  }, [page, status, s]);

  useEffect(() => {
    void load();
  }, [load]);

  function expand(row: ReturnView) {
    if (expandedId === row.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(row.id);
    setConditions(
      Object.fromEntries(row.items.map((i) => [i.orderItemId, (i.condition ?? "restockable") as "restockable" | "damaged"])),
    );
    setQcNote(row.qcNote ?? "");
    setDecisionReason("");
    setActionError(null);
  }

  async function act(row: ReturnView, to: ReturnStatus) {
    setBusyId(row.id);
    setActionError(null);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = { to };
      if (to === "REJECTED" || to === "CLOSED") payload.reason = decisionReason;
      if (to === "RECEIVED") {
        payload.lineConditions = row.items.map((i) => ({
          orderItemId: i.orderItemId,
          condition: conditions[i.orderItemId] ?? "restockable",
        }));
        if (qcNote.trim()) payload.qcNote = qcNote.trim();
      }
      const res = await fetch(`/api/v1/admin/returns/${row.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      setNotice(
        to === "COMPLETED"
          ? interpolate(s.noticeCompleted, {
              amount: formatPoisha(json.data?.refundAmountPoisha ?? row.refundableValuePoisha),
            })
          : s.noticeSaved,
      );
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : s.actionFailedFallback);
    } finally {
      setBusyId(null);
    }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <PageHeader title={s.title} description={s.description} />

      <div className="mt-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key || "ALL"}
            type="button"
            onClick={() => {
              setStatus(f.key);
              setPage(1);
            }}
            className={`rounded-full border px-3.5 py-1.5 text-small font-medium transition ${
              status === f.key
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-border bg-card text-text-muted hover:text-text-main"
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300`}
          >
            {s[f.labelKey]}
            <span className="ml-1.5 text-caption text-text-subtle">
              {f.key === "" ? (counts.ALL ?? 0) : (counts[f.key] ?? 0)}
            </span>
          </button>
        ))}
      </div>

      {notice && (
        <p role="status" className="mt-4 rounded-md bg-success-50 px-3.5 py-2.5 text-small text-success-700">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mt-4 rounded-md bg-danger-50 px-3.5 py-2.5 text-small text-danger-700">
          {actionError}
        </p>
      )}
      {loadError && (
        <p role="alert" className="mt-4 rounded-md bg-danger-50 px-3.5 py-2.5 text-small text-danger-700">
          {loadError}
        </p>
      )}

      {rows === null ? (
        <div className="mt-4">
          <SkeletonTable rows={5} />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={s.emptyTitle} description={s.emptyDescription} />
        </div>
      ) : (
      <Card className="mt-4 overflow-hidden p-0">
          <ul className="divide-y divide-border">
            {rows.map((row) => {
              const ui = RETURN_STATUS_VISUAL[row.status] ?? { labelKey: null, tone: "neutral" as const, icon: "info" as IconName };
              const expanded = expandedId === row.id;
              const busy = busyId === row.id;
              return (
                <li key={row.id} className="px-4 py-3.5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3">
                    <Link href={`/admin/orders/${row.orderId}`} className="font-mono text-small font-semibold text-brand-700 hover:underline">
                      {row.orderNo}
                    </Link>
                    <span className="text-small text-text-main">{row.customerName}</span>
                    <span className="text-small text-text-muted">{row.customerPhoneMasked}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={ui.tone} icon={<Icon name={ui.icon} size={12} />}>{ui.labelKey ? s[ui.labelKey] : row.status}</Badge>
                      <Badge tone="neutral">{row.source === "customer" ? s.sourceCustomer : s.sourceAdmin}</Badge>
                      {row.refundId ? (
                        <Badge tone="info" icon={<Icon name="banknote" size={12} />}>
                          {s.refundAttached}
                        </Badge>
                      ) : null}
                    </span>
                    <span className="text-small text-text-muted">
                      {interpolate(s.itemsSummary, { count: row.items.reduce((sum, i) => sum + i.quantity, 0), amount: formatPoisha(row.goodsValuePoisha) })}
                    </span>
                    <span className="text-caption text-text-subtle">{fmtDate(row.createdAt, locale)}</span>
                    <Button size="sm" variant="outline" className="w-full sm:ml-auto sm:w-auto" onClick={() => expand(row)}>
                      {expanded ? s.close : s.details}
                    </Button>
                  </div>

                  {expanded && (
                    <div className="mt-3 rounded-md bg-surface-2 px-3.5 py-3">
                      <p className="text-small text-text-muted">
                        {s.reasonLabel} <span className="text-text-main">{row.reason}</span>
                        {row.customerNote ? <> · {s.noteLabel} {row.customerNote}</> : null}
                        {row.decisionReason ? <> · {s.decisionReasonLabel} {row.decisionReason}</> : null}
                        {row.restockDecision ? <><br />{row.restockDecision}</> : null}
                        {row.refundId ? (
                          <>
                            <br />
                            {s.refundRecordPrefix} <span className="font-mono">{row.refundId}</span> {s.refundRecordSuffix}
                          </>
                        ) : null}
                      </p>

                      <ul className="mt-3 divide-y divide-border/60 border-t border-border/60 text-small">
                        {row.items.map((item) => (
                          <li key={item.id} className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:gap-3">
                            <span className="min-w-0 flex-1">
                              {item.productName}
                              <span className="block text-caption text-text-subtle">{item.sku}</span>
                            </span>
                            <span className="text-text-muted">
                              ×{item.quantity} · {formatPoisha(item.lineValuePoisha)}
                            </span>
                            {row.status === "APPROVED" ? (
                              <select
                                className={selectCls}
                                value={conditions[item.orderItemId] ?? "restockable"}
                                onChange={(e) =>
                                  setConditions((prev) => ({
                                    ...prev,
                                    [item.orderItemId]: e.target.value as "restockable" | "damaged",
                                  }))
                                }
                              >
                                <option value="restockable">{s.conditionGoodOption}</option>
                                <option value="damaged">{s.conditionDamagedOption}</option>
                              </select>
                            ) : item.condition === "restockable" ? (
                              <Badge tone="success" icon={<Icon name="check" size={12} />}>
                                {s.conditionGoodBadge}
                              </Badge>
                            ) : item.condition === "damaged" ? (
                              <Badge tone="danger" icon={<Icon name="alert" size={12} />}>
                                {s.conditionDamagedBadge}
                              </Badge>
                            ) : (
                              <span className="text-text-subtle">—</span>
                            )}
                          </li>
                        ))}
                      </ul>

                      {(row.status === "APPROVED" || row.status === "REQUESTED" || row.status === "RECEIVED") && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {row.status === "APPROVED" && (
                            <input
                              className={inputCls}
                              placeholder={s.qcNotePlaceholder}
                              value={qcNote}
                              onChange={(e) => setQcNote(e.target.value)}
                            />
                          )}
                          {(row.status === "REQUESTED" || row.status === "RECEIVED") && (
                            <input
                              className={inputCls}
                              placeholder={s.decisionReasonPlaceholder}
                              value={decisionReason}
                              onChange={(e) => setDecisionReason(e.target.value)}
                            />
                          )}
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        {row.status === "REQUESTED" && (
                          <>
                            <Button size="sm" disabled={busy} onClick={() => void act(row, "APPROVED")}>
                              {s.approve}
                            </Button>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(row, "REJECTED")}>
                              {s.reject}
                            </Button>
                          </>
                        )}
                        {row.status === "APPROVED" && (
                          <Button size="sm" disabled={busy} onClick={() => void act(row, "RECEIVED")}>
                            {s.receive}
                          </Button>
                        )}
                        {row.status === "RECEIVED" && (
                          <>
                            <Button size="sm" disabled={busy} onClick={() => void act(row, "COMPLETED")}>
                              {interpolate(s.completeWithRefund, { amount: formatPoisha(row.refundableValuePoisha) })}
                            </Button>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(row, "CLOSED")}>
                              {s.closeNoRefund}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
      </Card>
        )}

      <div className="mt-4 flex items-center justify-between text-small text-text-muted">
        <span>{interpolate(s.totalPageLine, { total, page, pages })}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            {s.previous}
          </Button>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
            {s.next}
          </Button>
        </div>
      </div>
    </main>
  );
}

"use client";

/**
 * Support ticket queue (client). Reads GET /api/v1/admin/tickets,
 * opens a thread from GET /api/v1/admin/tickets/[id], replies via
 * POST .../[id]/reply and changes status via PATCH .../[id] — the
 * admin tickets API (SupportTicket tables via Prisma). Customer
 * phone arrives MASKED from the API and is shown as-is.
 *
 * Permissions mirror the API: the queue reads on customers.view,
 * replies/status writes require customers.edit (the API enforces
 * both; a 403 surfaces as the row error below).
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useLocale } from "@/i18n/LocaleProvider";
import { intlLocale, interpolate, pick, type Locale } from "@/i18n/locale";
import { CannedReplyPicker } from "./support-tools";
import { TICKETS_STRINGS } from "./strings";

type TicketStatus = "OPEN" | "PENDING" | "CLOSED";

type TicketSlaState = "OK" | "AT_RISK" | "BREACHED";

interface TicketSla {
  firstResponseDueAt: string;
  firstResponseAt: string | null;
  firstResponseBreached: boolean;
  resolutionDueAt: string;
  resolutionBreached: boolean;
  state: TicketSlaState;
}

type BadgeTone = "success" | "warning" | "danger";

function slaBadge(locale: Locale, state: TicketSlaState): { label: string; tone: BadgeTone } {
  const s = pick(locale, TICKETS_STRINGS);
  const map: Record<TicketSlaState, { label: string; tone: BadgeTone }> = {
    OK: { label: s.slaOk, tone: "success" },
    AT_RISK: { label: s.slaAtRisk, tone: "warning" },
    BREACHED: { label: s.slaBreached, tone: "danger" },
  };
  return map[state];
}

interface TicketMessage {
  id: string;
  authorType: "CUSTOMER" | "STAFF";
  body: string;
  createdAt: string;
}

interface AdminTicket {
  id: string;
  subject: string;
  status: TicketStatus;
  orderId: string | null;
  orderNo: string | null;
  messageCount: number;
  lastMessagePreview: string | null;
  createdAt: string;
  updatedAt: string;
  customerName: string;
  customerPhoneMasked: string;
  sla?: TicketSla;
  messages?: TicketMessage[];
}

type TabKey = TicketStatus | "ALL";

interface ListResponse {
  data?: { tickets: AdminTicket[]; counts: Record<TicketStatus, number> };
  error?: { code: string; message: string };
}

interface DetailResponse {
  data?: { ticket: AdminTicket };
  error?: { code: string; message: string };
}

function statusBadge(locale: Locale, status: TicketStatus): { label: string; tone: BadgeTone } {
  const s = pick(locale, TICKETS_STRINGS);
  const map: Record<TicketStatus, { label: string; tone: BadgeTone }> = {
    OPEN: { label: s.statusOpen, tone: "warning" },
    PENDING: { label: s.statusPending, tone: "success" },
    CLOSED: { label: s.statusClosed, tone: "danger" },
  };
  return map[status];
}

type LoadState = "loading" | "ready" | "error";

function fmtDateTime(locale: Locale, iso: string): string {
  return new Date(iso).toLocaleString(intlLocale(locale), {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-text-main outline-none focus:border-brand-500";

export function TicketsManager() {
  const { locale, t } = useLocale();
  const s = pick(locale, TICKETS_STRINGS);
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "OPEN", label: s.tabOpen },
    { key: "PENDING", label: s.tabPending },
    { key: "CLOSED", label: s.tabClosed },
    { key: "ALL", label: s.tabAll },
  ];
  const [tab, setTab] = useState<TabKey>("OPEN");
  const [slaOnly, setSlaOnly] = useState(false);
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [counts, setCounts] = useState<Record<TicketStatus, number>>({ OPEN: 0, PENDING: 0, CLOSED: 0 });
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<AdminTicket | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (forTab: TabKey, breachedOnly: boolean) => {
    setLoadState("loading");
    try {
      const search = new URLSearchParams();
      if (forTab !== "ALL") search.set("status", forTab);
      if (breachedOnly) search.set("sla", "breached");
      const qs = search.toString();
      const res = await fetch(`/api/v1/admin/tickets${qs ? `?${qs}` : ""}`);
      const json = (await res.json().catch(() => null)) as ListResponse | null;
      if (!res.ok || !json?.data) {
        setLoadState("error");
        setLoadError(json?.error?.message ?? s.loadFailed);
        return;
      }
      setTickets(json.data.tickets);
      setCounts(json.data.counts);
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setLoadError(s.networkError);
    }
  }, [s]);

  useEffect(() => {
    void load(tab, slaOnly);
  }, [load, tab, slaOnly]);

  const openTicket = useCallback(async (id: string) => {
    setDetailLoading(true);
    setActionError(null);
    setReplyBody("");
    try {
      const res = await fetch(`/api/v1/admin/tickets/${id}`);
      const json = (await res.json().catch(() => null)) as DetailResponse | null;
      if (!res.ok || !json?.data) {
        setActionError(json?.error?.message ?? s.openFailed);
        return;
      }
      setSelected(json.data.ticket);
    } catch {
      setActionError(s.networkError);
    } finally {
      setDetailLoading(false);
    }
  }, [s]);

  async function sendReply() {
    if (!selected || !replyBody.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/admin/tickets/${selected.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyBody.trim() }),
      });
      const json = (await res.json().catch(() => null)) as DetailResponse | null;
      if (!res.ok || !json?.data) {
        setActionError(json?.error?.message ?? s.replyFailed);
        return;
      }
      setSelected(json.data.ticket);
      setReplyBody("");
      void load(tab, slaOnly);
    } catch {
      setActionError(s.networkError);
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(status: TicketStatus) {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/admin/tickets/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = (await res.json().catch(() => null)) as DetailResponse | null;
      if (!res.ok || !json?.data) {
        setActionError(json?.error?.message ?? s.statusFailed);
        return;
      }
      setSelected(json.data.ticket);
      void load(tab, slaOnly);
    } catch {
      setActionError(s.networkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={s.tablistLabel}>
        {tabs.map((tb) => (
          <button
            key={tb.key}
            role="tab"
            aria-selected={tab === tb.key}
            onClick={() => setTab(tb.key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === tb.key
                ? "brand-gradient text-white shadow"
                : "border border-border bg-card text-text-muted hover:text-text-main"
            }`}
          >
            {tb.label}
            {tb.key !== "ALL" ? ` (${counts[tb.key]})` : ""}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={slaOnly}
          onClick={() => setSlaOnly((v) => !v)}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
            slaOnly
              ? "bg-rose-600 text-white shadow"
              : "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
          }`}
          title={s.slaOnlyTitle}
        >
          {s.slaOnlyFilter}
        </button>
      </div>

      {actionError ? (
        <p role="alert" className="text-sm font-medium text-rose-600">
          {actionError}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card className="p-0">
          {loadState === "loading" ? (
            <p className="p-5 text-sm text-text-muted">{t.loading}</p>
          ) : loadState === "error" ? (
            <p className="p-5 text-sm font-medium text-rose-600">{loadError}</p>
          ) : tickets.length === 0 ? (
            <p className="p-5 text-sm text-text-muted">{s.emptyList}</p>
          ) : (
            <ul className="divide-y divide-border">
              {tickets.map((tk) => (
                <li key={tk.id}>
                  <button
                    type="button"
                    onClick={() => void openTicket(tk.id)}
                    className={`block w-full px-5 py-4 text-left transition hover:bg-surface-2 ${
                      selected?.id === tk.id ? "bg-surface-2" : ""
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-text-main">{tk.subject}</span>
                      <Badge tone={statusBadge(locale, tk.status).tone}>{statusBadge(locale, tk.status).label}</Badge>
                      {tk.sla ? (
                        <Badge tone={slaBadge(locale, tk.sla.state).tone}>{slaBadge(locale, tk.sla.state).label}</Badge>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs text-text-muted">
                      {tk.customerName} · {tk.customerPhoneMasked}
                      {tk.orderNo ? ` · ${interpolate(s.orderInline, { no: tk.orderNo })}` : ""} ·{" "}
                      {interpolate(s.metaMessages, { count: tk.messageCount })} ·{" "}
                      {fmtDateTime(locale, tk.updatedAt)}
                    </span>
                    {tk.lastMessagePreview ? (
                      <span className="mt-1 line-clamp-1 block text-xs text-text-subtle">
                        {tk.lastMessagePreview}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          {detailLoading ? (
            <p className="text-sm text-text-muted">{s.threadLoading}</p>
          ) : !selected ? (
            <p className="text-sm leading-6 text-text-muted">
              {s.detailPlaceholder}
            </p>
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-text-main">{selected.subject}</h3>
                <Badge tone={statusBadge(locale, selected.status).tone}>
                  {statusBadge(locale, selected.status).label}
                </Badge>
                {selected.sla ? (
                  <Badge tone={slaBadge(locale, selected.sla.state).tone}>
                    {slaBadge(locale, selected.sla.state).label}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {s.customerLabel} {selected.customerName} · {selected.customerPhoneMasked}
                {selected.orderNo ? ` · ${interpolate(s.orderDetail, { no: selected.orderNo })}` : ""} · {s.openedLabel}{" "}
                {fmtDateTime(locale, selected.createdAt)}
              </p>
              {selected.sla ? (
                <div className="mt-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs leading-5 text-text-muted">
                  <span className="font-bold text-text-main">{s.slaHeading}</span> {s.slaIntro}{" "}
                  {interpolate(s.slaFirstDue, { date: fmtDateTime(locale, selected.sla.firstResponseDueAt) })}
                  {selected.sla.firstResponseAt
                    ? ` — ${interpolate(s.slaResponded, { date: fmtDateTime(locale, selected.sla.firstResponseAt) })}`
                    : ` — ${s.slaNotResponded}`}
                  {selected.sla.firstResponseBreached ? ` ${s.slaBreachedPast}` : ""} ·{" "}
                  {interpolate(s.slaResolutionDue, { date: fmtDateTime(locale, selected.sla.resolutionDueAt) })}
                  {selected.sla.resolutionBreached ? ` ${s.slaBreachedNow}` : ""}
                </div>
              ) : null}

              <ul className="mt-4 space-y-3">
                {(selected.messages ?? []).map((m) => (
                  <li
                    key={m.id}
                    className={`rounded-xl px-3.5 py-2.5 ${
                      m.authorType === "STAFF" ? "bg-brand-50" : "bg-surface-2"
                    }`}
                  >
                    <p className="text-xs font-bold text-text-main">
                      {m.authorType === "STAFF" ? s.supportTeam : selected.customerName}
                      <span className="ml-2 font-medium text-text-subtle">{fmtDateTime(locale, m.createdAt)}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-text-main [overflow-wrap:anywhere]">
                      {m.body}
                    </p>
                  </li>
                ))}
              </ul>

              <div className="mt-5 border-t border-border pt-4">
                <label className="mb-1.5 block text-sm font-medium text-text-main" htmlFor="admin-ticket-reply">
                  {s.replyLabel}
                </label>
                <CannedReplyPicker
                  onInsert={(body) =>
                    setReplyBody((prev) => {
                      const joined = prev.trim() ? `${prev.replace(/\s+$/, "")}\n${body}` : body;
                      return joined.slice(0, 5000);
                    })
                  }
                />
                <textarea
                  id="admin-ticket-reply"
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  rows={3}
                  maxLength={5000}
                  placeholder={s.replyPlaceholder}
                  className={inputClass}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void sendReply()}
                    disabled={busy || !replyBody.trim()}
                    className="brand-gradient h-10 rounded-xl px-4 text-sm font-bold text-white shadow transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                  >
                    {busy ? s.sending : s.sendReply}
                  </button>
                  {selected.status !== "CLOSED" ? (
                    <button
                      type="button"
                      onClick={() => void changeStatus("CLOSED")}
                      disabled={busy}
                      className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-60"
                    >
                      {s.closeTicket}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void changeStatus("OPEN")}
                      disabled={busy}
                      className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-60"
                    >
                      {s.reopenTicket}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

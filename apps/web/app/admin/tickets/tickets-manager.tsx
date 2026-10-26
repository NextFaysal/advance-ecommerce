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
import { CannedReplyPicker } from "./support-tools";

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

const SLA_BADGE: Record<TicketSlaState, { label: string; tone: "success" | "warning" | "danger" }> = {
  OK: { label: "SLA ঠিক আছে", tone: "success" },
  AT_RISK: { label: "SLA ঝুঁকিতে", tone: "warning" },
  BREACHED: { label: "SLA ভেঙেছে", tone: "danger" },
};

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

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "OPEN", label: "খোলা" },
  { key: "PENDING", label: "স্টাফ উত্তর দিয়েছেন" },
  { key: "CLOSED", label: "বন্ধ" },
  { key: "ALL", label: "সব" },
];

const STATUS_BADGE: Record<TicketStatus, { label: string; tone: "success" | "warning" | "danger" }> = {
  OPEN: { label: "খোলা (OPEN)", tone: "warning" },
  PENDING: { label: "উত্তর দেওয়া (PENDING)", tone: "success" },
  CLOSED: { label: "বন্ধ (CLOSED)", tone: "danger" },
};

type LoadState = "loading" | "ready" | "error";

function bnDateTime(iso: string): string {
  return new Date(iso).toLocaleString("bn-BD", {
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
        setLoadError(json?.error?.message ?? "টিকিট লোড করা যায়নি।");
        return;
      }
      setTickets(json.data.tickets);
      setCounts(json.data.counts);
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setLoadError("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।");
    }
  }, []);

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
        setActionError(json?.error?.message ?? "টিকিট খোলা যায়নি।");
        return;
      }
      setSelected(json.data.ticket);
    } catch {
      setActionError("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।");
    } finally {
      setDetailLoading(false);
    }
  }, []);

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
        setActionError(json?.error?.message ?? "উত্তর পাঠানো যায়নি।");
        return;
      }
      setSelected(json.data.ticket);
      setReplyBody("");
      void load(tab, slaOnly);
    } catch {
      setActionError("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।");
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
        setActionError(json?.error?.message ?? "স্ট্যাটাস বদলানো যায়নি।");
        return;
      }
      setSelected(json.data.ticket);
      void load(tab, slaOnly);
    } catch {
      setActionError("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="টিকিটের স্ট্যাটাস">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === t.key
                ? "brand-gradient text-white shadow"
                : "border border-border bg-card text-text-muted hover:text-text-main"
            }`}
          >
            {t.label}
            {t.key !== "ALL" ? ` (${counts[t.key]})` : ""}
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
          title="শুধু যেসব টিকিটের SLA সময়সীমা পেরিয়ে গেছে"
        >
          শুধু SLA-ভাঙা টিকিট
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
            <p className="p-5 text-sm text-text-muted">লোড হচ্ছে…</p>
          ) : loadState === "error" ? (
            <p className="p-5 text-sm font-medium text-rose-600">{loadError}</p>
          ) : tickets.length === 0 ? (
            <p className="p-5 text-sm text-text-muted">এই তালিকায় কোনো টিকিট নেই।</p>
          ) : (
            <ul className="divide-y divide-border">
              {tickets.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => void openTicket(t.id)}
                    className={`block w-full px-5 py-4 text-left transition hover:bg-surface-2 ${
                      selected?.id === t.id ? "bg-surface-2" : ""
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-text-main">{t.subject}</span>
                      <Badge tone={STATUS_BADGE[t.status].tone}>{STATUS_BADGE[t.status].label}</Badge>
                      {t.sla ? (
                        <Badge tone={SLA_BADGE[t.sla.state].tone}>{SLA_BADGE[t.sla.state].label}</Badge>
                      ) : null}
                    </span>
                    <span className="mt-1 block text-xs text-text-muted">
                      {t.customerName} · {t.customerPhoneMasked}
                      {t.orderNo ? ` · অর্ডার ${t.orderNo}` : ""} · {t.messageCount}টি বার্তা ·{" "}
                      {bnDateTime(t.updatedAt)}
                    </span>
                    {t.lastMessagePreview ? (
                      <span className="mt-1 line-clamp-1 block text-xs text-text-subtle">
                        {t.lastMessagePreview}
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
            <p className="text-sm text-text-muted">থ্রেড লোড হচ্ছে…</p>
          ) : !selected ? (
            <p className="text-sm leading-6 text-text-muted">
              বাম থেকে একটি টিকিট বেছে নিন — পুরো কথোপকথন, উত্তর দেওয়ার ঘর ও স্ট্যাটাস বদলের
              বোতাম এখানে আসবে।
            </p>
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-text-main">{selected.subject}</h3>
                <Badge tone={STATUS_BADGE[selected.status].tone}>
                  {STATUS_BADGE[selected.status].label}
                </Badge>
                {selected.sla ? (
                  <Badge tone={SLA_BADGE[selected.sla.state].tone}>
                    {SLA_BADGE[selected.sla.state].label}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-text-muted">
                গ্রাহক: {selected.customerName} · {selected.customerPhoneMasked}
                {selected.orderNo ? ` · অর্ডার: ${selected.orderNo}` : ""} · খোলা{" "}
                {bnDateTime(selected.createdAt)}
              </p>
              {selected.sla ? (
                <div className="mt-3 rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs leading-5 text-text-muted">
                  <span className="font-bold text-text-main">SLA সময়সীমা</span> (খোলার সময় থেকে
                  হিসাব করা): প্রথম উত্তরের শেষ সময় {bnDateTime(selected.sla.firstResponseDueAt)}
                  {selected.sla.firstResponseAt
                    ? ` — উত্তর দেওয়া হয়েছে ${bnDateTime(selected.sla.firstResponseAt)}`
                    : " — এখনো স্টাফের উত্তর হয়নি"}
                  {selected.sla.firstResponseBreached ? " (সময়সীমা পেরিয়েছিল)" : ""} · সমাধানের শেষ
                  সময় {bnDateTime(selected.sla.resolutionDueAt)}
                  {selected.sla.resolutionBreached ? " (সময়সীমা পেরিয়েছে)" : ""}
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
                      {m.authorType === "STAFF" ? "সাপোর্ট টিম" : selected.customerName}
                      <span className="ml-2 font-medium text-text-subtle">{bnDateTime(m.createdAt)}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-text-main [overflow-wrap:anywhere]">
                      {m.body}
                    </p>
                  </li>
                ))}
              </ul>

              <div className="mt-5 border-t border-border pt-4">
                <label className="mb-1.5 block text-sm font-medium text-text-main" htmlFor="admin-ticket-reply">
                  উত্তর লিখুন (পাঠালে স্ট্যাটাস PENDING হবে)
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
                  placeholder="গ্রাহকের উদ্দেশে উত্তর লিখুন…"
                  className={inputClass}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void sendReply()}
                    disabled={busy || !replyBody.trim()}
                    className="brand-gradient h-10 rounded-xl px-4 text-sm font-bold text-white shadow transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                  >
                    {busy ? "পাঠানো হচ্ছে…" : "উত্তর পাঠান"}
                  </button>
                  {selected.status !== "CLOSED" ? (
                    <button
                      type="button"
                      onClick={() => void changeStatus("CLOSED")}
                      disabled={busy}
                      className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-60"
                    >
                      টিকিট বন্ধ করুন
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void changeStatus("OPEN")}
                      disabled={busy}
                      className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-60"
                    >
                      আবার খুলুন
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

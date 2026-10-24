"use client";

/**
 * F-commerce unified inbox UI — Agent 40, on Agent 14's src/inbox contracts.
 *
 * All conversation data comes from the src/inbox TEMPORARY DEMO store via
 * the server page (same shapes as GET /api/v1/admin/inbox). This component
 * holds page state only:
 * - The reply composer is a DEMO composer. Sending is disabled in effect:
 *   "কিউতে রাখুন" records the reply text as an intent in page state and
 *   labels it পাঠানো হয়নি — NO channel API (Messenger / WhatsApp /
 *   Instagram) is connected and nothing ever leaves this page.
 * - The conversion panel POSTs to /api/v1/admin/inbox/draft, which runs
 *   buildOrderDraft() SERVER-SIDE and resolves the customer's phone there
 *   (D1 fix — this component never receives or holds a full phone number;
 *   the page passes ConversationView[] + pre-masked detected phones only).
 *   A draft is NOT an order — it is shown here so staff can confirm it in
 *   the manual-order form.
 * - Phone numbers are masked in every list/panel view (maskPhone, the
 *   same helper src/inbox/service uses for ConversationView).
 */
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { maskPhone } from "@/checkout/validation";
import type { DraftResult, OrderDraft } from "@/inbox/conversion";
import type {
  ConversationStatus,
  ConversationView,
  InboxChannel,
  InboxMessage,
} from "@/inbox/types";

type ChannelFilter = "ALL" | InboxChannel;

interface QueuedReply {
  text: string;
  queuedAt: string;
}

const CHANNEL_LABEL: Record<InboxChannel, string> = {
  MESSENGER: "Messenger",
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
};

const CHANNEL_TONE: Record<InboxChannel, "info" | "success" | "brand"> = {
  MESSENGER: "info",
  WHATSAPP: "success",
  INSTAGRAM: "brand",
};

const STATUS_LABEL: Record<ConversationStatus, string> = {
  OPEN: "খোলা",
  PENDING: "অপেক্ষমাণ",
  RESOLVED: "সমাধান হয়েছে",
};

const FILTERS: { id: ChannelFilter; label: string }[] = [
  { id: "ALL", label: "সব" },
  { id: "MESSENGER", label: "Messenger" },
  { id: "WHATSAPP", label: "WhatsApp" },
  { id: "INSTAGRAM", label: "Instagram" },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("bn-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function messagePreview(m: InboxMessage | undefined): string {
  if (!m) return "—";
  if (m.text) return m.text;
  switch (m.kind) {
    case "PRODUCT_CARD":
      return "🛍️ পণ্যের কার্ড";
    case "IMAGE":
      return "🖼️ ছবি";
    case "ORDER_CARD":
      return "🧾 অর্ডারের কার্ড";
    default:
      return "সিস্টেম বার্তা";
  }
}

function MessageBody({ message }: { message: InboxMessage }) {
  switch (message.kind) {
    case "PRODUCT_CARD":
      return (
        <div>
          <p>
            🛍️ পণ্যের কার্ড{" "}
            {message.refId ? <span className="font-mono text-xs">({message.refId})</span> : null}
          </p>
          {message.text ? <p className="mt-1">{message.text}</p> : null}
        </div>
      );
    case "IMAGE":
      return (
        <div>
          <p>🖼️ ছবি</p>
          {message.text ? <p className="mt-1">{message.text}</p> : null}
        </div>
      );
    case "ORDER_CARD":
      return (
        <div>
          <p>
            🧾 অর্ডারের কার্ড{" "}
            {message.refId ? <span className="font-mono text-xs">({message.refId})</span> : null}
          </p>
          {message.text ? <p className="mt-1">{message.text}</p> : null}
        </div>
      );
    case "SYSTEM":
      return <p className="italic">{message.text ?? "সিস্টেম বার্তা"}</p>;
    default:
      return <p>{message.text ?? ""}</p>;
  }
}

export default function InboxClient({
  conversations,
  threads,
  detectedPhoneMasked,
}: {
  /** Masked views only — full customer phones never reach the browser. */
  conversations: ConversationView[];
  threads: Record<string, InboxMessage[]>;
  /** Phone detected in chat, already masked server-side (null = none). */
  detectedPhoneMasked: Record<string, string | null>;
}) {
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(conversations[0]?.id ?? null);
  const [replyText, setReplyText] = useState("");
  const [queuedReplies, setQueuedReplies] = useState<Record<string, QueuedReply[]>>({});
  const [draftName, setDraftName] = useState("");
  const [draftAddressText, setDraftAddressText] = useState("");
  const [draftQty, setDraftQty] = useState(1);
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null);
  const [draftSubmitting, setDraftSubmitting] = useState(false);

  const views = conversations;
  const filteredViews = useMemo(
    () => views.filter((v) => channelFilter === "ALL" || v.channel === channelFilter),
    [views, channelFilter],
  );
  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const selectedView = selected;
  const selectedMessages = selected ? (threads[selected.id] ?? []) : [];
  const selectedQueued = selected ? (queuedReplies[selected.id] ?? []) : [];
  const totalUnread = views.reduce((sum, v) => sum + v.unreadCount, 0);

  // Reset the composer + draft form whenever the open conversation changes:
  // name pre-fills from the platform display name, address text from the
  // last inbound text message (the message a staffer would copy by hand).
  useEffect(() => {
    if (!selected) return;
    setReplyText("");
    setDraftResult(null);
    setDraftName(selected.customerDisplayName);
    const inboundTexts = (threads[selected.id] ?? []).filter(
      (m) => m.direction === "INBOUND" && m.kind === "TEXT" && m.text,
    );
    setDraftAddressText(inboundTexts[inboundTexts.length - 1]?.text ?? "");
    setDraftQty(1);
  }, [selected, threads]);

  const queueReply = () => {
    if (!selected || replyText.trim().length === 0) return;
    const entry: QueuedReply = { text: replyText.trim(), queuedAt: new Date().toISOString() };
    setQueuedReplies((prev) => ({
      ...prev,
      [selected.id]: [...(prev[selected.id] ?? []), entry],
    }));
    setReplyText("");
  };

  // The draft is built by the server draft route: it resolves the phone
  // from the conversation / chat server-side (this client has no full
  // number to send) and runs the same buildOrderDraft() logic there.
  const buildDraft = async () => {
    if (!selected || draftSubmitting) return;
    if (!selected.productRefId) {
      setDraftResult({
        ok: false,
        errors: [
          "এই কথোপকথনে কোনো পণ্য যুক্ত নেই (product card থেকে শুরু হয়নি) — অর্ডার ড্রাফটের জন্য অন্তত একটি পণ্য দরকার।",
        ],
      });
      return;
    }
    const conversationId = selected.id;
    setDraftSubmitting(true);
    try {
      const res = await fetch("/api/v1/admin/inbox/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          customerName: draftName,
          addressText: draftAddressText,
          items: [{ variantId: selected.productRefId, quantity: draftQty }],
        }),
      });
      const payload: unknown = await res.json().catch(() => null);
      const body = payload as {
        data?: { draft: OrderDraft };
        error?: { message?: string; details?: unknown };
      } | null;
      if (res.ok && body?.data?.draft) {
        setDraftResult({ ok: true, draft: body.data.draft });
      } else {
        const details = body?.error?.details;
        const errors =
          Array.isArray(details) && details.every((d) => typeof d === "string")
            ? details
            : [body?.error?.message ?? "ড্রাফট তৈরি করা যায়নি — আবার চেষ্টা করুন।"];
        setDraftResult({ ok: false, errors });
      }
    } catch {
      setDraftResult({
        ok: false,
        errors: ["সার্ভারে পৌঁছানো যায়নি — সংযোগ যাচাই করে আবার চেষ্টা করুন।"],
      });
    } finally {
      setDraftSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-amber-300 bg-amber-50 text-sm text-amber-900">
        ⚠️ TEMPORARY DEMO — কোনো চ্যানেল API সংযুক্ত নেই। উত্তর <strong>পাঠানো যায় না</strong>:
        কম্পোজার শুধু এই পেজের state-এ “কিউ করা” অভিপ্রায় রাখে। ড্রাফট কোনো অর্ডার নয় এবং
        কোথাও জমা হয় না — নিশ্চিত করতে ম্যানুয়াল অর্ডার ফর্ম ব্যবহার করুন।
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="মোট কথোপকথন (ডেমো)" value={String(views.length)} delta="ইন-মেমরি" icon="💬" />
        <StatCard label="অপঠিত বার্তা" value={String(totalUnread)} delta="ডেমো" icon="🔔" />
        <StatCard label="চ্যানেল" value="3" delta="Messenger · WhatsApp · Instagram" icon="🔌" />
        <StatCard label="চ্যানেল সংযোগ" value="নেই" delta="টাইপ-অনলি ডেমো" icon="🔒" />
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="চ্যানেল ফিল্টার">
        {FILTERS.map((f) => {
          const count =
            f.id === "ALL" ? views.length : views.filter((v) => v.channel === f.id).length;
          const active = channelFilter === f.id;
          return (
            <Button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={active}
              variant={active ? "primary" : "outline"}
              size="sm"
              onClick={() => setChannelFilter(f.id)}
            >
              {f.label} ({count})
            </Button>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card className="h-fit">
          <h2 className="mb-3 font-semibold">কথোপকথন</h2>
          {filteredViews.length === 0 ? (
            <EmptyState
              title="কোনো কথোপকথন নেই"
              description="এই চ্যানেলে ডেমো কথোপকথন নেই। আসল সংযোগ এলে webhook থেকে থ্রেড এখানে আসবে।"
            />
          ) : (
            <ul className="divide-y divide-border">
              {filteredViews.map((v) => {
                const msgs = threads[v.id] ?? [];
                const last = msgs[msgs.length - 1];
                const isActive = v.id === selectedId;
                return (
                  <li key={v.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(v.id)}
                      aria-current={isActive}
                      className={`w-full px-2 py-3 text-left ${isActive ? "bg-brand-50" : "hover:bg-surface-2"}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">{v.customerDisplayName}</span>
                        {v.unreadCount > 0 ? (
                          <Badge tone="danger">{v.unreadCount} অপঠিত</Badge>
                        ) : null}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                        <Badge tone={CHANNEL_TONE[v.channel]}>{CHANNEL_LABEL[v.channel]}</Badge>
                        <span>{STATUS_LABEL[v.status]}</span>
                        <span>{formatTime(v.lastMessageAt)}</span>
                      </span>
                      <span className="mt-1 block truncate text-sm text-text-muted">
                        {messagePreview(last)}
                      </span>
                      <span className="mt-1 block text-xs text-text-muted">
                        ফোন: {v.phoneMasked ?? "এখনো পাওয়া যায়নি"} · দায়িত্বে:{" "}
                        {v.assignedAgentId ?? "কেউ নির্ধারিত নয়"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          {selected && selectedView ? (
            <>
              <Card>
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{selected.customerDisplayName}</h2>
                  <Badge tone={CHANNEL_TONE[selected.channel]}>
                    {CHANNEL_LABEL[selected.channel]}
                  </Badge>
                  <Badge tone="neutral">{STATUS_LABEL[selected.status]}</Badge>
                  <span className="text-xs text-text-muted">
                    ফোন: {selectedView.phoneMasked ?? "এখনো পাওয়া যায়নি"} · দায়িত্বে:{" "}
                    {selected.assignedAgentId ?? "কেউ নির্ধারিত নয়"}
                  </span>
                </div>

                <div className="space-y-3">
                  {selectedMessages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                          m.direction === "OUTBOUND"
                            ? "bg-brand-600 text-white"
                            : "bg-surface-2 text-text-main"
                        }`}
                      >
                        <MessageBody message={m} />
                        <p
                          className={`mt-1 text-right text-[11px] ${
                            m.direction === "OUTBOUND" ? "text-white/70" : "text-text-muted"
                          }`}
                        >
                          {formatTime(m.sentAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                  {selectedQueued.map((q, i) => (
                    <div key={`queued-${i}`} className="flex justify-end">
                      <div className="max-w-[80%] rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <p>{q.text}</p>
                        <p className="mt-1 text-right text-[11px]">
                          <Badge tone="warning">কিউ করা — পাঠানো হয়নি</Badge>{" "}
                          {formatTime(q.queuedAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                  {selectedMessages.length === 0 && selectedQueued.length === 0 ? (
                    <p className="text-sm text-text-muted">এই কথোপকথনে এখনো কোনো বার্তা নেই।</p>
                  ) : null}
                </div>

                <div className="mt-5 border-t border-border pt-4">
                  <label htmlFor="inbox-reply" className="mb-1 block text-xs font-medium text-text-muted">
                    উত্তর লিখুন (ডেমো কম্পোজার)
                  </label>
                  <textarea
                    id="inbox-reply"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    rows={3}
                    placeholder="উত্তর লিখুন…"
                    className="w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500"
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <Button type="button" onClick={queueReply} disabled={replyText.trim().length === 0}>
                      কিউতে রাখুন (ডেমো)
                    </Button>
                    <p className="text-xs text-text-muted">
                      আসল পাঠানো বন্ধ আছে — কোনো চ্যানেল API সংযুক্ত নেই। কিউ করা উত্তর শুধু এই
                      পেজের state-এ থাকে, গ্রাহকের কাছে যায় না।
                    </p>
                  </div>
                </div>
              </Card>

              <Card>
                <h2 className="mb-1 font-semibold">অর্ডার ড্রাফটে রূপান্তর</h2>
                <p className="mb-4 text-sm text-text-muted">
                  কথোপকথন থেকে নাম ও ঠিকানা পাঠালে সার্ভারে <code>buildOrderDraft()</code> দিয়ে
                  ড্রাফট তৈরি হয় — ফোন চ্যাটের বার্তা থেকে সার্ভারেই শনাক্ত করা হয় (এখানে শুধু
                  মাস্ক করা দেখানো হচ্ছে, সম্পূর্ণ নম্বর ব্রাউজারে আসে না)।
                  ড্রাফটটি <strong>অর্ডার নয়</strong> এবং জমা হয় না।
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="গ্রাহকের নাম"
                    name="draft-name"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                  />
                  <Input
                    label="পরিমাণ"
                    name="draft-qty"
                    type="number"
                    min={1}
                    value={draftQty}
                    onChange={(e) => setDraftQty(Math.max(1, Number(e.target.value) || 1))}
                    helper={
                      selected.productRefId
                        ? `পণ্য (variant): ${selected.productRefId}`
                        : "এই কথোপকথনে কোনো পণ্য যুক্ত নেই"
                    }
                  />
                </div>
                <div className="mt-3">
                  <label htmlFor="draft-address" className="mb-1 block text-xs font-medium text-text-muted">
                    ঠিকানার লেখা (চ্যাট থেকে)
                  </label>
                  <textarea
                    id="draft-address"
                    value={draftAddressText}
                    onChange={(e) => setDraftAddressText(e.target.value)}
                    rows={3}
                    className="w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500"
                  />
                </div>
                <p className="mt-2 text-xs text-text-muted">
                  শনাক্ত করা ফোন:{" "}
                  <span className="font-mono tabular-nums">
                    {detectedPhoneMasked[selected.id] ??
                      selectedView.phoneMasked ??
                      "পাওয়া যায়নি — ড্রাফট তৈরি হবে না"}
                  </span>
                </p>
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="gradient"
                    onClick={buildDraft}
                    disabled={draftSubmitting}
                  >
                    {draftSubmitting ? "ড্রাফট তৈরি হচ্ছে…" : "ড্রাফট তৈরি করুন"}
                  </Button>
                </div>

                {draftResult ? (
                  draftResult.ok ? (
                    <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                      <p className="font-semibold">
                        ✅ ড্রাফট তৈরি হয়েছে — এটি অর্ডার নয়, কোথাও জমা হয়নি।
                      </p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        <li>নাম: {draftResult.draft.customerName}</li>
                        <li>
                          ফোন:{" "}
                          <span className="font-mono tabular-nums">
                            {maskPhone(draftResult.draft.phone)}
                          </span>{" "}
                          (সম্পূর্ণ নম্বর শুধু ম্যানুয়াল অর্ডার ফর্মে যাবে)
                        </li>
                        <li>
                          ঠিকানা: {draftResult.draft.address.addressLine},{" "}
                          {draftResult.draft.address.upazila}, {draftResult.draft.address.district},{" "}
                          {draftResult.draft.address.division}
                          {draftResult.draft.address.union
                            ? `, ${draftResult.draft.address.union}`
                            : ""}
                        </li>
                        <li>
                          আইটেম:{" "}
                          {draftResult.draft.items
                            .map((i) => `${i.variantId} × ${i.quantity}`)
                            .join(", ")}
                        </li>
                        <li>
                          ঠিকানা পার্সারের আত্মবিশ্বাস:{" "}
                          {Math.round(draftResult.draft.addressConfidence * 100)}%
                        </li>
                      </ul>
                      {draftResult.draft.needsStaffConfirmation ? (
                        <p className="mt-2">
                          <Badge tone="warning">
                            ⚠ স্টাফ নিশ্চিতকরণ দরকার — পার্স করা ঠিকানা অর্ডারের আগে যাচাই করুন
                          </Badge>
                        </p>
                      ) : null}
                      <p className="mt-3">
                        <a
                          href="/admin/orders"
                          className="inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"
                        >
                          ম্যানুয়াল অর্ডার তৈরি করুন →
                        </a>{" "}
                        <span className="text-xs">
                          (ড্রাফটের তথ্য ফর্মে বসিয়ে নিশ্চিত করুন — ড্রাফট নিজে থেকে অর্ডার হয় না)
                        </span>
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                      <p className="font-semibold">⚠ ড্রাফট তৈরি হয়নি:</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {draftResult.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )
                ) : null}
              </Card>
            </>
          ) : (
            <EmptyState
              title="কোনো কথোপকথন বাছাই হয়নি"
              description="বাম পাশের তালিকা থেকে একটি কথোপকথন বাছাই করুন।"
            />
          )}
        </div>
      </div>
    </div>
  );
}

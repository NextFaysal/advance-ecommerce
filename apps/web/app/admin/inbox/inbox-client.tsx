"use client";

/**
 * F-commerce unified inbox UI — Agent 40, on Agent 14's src/inbox contracts.
 *
 * All conversation data comes from the src/inbox TEMPORARY DEMO store via
 * the server page (same shapes as GET /api/v1/admin/inbox). This component
 * holds page state only:
 * - The reply composer is REAL on configured channels (ADV-6 part 2):
 *   the server page passes a boolean `channelLive` map (Meta Settings
 *   presence only — tokens never reach the browser). On a LIVE channel
 *   "পাঠান" POSTs to /api/v1/admin/inbox/conversations/[id]/reply,
 *   which sends through the Meta API; success appends the persisted
 *   OUTBOUND message the route returns, and a provider failure shows
 *   the provider's error with the draft kept — never a fake "sent".
 *   On an UNCONFIGURED channel the composer keeps the original demo
 *   behaviour exactly: "কিউতে রাখুন (ডেমো)" records the reply as an
 *   intent in page state, labelled পাঠানো হয়নি, and nothing is sent.
 *   (If the config changed after page load, the route can still answer
 *   status "queued" on a live-looking channel — handled the same way.)
 * - The conversion panel POSTs to /api/v1/admin/inbox/draft, which runs
 *   buildOrderDraft() SERVER-SIDE and resolves the customer's phone there
 *   (D1 fix — this component never receives or holds a full phone number;
 *   the page passes ConversationView[] + pre-masked detected phones only).
 *   A draft is NOT an order — it is shown here so staff can confirm it in
 *   the manual-order form.
 * - Phone numbers are masked in every list/panel view (maskPhone, the
 *   same helper src/inbox/service uses for ConversationView).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/ui/stat-card";
import { maskPhone } from "@/checkout/validation";
import { formatBdt } from "@/checkout/pricing";
import type { DraftResult, OrderDraft } from "@/inbox/conversion";
import BotDraftPanel from "./bot-draft-panel";
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
  channelLive,
}: {
  /** Masked views only — full customer phones never reach the browser. */
  conversations: ConversationView[];
  threads: Record<string, InboxMessage[]>;
  /** Phone detected in chat, already masked server-side (null = none). */
  detectedPhoneMasked: Record<string, string | null>;
  /** Per-channel Meta configuration presence (booleans only, computed
   *  server-side from encrypted Settings — no token material). Live
   *  channel -> the composer really sends; otherwise demo queueing. */
  channelLive: Record<InboxChannel, boolean>;
}) {
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(conversations[0]?.id ?? null);
  const [replyText, setReplyText] = useState("");
  const [queuedReplies, setQueuedReplies] = useState<Record<string, QueuedReply[]>>({});
  /* ---- ADV-6 part 2: real-send state. Sent messages returned by the
   * reply route (persisted OUTBOUND rows with platform ids) are kept
   * per conversation and appended to the server-prop thread for
   * display; a reload shows the same rows from the DB. sendPhase is
   * per open conversation and resets when the selection changes. */
  const [sentMessages, setSentMessages] = useState<Record<string, InboxMessage[]>>({});
  const [sendPhase, setSendPhase] = useState<
    { kind: "idle" } | { kind: "sending" } | { kind: "failed"; message: string }
  >({ kind: "idle" });
  const [draftName, setDraftName] = useState("");
  const [draftAddressText, setDraftAddressText] = useState("");
  const [draftQty, setDraftQty] = useState(1);
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null);
  const [draftSubmitting, setDraftSubmitting] = useState(false);
  /* ---- O4 (wave 22): convert-to-order panel state. Delimited block —
   * the panel below POSTs to /admin/inbox/conversations/[id]/
   * convert-to-order, which creates a REAL order server-side through
   * the shared manual-create service. This client never holds or
   * sends a full phone number; the server resolves it from the
   * conversation (D1 privacy rule above still holds). */
  const [convItems, setConvItems] = useState<
    { variantId: string; quantity: number; priceTaka: string }[]
  >([{ variantId: "", quantity: 1, priceTaka: "" }]);
  const [convDivision, setConvDivision] = useState("");
  const [convDistrict, setConvDistrict] = useState("");
  const [convUpazila, setConvUpazila] = useState("");
  const [convAddressLine, setConvAddressLine] = useState("");
  const [convPayment, setConvPayment] = useState<"cod" | "bkash" | "nagad">("cod");
  const [convShipping, setConvShipping] = useState<"inside_dhaka" | "outside_dhaka" | "pickup">(
    "inside_dhaka",
  );
  const [convSubmitting, setConvSubmitting] = useState(false);
  const [convResult, setConvResult] = useState<
    | { ok: true; orderId: string; orderNo: string; totalPoisha: number | null }
    | { ok: false; message: string }
    | null
  >(null);

  /* ---- W0-E (doc 21 G3-10): read markers. Conversations arrive as
   * server props; when staff opens one, the mark-read route stamps
   * lastReadAt server-side and returns the conversation re-read
   * through the same read model the page used — that returned view
   * replaces the prop in `readViews`, so the badge clears with the
   * SERVER's number (a reload recomputes the same value from the
   * persisted marker — the two always agree). On any failure nothing
   * is overridden: the badge keeps the last server-reported count. */
  const [readViews, setReadViews] = useState<Record<string, ConversationView>>({});
  const views = useMemo(
    () => conversations.map((c) => readViews[c.id] ?? c),
    [conversations, readViews],
  );
  const filteredViews = useMemo(
    () => views.filter((v) => channelFilter === "ALL" || v.channel === channelFilter),
    [views, channelFilter],
  );
  const selected = conversations.find((c) => c.id === selectedId) ?? null;
  const selectedView = selected;
  const selectedMessages = selected
    ? [...(threads[selected.id] ?? []), ...(sentMessages[selected.id] ?? [])]
    : [];
  const selectedLive = selected ? channelLive[selected.channel] : false;
  const anyChannelLive = channelLive.MESSENGER || channelLive.WHATSAPP || channelLive.INSTAGRAM;
  const selectedQueued = selected ? (queuedReplies[selected.id] ?? []) : [];
  const totalUnread = views.reduce((sum, v) => sum + v.unreadCount, 0);

  // Reset the composer + draft form whenever the open conversation changes:
  // name pre-fills from the platform display name, address text from the
  // last inbound text message (the message a staffer would copy by hand).
  useEffect(() => {
    if (!selected) return;
    setReplyText("");
    setSendPhase({ kind: "idle" });
    setDraftResult(null);
    setDraftName(selected.customerDisplayName);
    const inboundTexts = (threads[selected.id] ?? []).filter(
      (m) => m.direction === "INBOUND" && m.kind === "TEXT" && m.text,
    );
    setDraftAddressText(inboundTexts[inboundTexts.length - 1]?.text ?? "");
    setDraftQty(1);
    // O4: reset the convert-to-order panel for the newly opened
    // conversation; the first item row pre-fills from the product the
    // conversation started from, when it has one.
    setConvItems([{ variantId: selected.productRefId ?? "", quantity: 1, priceTaka: "" }]);
    setConvDivision("");
    setConvDistrict("");
    setConvUpazila("");
    setConvAddressLine("");
    setConvPayment("cod");
    setConvShipping("inside_dhaka");
    setConvResult(null);
  }, [selected, threads]);

  // W0-E: opening a conversation marks it read server-side (the
  // initially displayed conversation counts as opened). One in-flight
  // call per conversation; the effect re-runs when the returned view
  // lands in readViews and stops because unreadCount is then 0.
  const markReadInFlight = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedId) return;
    const view = views.find((v) => v.id === selectedId);
    if (!view || view.unreadCount === 0) return;
    if (markReadInFlight.current.has(selectedId)) return;
    markReadInFlight.current.add(selectedId);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/admin/inbox/conversations/${selectedId}/mark-read`, {
          method: "POST",
        });
        const payload: unknown = await res.json().catch(() => null);
        const updated = (
          payload as { data?: { conversation?: ConversationView } } | null
        )?.data?.conversation;
        if (!cancelled && res.ok && updated) {
          setReadViews((prev) => ({ ...prev, [updated.id]: updated }));
        }
      } catch {
        // Best-effort by design: a failed mark-read leaves the badge
        // at the last server-reported count — never a fake zero.
      } finally {
        markReadInFlight.current.delete(selectedId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, views]);

  const queueReply = () => {
    if (!selected || replyText.trim().length === 0) return;
    const entry: QueuedReply = { text: replyText.trim(), queuedAt: new Date().toISOString() };
    setQueuedReplies((prev) => ({
      ...prev,
      [selected.id]: [...(prev[selected.id] ?? []), entry],
    }));
    setReplyText("");
  };

  // ADV-6 part 2: REAL send on a live channel. The route decides from
  // live Settings: "sent" returns the persisted OUTBOUND message (it
  // is appended to the thread and the composer clears); "queued"
  // means the channel turned out not to be configured after all —
  // fall back to the exact demo intent rendering; any error keeps the
  // draft text and shows the provider's own message (no fake sent).
  const sendReply = async () => {
    if (!selected || sendPhase.kind === "sending" || replyText.trim().length === 0) return;
    const conversationId = selected.id;
    const text = replyText.trim();
    setSendPhase({ kind: "sending" });
    try {
      const res = await fetch(`/api/v1/admin/inbox/conversations/${conversationId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const payload: unknown = await res.json().catch(() => null);
      const body = payload as {
        data?: { status?: string; message?: InboxMessage };
        error?: { message?: string };
      } | null;
      if (res.ok && body?.data?.status === "sent" && body.data.message) {
        const message = body.data.message;
        setSentMessages((prev) => ({
          ...prev,
          [conversationId]: [...(prev[conversationId] ?? []), message],
        }));
        setReplyText("");
        setSendPhase({ kind: "idle" });
      } else if (res.ok && body?.data?.status === "queued") {
        const entry: QueuedReply = { text, queuedAt: new Date().toISOString() };
        setQueuedReplies((prev) => ({
          ...prev,
          [conversationId]: [...(prev[conversationId] ?? []), entry],
        }));
        setReplyText("");
        setSendPhase({ kind: "idle" });
      } else {
        setSendPhase({
          kind: "failed",
          message: body?.error?.message ?? "পাঠানো যায়নি — আবার চেষ্টা করুন।",
        });
      }
    } catch {
      setSendPhase({
        kind: "failed",
        message: "সার্ভারে পৌঁছানো যায়নি — সংযোগ যাচাই করে আবার চেষ্টা করুন।",
      });
    }
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

  /* ---- O4 (wave 22): convert-to-order actions ---- */
  const fillConvertFromDraft = () => {
    if (!draftResult?.ok) return;
    const d = draftResult.draft;
    setConvDivision(d.address.division);
    setConvDistrict(d.address.district);
    setConvUpazila(d.address.upazila);
    setConvAddressLine(d.address.addressLine);
    setConvItems(
      d.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity, priceTaka: "" })),
    );
  };

  // Creates a REAL order (unlike the draft above). The phone is NOT
  // sent — the server resolves it from the conversation; if none is
  // usable the server answers 422 and its message is shown as-is.
  const convertOrder = async () => {
    if (!selected || convSubmitting) return;
    const items = convItems
      .filter((i) => i.variantId.trim() !== "")
      .map((i) => ({
        variantId: i.variantId.trim(),
        quantity: Math.max(1, Math.floor(i.quantity) || 1),
        ...(i.priceTaka.trim() !== "" && Number.isFinite(Number(i.priceTaka))
          ? { unitPricePoisha: Math.round(Number(i.priceTaka) * 100) }
          : {}),
      }));
    if (items.length === 0) {
      setConvResult({ ok: false, message: "অন্তত একটি আইটেমের variant ID দিন।" });
      return;
    }
    setConvSubmitting(true);
    setConvResult(null);
    try {
      const res = await fetch(
        `/api/v1/admin/inbox/conversations/${selected.id}/convert-to-order`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customerName: draftName,
            items,
            address: {
              division: convDivision,
              district: convDistrict,
              upazila: convUpazila,
              addressLine: convAddressLine,
            },
            paymentMethod: convPayment,
            shippingMethod: convShipping,
          }),
        },
      );
      const payload: unknown = await res.json().catch(() => null);
      const body = payload as {
        data?: { order: { id: string; orderNo: string; totalPoisha: number | null } };
        error?: { message?: string };
      } | null;
      if (res.ok && body?.data?.order) {
        setConvResult({
          ok: true,
          orderId: body.data.order.id,
          orderNo: body.data.order.orderNo,
          totalPoisha: body.data.order.totalPoisha,
        });
      } else {
        setConvResult({
          ok: false,
          message: body?.error?.message ?? "অর্ডার তৈরি করা যায়নি — আবার চেষ্টা করুন।",
        });
      }
    } catch {
      setConvResult({
        ok: false,
        message: "সার্ভারে পৌঁছানো যায়নি — সংযোগ যাচাই করে আবার চেষ্টা করুন।",
      });
    } finally {
      setConvSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {anyChannelLive ? (
        <Card className="border-emerald-300 bg-emerald-50 text-sm text-emerald-900">
          ✅ যেসব চ্যানেলের Meta সেটিংস দেওয়া আছে সেগুলো <strong>লাইভ</strong>:{" "}
          {(Object.keys(CHANNEL_LABEL) as InboxChannel[])
            .map((ch) => `${CHANNEL_LABEL[ch]} — ${channelLive[ch] ? "উত্তর সত্যিকারে যাবে" : "কিউ-ইনটেন্ট (ডেমো)"}`)
            .join(" · ")}
          । লাইভ চ্যানেলে পাঠানো ব্যর্থ হলে Meta-র ত্রুটি এখানেই দেখানো হয় — ভুয়া “পাঠানো
          হয়েছে” দেখানো হয় না। ড্রাফট কোনো অর্ডার নয় — নিশ্চিত করতে ম্যানুয়াল অর্ডার ফর্ম
          ব্যবহার করুন।
        </Card>
      ) : (
        <Card className="border-amber-300 bg-amber-50 text-sm text-amber-900">
          ⚠️ TEMPORARY DEMO — কোনো চ্যানেল API সংযুক্ত নেই। উত্তর <strong>পাঠানো যায় না</strong>:
          কম্পোজার শুধু এই পেজের state-এ “কিউ করা” অভিপ্রায় রাখে। ড্রাফট কোনো অর্ডার নয় এবং
          কোথাও জমা হয় না — নিশ্চিত করতে ম্যানুয়াল অর্ডার ফর্ম ব্যবহার করুন।
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="মোট কথোপকথন" value={String(views.length)} delta="ডাটাবেস" icon="💬" />
        <StatCard label="অপঠিত বার্তা" value={String(totalUnread)} delta="ডাটাবেস" icon="🔔" />
        <StatCard label="চ্যানেল" value="3" delta="Messenger · WhatsApp · Instagram" icon="🔌" />
        <StatCard
          label="চ্যানেল সংযোগ"
          value={anyChannelLive ? "আংশিক লাইভ" : "নেই"}
          delta={
            anyChannelLive
              ? (Object.keys(CHANNEL_LABEL) as InboxChannel[])
                  .map((ch) => `${CHANNEL_LABEL[ch]} ${channelLive[ch] ? "✓" : "ডেমো"}`)
                  .join(" · ")
              : "টাইপ-অনলি ডেমো"
          }
          icon="🔌"
        />
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
                    {selectedLive
                      ? `উত্তর লিখুন — ${CHANNEL_LABEL[selected.channel]} লাইভ, সত্যিকারে পাঠানো হবে`
                      : "উত্তর লিখুন (ডেমো কম্পোজার)"}
                  </label>
                  <textarea
                    id="inbox-reply"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    rows={3}
                    placeholder="উত্তর লিখুন…"
                    className="w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500"
                  />
                  {selectedLive ? (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        onClick={sendReply}
                        disabled={replyText.trim().length === 0 || sendPhase.kind === "sending"}
                      >
                        {sendPhase.kind === "sending" ? "পাঠানো হচ্ছে…" : "পাঠান"}
                      </Button>
                      {sendPhase.kind === "failed" ? (
                        <p role="alert" className="text-xs font-medium text-rose-700">
                          ⚠ পাঠানো যায়নি: {sendPhase.message} — লেখা রেখে দেওয়া হয়েছে, আবার
                          চেষ্টা করুন।
                        </p>
                      ) : (
                        <p className="text-xs text-text-muted">
                          এই উত্তর Meta API দিয়ে সরাসরি গ্রাহকের {CHANNEL_LABEL[selected.channel]}
                          -এ যাবে এবং কথোপকথনে সংরক্ষিত হবে। পাঠানো ব্যর্থ হলে Meta-র ত্রুটি এখানে
                          দেখানো হবে।
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Button type="button" onClick={queueReply} disabled={replyText.trim().length === 0}>
                        কিউতে রাখুন (ডেমো)
                      </Button>
                      <p className="text-xs text-text-muted">
                        আসল পাঠানো বন্ধ আছে — এই চ্যানেলের Meta সেটিংস দেওয়া হয়নি। কিউ করা উত্তর
                        শুধু এই পেজের state-এ থাকে, গ্রাহকের কাছে যায় না।
                      </p>
                    </div>
                  )}
                </div>
              </Card>

              {selected ? <BotDraftPanel conversationId={selected.id} /> : null}

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

              {/* ===== O4 (wave 22): convert-to-order panel — creates a
                  REAL order via POST /admin/inbox/conversations/[id]/
                  convert-to-order (shared manual-create service,
                  source "inbox"). Distinct from the draft above: this
                  persists. The phone is resolved server-side from the
                  conversation; no full number is held or sent here. */}
              <Card>
                <h2 className="mb-1 font-semibold">অর্ডার তৈরি করুন (আসল অর্ডার)</h2>
                <p className="mb-4 text-sm text-text-muted">
                  এটি ড্রাফট নয় — জমা দিলে <strong>আসল অর্ডার</strong> তৈরি হবে (সোর্স: ইনবক্স)
                  এবং অর্ডার নম্বর এখানেই দেখা যাবে। ফোন নম্বর সার্ভারে কথোপকথন থেকে নেওয়া হয় —
                  চ্যাটে ফোন না থাকলে সার্ভার অর্ডার তৈরি করবে না। দাম খালি রাখলে ক্যাটালগ দাম বসবে;
                  টাকায় দাম দিলে তা কর্মীর নির্ধারিত দাম হিসেবে অর্ডার নোটে লেখা থাকবে।
                </p>
                {draftResult?.ok ? (
                  <div className="mb-3">
                    <Button type="button" variant="outline" size="sm" onClick={fillConvertFromDraft}>
                      উপরের ড্রাফট থেকে ঠিকানা ও আইটেম পূরণ করুন
                    </Button>
                  </div>
                ) : null}

                <div className="space-y-2">
                  {convItems.map((item, idx) => (
                    <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_90px_130px_auto]">
                      <Input
                        label={idx === 0 ? "Variant ID" : undefined}
                        name={`conv-variant-${idx}`}
                        value={item.variantId}
                        onChange={(e) =>
                          setConvItems((prev) =>
                            prev.map((p, j) => (j === idx ? { ...p, variantId: e.target.value } : p)),
                          )
                        }
                        placeholder="variant id"
                      />
                      <Input
                        label={idx === 0 ? "পরিমাণ" : undefined}
                        name={`conv-qty-${idx}`}
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) =>
                          setConvItems((prev) =>
                            prev.map((p, j) =>
                              j === idx ? { ...p, quantity: Math.max(1, Number(e.target.value) || 1) } : p,
                            ),
                          )
                        }
                      />
                      <Input
                        label={idx === 0 ? "দাম (টাকা, ঐচ্ছিক)" : undefined}
                        name={`conv-price-${idx}`}
                        type="number"
                        min={0}
                        value={item.priceTaka}
                        onChange={(e) =>
                          setConvItems((prev) =>
                            prev.map((p, j) => (j === idx ? { ...p, priceTaka: e.target.value } : p)),
                          )
                        }
                        placeholder="ক্যাটালগ দাম"
                      />
                      <div className={idx === 0 ? "pt-6" : ""}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setConvItems((prev) =>
                              prev.length > 1 ? prev.filter((_, j) => j !== idx) : prev,
                            )
                          }
                        >
                          মুছুন
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setConvItems((prev) => [...prev, { variantId: "", quantity: 1, priceTaka: "" }])
                    }
                  >
                    + আরেকটি আইটেম
                  </Button>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Input
                    label="বিভাগ"
                    name="conv-division"
                    value={convDivision}
                    onChange={(e) => setConvDivision(e.target.value)}
                  />
                  <Input
                    label="জেলা"
                    name="conv-district"
                    value={convDistrict}
                    onChange={(e) => setConvDistrict(e.target.value)}
                  />
                  <Input
                    label="উপজেলা"
                    name="conv-upazila"
                    value={convUpazila}
                    onChange={(e) => setConvUpazila(e.target.value)}
                  />
                  <Input
                    label="পূর্ণ ঠিকানা (বাসা/রোড/এলাকা)"
                    name="conv-address-line"
                    value={convAddressLine}
                    onChange={(e) => setConvAddressLine(e.target.value)}
                  />
                  <div>
                    <label htmlFor="conv-payment" className="mb-1 block text-xs font-medium text-text-muted">
                      পেমেন্ট
                    </label>
                    <select
                      id="conv-payment"
                      value={convPayment}
                      onChange={(e) => setConvPayment(e.target.value as "cod" | "bkash" | "nagad")}
                      className="w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500"
                    >
                      <option value="cod">ক্যাশ অন ডেলিভারি</option>
                      <option value="bkash">বিকাশ</option>
                      <option value="nagad">নগদ</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="conv-shipping" className="mb-1 block text-xs font-medium text-text-muted">
                      ডেলিভারি এলাকা
                    </label>
                    <select
                      id="conv-shipping"
                      value={convShipping}
                      onChange={(e) =>
                        setConvShipping(e.target.value as "inside_dhaka" | "outside_dhaka" | "pickup")
                      }
                      className="w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500"
                    >
                      <option value="inside_dhaka">ঢাকার ভিতরে</option>
                      <option value="outside_dhaka">ঢাকার বাইরে</option>
                      <option value="pickup">পিকআপ</option>
                    </select>
                  </div>
                </div>

                <div className="mt-4">
                  <Button
                    type="button"
                    variant="gradient"
                    onClick={convertOrder}
                    disabled={convSubmitting}
                  >
                    {convSubmitting ? "অর্ডার তৈরি হচ্ছে…" : "অর্ডার তৈরি করুন"}
                  </Button>
                </div>

                {convResult ? (
                  convResult.ok ? (
                    <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                      <p className="font-semibold">✅ অর্ডার তৈরি হয়েছে।</p>
                      <p className="mt-1">
                        অর্ডার নম্বর:{" "}
                        <a
                          href={`/admin/orders/${convResult.orderId}`}
                          className="font-mono font-semibold text-brand-700 hover:underline"
                        >
                          {convResult.orderNo}
                        </a>
                        {convResult.totalPoisha !== null
                          ? ` · মোট: ${formatBdt(convResult.totalPoisha)}`
                          : ""}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
                      <p className="font-semibold">⚠ অর্ডার তৈরি হয়নি:</p>
                      <p className="mt-1">{convResult.message}</p>
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

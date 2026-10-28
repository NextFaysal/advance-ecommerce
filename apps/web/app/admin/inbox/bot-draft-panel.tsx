"use client";

/**
 * Bot draft panel — F-commerce order bot v1 (doc 22 ADV-6 part 3).
 *
 * STANDALONE: the parent mounts this inside the inbox screen with
 * only a conversationId. It talks to the bot API routes:
 *   GET  /api/v1/admin/inbox/conversations/[id]/bot-draft
 *   POST .../bot-draft            (regenerate)
 *   POST .../bot-draft/confirm    (staff one-tap -> REAL order)
 *   POST .../bot-draft/dismiss
 *
 * The draft it shows is the server's parser output (engine
 * "parser-rules-v1" — rules + the Bangla address parser, NO LLM),
 * computed on read. The phone is displayed MASKED only; the full
 * number never renders here. Confirm stays disabled with the reason
 * shown whenever the draft is incomplete or the parser confidence is
 * low — staff then fix it in the existing conversion panel instead.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

interface BotDraftView {
  engine: string;
  customerName: string;
  phoneMasked: string | null;
  address: {
    division?: string;
    district?: string;
    upazila?: string;
    addressLine?: string;
  };
  addressConfidence: number;
  items: { variantId: string; quantity: number }[];
  missingFields: string[];
  errors: string[];
  ready: boolean;
  confirmable: boolean;
}

type PanelState =
  | { kind: "loading" }
  | { kind: "disabled"; message: string }
  | { kind: "error"; message: string }
  | { kind: "dismissed" }
  | { kind: "draft"; draft: BotDraftView }
  | {
      kind: "ordered";
      orderNo: string;
      totalPoisha: number | null;
    };

const MISSING_LABELS: Record<string, string> = {
  phone: "ফোন নম্বর",
  items: "পণ্য",
  customerName: "গ্রাহকের নাম",
  "address.division": "বিভাগ",
  "address.district": "জেলা",
  "address.upazila": "উপজেলা",
  "address.addressLine": "পূর্ণ ঠিকানা",
};

function confidenceBadge(confidence: number) {
  const pct = Math.round(confidence * 100);
  const tone = confidence >= 0.8 ? "success" : confidence >= 0.5 ? "warning" : "danger";
  return <Badge tone={tone}>পার্সার আস্থা {pct}%</Badge>;
}

export default function BotDraftPanel({
  conversationId,
}: {
  conversationId: string;
}) {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const base = `/api/v1/admin/inbox/conversations/${conversationId}/bot-draft`;

  const load = useCallback(
    async (regenerate: boolean) => {
      setBusy(true);
      setActionError(null);
      try {
        const res = await fetch(base, { method: regenerate ? "POST" : "GET" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const code = body?.error?.code as string | undefined;
          if (code === "FEATURE_LOCKED" || code === "BOT_DISABLED") {
            setState({
              kind: "disabled",
              message:
                body?.error?.message ?? "বট বন্ধ আছে। / The bot is off.",
            });
          } else {
            setState({
              kind: "error",
              message: body?.error?.message ?? `HTTP ${res.status}`,
            });
          }
          return;
        }
        if (body?.data?.dismissed || !body?.data?.draft) {
          setState({ kind: "dismissed" });
          return;
        }
        setState({ kind: "draft", draft: body.data.draft as BotDraftView });
      } catch {
        setState({ kind: "error", message: "নেটওয়ার্ক ত্রুটি। / Network error." });
      } finally {
        setBusy(false);
      }
    },
    [base],
  );

  useEffect(() => {
    setState({ kind: "loading" });
    void load(false);
  }, [load, conversationId]);

  async function act(path: string, onOk: () => void) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`${base}/${path}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(body?.error?.message ?? `HTTP ${res.status}`);
        return;
      }
      onOk();
      if (path === "confirm") {
        setState({
          kind: "ordered",
          orderNo: body?.data?.order?.orderNo ?? "",
          totalPoisha: body?.data?.order?.totalPoisha ?? null,
        });
      }
    } catch {
      setActionError("নেটওয়ার্ক ত্রুটি। / Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-sm text-text-muted shadow-xs">
        🤖 বট ড্রাফট লোড হচ্ছে…
      </div>
    );
  }

  if (state.kind === "disabled") {
    return (
      <div className="rounded-2xl border border-dashed border-border-strong bg-surface-2/40 px-4 py-3 text-sm text-text-muted">
        🤖 অর্ডার বট বন্ধ আছে — {state.message}
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-2xl border border-dashed border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">
        🤖 বট ড্রাফট লোড করা যায়নি: {state.message}
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(false)}
          className="ml-2 underline"
        >
          আবার চেষ্টা করুন
        </button>
      </div>
    );
  }

  if (state.kind === "ordered") {
    return (
      <div className="rounded-2xl border border-success-solid/30 bg-success-soft px-4 py-3 text-sm text-text-main shadow-xs">
        ✅ বট ড্রাফট থেকে অর্ডার তৈরি হয়েছে — <strong>{state.orderNo}</strong>
        {state.totalPoisha !== null
          ? ` (মোট ৳${(state.totalPoisha / 100).toLocaleString("en-US")})`
          : ""}
      </div>
    );
  }

  if (state.kind === "dismissed") {
    return (
      <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-sm shadow-xs">
        <span className="text-text-muted">
          🤖 বট ড্রাফট বাতিল করা হয়েছে। নতুন বার্তা এলে আবার তৈরি হবে।
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(true)}
          className="ml-2 rounded-lg border border-border bg-card px-2 py-1 text-xs text-text-main hover:bg-surface-2"
        >
          আবার তৈরি করুন
        </button>
        {actionError ? (
          <p className="mt-1 text-xs text-danger">{actionError}</p>
        ) : null}
      </div>
    );
  }

  const { draft } = state;
  const confirmBlockedReason = !draft.ready
    ? "ড্রাফট অসম্পূর্ণ — কনভার্সন প্যানেলে ঠিক করুন।"
    : !draft.confirmable
      ? "পার্সার আস্থা কম — কনভার্সন প্যানেলে যাচাই করুন।"
      : null;

  return (
    <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 text-sm shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">🤖 বট ড্রাফট</span>
        {confidenceBadge(draft.addressConfidence)}
        <span className="text-xs text-text-muted">
          parser-rules — AI নয়, নিশ্চিত করার আগে যাচাই করুন
        </span>
      </div>

      <dl className="mt-2 space-y-1">
        <div>
          <dt className="inline font-medium">নাম: </dt>
          <dd className="inline">{draft.customerName || "—"}</dd>
        </div>
        <div>
          <dt className="inline font-medium">ফোন: </dt>
          <dd className="inline">{draft.phoneMasked ?? "পাওয়া যায়নি"}</dd>
        </div>
        <div>
          <dt className="inline font-medium">ঠিকানা: </dt>
          <dd className="inline">
            {[
              draft.address.addressLine,
              draft.address.upazila,
              draft.address.district,
              draft.address.division,
            ]
              .filter(Boolean)
              .join(", ") || "পাওয়া যায়নি"}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">পণ্য: </dt>
          <dd className="inline">
            {draft.items.length > 0
              ? draft.items
                  .map((i) => `${i.variantId.slice(0, 8)}… × ${i.quantity}`)
                  .join(", ")
              : "পাওয়া যায়নি"}
          </dd>
        </div>
      </dl>

      {draft.missingFields.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <span className="text-xs font-medium text-warning-solid">বাকি আছে:</span>
          {draft.missingFields.map((f) => (
            <Badge key={f} tone="warning">
              {MISSING_LABELS[f] ?? f}
            </Badge>
          ))}
        </div>
      ) : null}

      {draft.errors.length > 0 ? (
        <ul className="mt-1 list-inside list-disc text-xs text-danger">
          {draft.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || confirmBlockedReason !== null}
          title={confirmBlockedReason ?? undefined}
          onClick={() => void act("confirm", () => undefined)}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          এক ক্লিকে অর্ডার নিশ্চিত করুন
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void act("dismiss", () => setState({ kind: "dismissed" }))
          }
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-text-main hover:bg-surface-2"
        >
          বাতিল করুন
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(true)}
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-text-main hover:bg-surface-2"
        >
          আবার তৈরি করুন
        </button>
      </div>
      {confirmBlockedReason ? (
        <p className="mt-1 text-xs text-warning-solid">{confirmBlockedReason}</p>
      ) : null}
      {actionError ? (
        <p className="mt-1 text-xs text-danger">{actionError}</p>
      ) : null}
    </div>
  );
}

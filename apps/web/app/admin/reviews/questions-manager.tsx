"use client";

/**
 * Product Q&A moderation queue (client) — mounted under the review
 * moderation queue on /admin/reviews. Reads GET
 * /api/v1/admin/product-questions and PATCHes
 * /api/v1/admin/product-questions/[id] with
 * { action: "answer" | "hide" | "restore" }. Answering is the moment
 * a question becomes public on the PDP (ANSWERED is the only public
 * status); hiding keeps it staff-only. Guarded by content.page in
 * the API, same as review moderation.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

type QuestionStatus = "PENDING" | "ANSWERED" | "HIDDEN";

interface AdminQuestion {
  id: string;
  productId: string;
  productTitleBn: string;
  productSlug: string;
  authorName: string;
  question: string;
  answer: string | null;
  status: QuestionStatus;
  createdAt: string;
  answeredAt: string | null;
}

type TabKey = QuestionStatus | "ALL";

interface QuestionsResponse {
  data?: {
    questions: AdminQuestion[];
    counts: Record<QuestionStatus, number>;
  };
  error?: { code: string; message: string };
}

interface PatchResponse {
  data?: { question: AdminQuestion };
  error?: { code: string; message: string };
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "PENDING", label: "উত্তর বাকি" },
  { key: "ANSWERED", label: "উত্তর দেওয়া" },
  { key: "HIDDEN", label: "লুকানো" },
  { key: "ALL", label: "সব" },
];

const STATUS_BADGE: Record<QuestionStatus, { label: string; tone: "success" | "warning" | "danger" }> = {
  PENDING: { label: "উত্তর বাকি (PENDING)", tone: "warning" },
  ANSWERED: { label: "প্রকাশিত (ANSWERED)", tone: "success" },
  HIDDEN: { label: "লুকানো (HIDDEN)", tone: "danger" },
};

type LoadState = "loading" | "ready" | "error";

function bnDate(iso: string): string {
  return new Date(iso).toLocaleDateString("bn-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function QuestionsManager() {
  const [tab, setTab] = useState<TabKey>("PENDING");
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [counts, setCounts] = useState<Record<QuestionStatus, number>>({ PENDING: 0, ANSWERED: 0, HIDDEN: 0 });
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async (forTab: TabKey) => {
    setLoadState("loading");
    try {
      const qs = forTab === "ALL" ? "" : `?status=${forTab}`;
      const res = await fetch(`/api/v1/admin/product-questions${qs}`);
      const json = (await res.json().catch(() => null)) as QuestionsResponse | null;
      if (!res.ok || !json?.data) {
        setLoadState("error");
        setLoadError(json?.error?.message ?? "প্রশ্ন লোড করা যায়নি।");
        return;
      }
      setQuestions(json.data.questions);
      setCounts(json.data.counts);
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setLoadError("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।");
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  async function patch(id: string, payload: Record<string, unknown>) {
    setBusyId(id);
    setRowError(null);
    try {
      const res = await fetch(`/api/v1/admin/product-questions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as PatchResponse | null;
      if (!res.ok || !json?.data) {
        setRowError(json?.error?.message ?? "কাজটি করা যায়নি।");
        return;
      }
      void load(tab);
    } catch {
      setRowError("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="প্রশ্নের স্ট্যাটাস">
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
      </div>

      {rowError ? (
        <p role="alert" className="text-sm font-medium text-rose-600">
          {rowError}
        </p>
      ) : null}

      {loadState === "loading" ? (
        <p className="text-sm text-text-muted">লোড হচ্ছে…</p>
      ) : loadState === "error" ? (
        <p className="text-sm font-medium text-rose-600">{loadError}</p>
      ) : questions.length === 0 ? (
        <Card>
          <p className="text-sm text-text-muted">এই তালিকায় কোনো প্রশ্ন নেই।</p>
        </Card>
      ) : (
        <ul className="space-y-4">
          {questions.map((q) => (
            <li key={q.id}>
              <Card>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-text-main">{q.productTitleBn}</span>
                  <Badge tone={STATUS_BADGE[q.status].tone}>{STATUS_BADGE[q.status].label}</Badge>
                  <span className="text-xs text-text-subtle">{bnDate(q.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-text-main">
                  প্র: {q.question}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">প্রশ্নকারী: {q.authorName}</p>
                {q.answer ? (
                  <p className="mt-2 break-words text-sm leading-6 text-text-muted [overflow-wrap:anywhere]">
                    <span className="font-bold text-text-main">উ:</span> {q.answer}
                  </p>
                ) : null}

                <div className="mt-3.5 space-y-2.5">
                  <textarea
                    value={drafts[q.id] ?? q.answer ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                    rows={2}
                    maxLength={5000}
                    placeholder="উত্তর লিখুন…"
                    className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-text-main outline-none focus:border-brand-500"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyId === q.id || !(drafts[q.id] ?? q.answer ?? "").trim()}
                      onClick={() =>
                        void patch(q.id, {
                          action: "answer",
                          answer: (drafts[q.id] ?? q.answer ?? "").trim(),
                        })
                      }
                      className="brand-gradient h-9 rounded-lg px-3.5 text-xs font-bold text-white shadow transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
                    >
                      {q.status === "ANSWERED" ? "উত্তর আপডেট করুন" : "উত্তর দিয়ে প্রকাশ করুন"}
                    </button>
                    {q.status !== "HIDDEN" ? (
                      <button
                        type="button"
                        disabled={busyId === q.id}
                        onClick={() => void patch(q.id, { action: "hide" })}
                        className="h-9 rounded-lg border border-border bg-card px-3.5 text-xs font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-60"
                      >
                        লুকান
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === q.id}
                        onClick={() => void patch(q.id, { action: "restore" })}
                        className="h-9 rounded-lg border border-border bg-card px-3.5 text-xs font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-60"
                      >
                        ফিরিয়ে আনুন
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

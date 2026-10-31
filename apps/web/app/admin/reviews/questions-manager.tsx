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
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick, type Locale } from "@/i18n/locale";
import { REVIEWS_ADMIN_STRINGS, type ReviewsAdminStrings } from "./strings";

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

function tabs(s: ReviewsAdminStrings): Array<{ key: TabKey; label: string }> {
  return [
    { key: "PENDING", label: s.qTabPending },
    { key: "ANSWERED", label: s.qTabAnswered },
    { key: "HIDDEN", label: s.qTabHidden },
    { key: "ALL", label: s.qTabAll },
  ];
}

function statusBadge(
  s: ReviewsAdminStrings,
): Record<QuestionStatus, { label: string; tone: "success" | "warning" | "danger" }> {
  return {
    PENDING: { label: s.qBadgePending, tone: "warning" },
    ANSWERED: { label: s.qBadgeAnswered, tone: "success" },
    HIDDEN: { label: s.qBadgeHidden, tone: "danger" },
  };
}

type LoadState = "loading" | "ready" | "error";

function fmtDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(intlLocale(locale), {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function QuestionsManager() {
  const { locale } = useLocale();
  const s = pick(locale, REVIEWS_ADMIN_STRINGS);
  const TABS = tabs(s);
  const STATUS_BADGE = statusBadge(s);
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
        setLoadError(json?.error?.message ?? s.qLoadFailed);
        return;
      }
      setQuestions(json.data.questions);
      setCounts(json.data.counts);
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setLoadError(s.qNetworkError);
    }
  }, [s]);

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
        setRowError(json?.error?.message ?? s.qActionFailed);
        return;
      }
      void load(tab);
    } catch {
      setRowError(s.qNetworkError);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={s.qTabsAria}>
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              tab === t.key
                ? "bg-brand-600 text-white shadow"
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
        <p className="text-sm text-text-muted">{s.loading}</p>
      ) : loadState === "error" ? (
        <p className="text-sm font-medium text-rose-600">{loadError}</p>
      ) : questions.length === 0 ? (
        <Card>
          <p className="text-sm text-text-muted">{s.qEmpty}</p>
        </Card>
      ) : (
        <ul className="space-y-4">
          {questions.map((q) => (
            <li key={q.id}>
              <Card>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-text-main">{q.productTitleBn}</span>
                  <Badge tone={STATUS_BADGE[q.status].tone}>{STATUS_BADGE[q.status].label}</Badge>
                  <span className="text-xs text-text-subtle">{fmtDate(q.createdAt, locale)}</span>
                </div>
                <p className="mt-2 text-sm font-semibold text-text-main">
                  {interpolate(s.qPrefix, { question: q.question })}
                </p>
                <p className="mt-0.5 text-xs text-text-muted">{interpolate(s.qAsker, { name: q.authorName })}</p>
                {q.answer ? (
                  <p className="mt-2 break-words text-sm leading-6 text-text-muted [overflow-wrap:anywhere]">
                    <span className="font-bold text-text-main">{s.qAnswerPrefix}</span> {q.answer}
                  </p>
                ) : null}

                <div className="mt-3.5 space-y-2.5">
                  <textarea
                    value={drafts[q.id] ?? q.answer ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                    rows={2}
                    maxLength={5000}
                    placeholder={s.qAnswerPlaceholder}
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
                      {q.status === "ANSWERED" ? s.qUpdateAnswer : s.qAnswerPublish}
                    </button>
                    {q.status !== "HIDDEN" ? (
                      <button
                        type="button"
                        disabled={busyId === q.id}
                        onClick={() => void patch(q.id, { action: "hide" })}
                        className="h-9 rounded-lg border border-border bg-card px-3.5 text-xs font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-60"
                      >
                        {s.qHide}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === q.id}
                        onClick={() => void patch(q.id, { action: "restore" })}
                        className="h-9 rounded-lg border border-border bg-card px-3.5 text-xs font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-60"
                      >
                        {s.qRestore}
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

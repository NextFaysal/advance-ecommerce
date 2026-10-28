"use client";

/**
 * Call QA table (client) — C3, pagination R2.4. Fetches
 * GET /api/v1/admin/call-center/qa (newest completed call logs) with
 * SERVER-side filters (?agentId=, ?minScore=): changing a filter
 * resets to page 1. "আরও দেখুন (Load more)" follows the response's
 * `nextCursor` (?before=<logId>) and APPENDS older rows; scoring any
 * row (loaded or appended) goes through PATCH qa/[logId]
 * { qaScore 0..5, qaComment }. Scores are a supervisor action
 * (staff.manage) — a 403 from the PATCH is shown verbatim.
 *
 * CD3 (doc 20) presentation pass: outcome/source/disposition render
 * through CD0's badges (src/callcenter/components — OutcomeBadge,
 * SourceChip, DispositionChip; fraud-signal dispositions get CD0's
 * danger + shield treatment), the saved QA score gains a 5-star
 * meter, and rows stack into cards on small screens. The raw code
 * stays visible in mono beside each badge. Fetch/pagination/save
 * logic is untouched. (An outcome string outside the CallOutcome
 * union — never expected in this queue — falls back to this file's
 * pre-existing tone rule on a plain Badge.)
 */
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { DataTableSkeleton } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { dispositionDef, isCallDisposition } from "@/callcenter/dispositions";
import { DispositionChip, OutcomeBadge, SourceChip } from "@/callcenter/components/badges";
import { OUTCOME_VISUAL, SOURCE_VISUAL, type StatusVisual } from "@/callcenter/components/visuals";
import type { CallOutcome, CallQueueSource } from "@/callcenter/types";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick, type Locale } from "@/i18n/locale";
import { CALL_CENTER_STRINGS } from "../strings";

/** Saved QA score as a 5-star meter (display only — the editable
 *  draft lives in the number input beside it). */
function ScoreMeter({ score, locale }: { score: number | null; locale: Locale }) {
  const s = pick(locale, CALL_CENTER_STRINGS);
  return (
    <span
      className="mt-1 flex items-center gap-0.5"
      role="img"
      aria-label={score === null ? s.scoreNotYet : interpolate(s.scoreAria, { score })}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <Icon
          key={i}
          name="star"
          size={13}
          className={score !== null && i < score ? "text-warning-solid" : "text-text-subtle/50"}
        />
      ))}
      <span className="tnum ml-1 font-mono text-[11px] tabular-nums text-text-muted">
        {score === null ? s.scoreFractionNone : interpolate(s.scoreFraction, { score })}
      </span>
    </span>
  );
}

interface QaLog {
  id: string;
  taskId: string;
  source: string;
  orderId: string | null;
  agentId: string | null;
  agentName: string | null;
  outcome: string;
  disposition: string | null;
  scriptVersion: string | null;
  note: string | null;
  qaScore: number | null;
  qaComment: string | null;
  calledAt: string;
}

interface QaResponse {
  data?: { logs: QaLog[]; returned: number; unscored: number; nextCursor: string | null };
  error?: { code?: string; message?: string };
}

type Drafts = Record<string, { score: string; comment: string }>;

function draftsFor(logs: QaLog[]): Drafts {
  const drafts: Drafts = {};
  for (const log of logs) {
    drafts[log.id] = {
      score: log.qaScore !== null ? String(log.qaScore) : "",
      comment: log.qaComment ?? "",
    };
  }
  return drafts;
}

export function QaTable() {
  const { locale } = useLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
  const [logs, setLogs] = useState<QaLog[] | null>(null);
  const [unscored, setUnscored] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [agentFilter, setAgentFilter] = useState<string>("");
  const [minScoreFilter, setMinScoreFilter] = useState<string>("");
  // Agents seen in ANY loaded page — the filter dropdown never loses
  // an option just because that agent's rows are on an older page.
  const [knownAgents, setKnownAgents] = useState<{ id: string; name: string }[]>([]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  function pageUrl(before?: string): string {
    const qs = new URLSearchParams();
    if (agentFilter) qs.set("agentId", agentFilter);
    if (minScoreFilter !== "") qs.set("minScore", minScoreFilter);
    if (before) qs.set("before", before);
    const s = qs.toString();
    return s ? `/api/v1/admin/call-center/qa?${s}` : "/api/v1/admin/call-center/qa";
  }

  function rememberAgents(incoming: QaLog[]) {
    setKnownAgents((prev) => {
      const map = new Map(prev.map((a) => [a.id, a.name]));
      for (const log of incoming) {
        if (log.agentId) map.set(log.agentId, log.agentName ?? log.agentId);
      }
      return [...map.entries()].map(([id, name]) => ({ id, name }));
    });
  }

  // Page 1 — runs on mount and whenever a filter changes (reset).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLogs(null);
      setNextCursor(null);
      setMoreError(null);
      setLoadError(null);
      setLocked(false);
      try {
        const res = await fetch(pageUrl());
        const json = (await res.json().catch(() => ({}))) as QaResponse;
        if (cancelled) return;
        if (!res.ok || !json.data) {
          if (json.error?.code === "FEATURE_LOCKED") setLocked(true);
          setLoadError(json.error?.message ?? interpolate(s.loadFailed, { status: res.status }));
          setLogs([]);
          return;
        }
        setLogs(json.data.logs);
        setUnscored(json.data.unscored);
        setNextCursor(json.data.nextCursor);
        setDrafts(draftsFor(json.data.logs));
        rememberAgents(json.data.logs);
      } catch {
        if (cancelled) return;
        setLoadError(s.networkErrorRetry);
        setLogs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // pageUrl is derived from the two filters; they are the real deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentFilter, minScoreFilter, locale]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await fetch(pageUrl(nextCursor));
      const json = (await res.json().catch(() => ({}))) as QaResponse;
      if (!res.ok || !json.data) {
        // Loaded rows stay on screen; only the button area reports.
        setMoreError(json.error?.message ?? interpolate(s.loadFailed, { status: res.status }));
        return;
      }
      const incoming = json.data.logs;
      setLogs((prev) => [...(prev ?? []), ...incoming]);
      setUnscored((n) => n + json.data!.unscored);
      setNextCursor(json.data.nextCursor);
      setDrafts((prev) => ({ ...draftsFor(incoming), ...prev }));
      rememberAgents(incoming);
    } catch {
      setMoreError(s.networkErrorRetry);
    } finally {
      setLoadingMore(false);
    }
  }

  async function saveScore(log: QaLog) {
    const draft = drafts[log.id] ?? { score: "", comment: "" };
    const score = Number(draft.score);
    if (!Number.isInteger(score) || score < 0 || score > 5) {
      setRowError((p) => ({ ...p, [log.id]: s.scoreRangeError }));
      return;
    }
    setSavingId(log.id);
    setRowError((p) => ({ ...p, [log.id]: "" }));
    try {
      const res = await fetch(`/api/v1/admin/call-center/qa/${log.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qaScore: score, qaComment: draft.comment }),
      });
      const json = (await res.json().catch(() => ({}))) as QaResponse & { data?: { log: QaLog } };
      if (!res.ok || !json.data?.log) {
        setRowError((p) => ({ ...p, [log.id]: json.error?.message ?? interpolate(s.saveFailed, { status: res.status }) }));
        return;
      }
      const updated = json.data.log;
      setLogs((prev) => (prev ?? []).map((l) => (l.id === updated.id ? { ...l, qaScore: updated.qaScore, qaComment: updated.qaComment } : l)));
      setUnscored((n) => Math.max(0, n - (log.qaScore === null ? 1 : 0)));
    } catch {
      setRowError((p) => ({ ...p, [log.id]: s.networkErrorRetry }));
    } finally {
      setSavingId(null);
    }
  }

  if (logs === null)
    return (
      <div aria-busy="true">
        <p className="mb-3 text-sm text-text-muted">{s.loadingText}</p>
        <DataTableSkeleton columns={9} rows={5} />
      </div>
    );
  if (locked) {
    return (
      <p role="status" className="rounded-xl bg-warning-soft px-3.5 py-2.5 text-small leading-relaxed text-warning-solid">
        {s.lockedQa}
      </p>
    );
  }
  if (loadError) {
    return (
      <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-small leading-relaxed text-danger">
        {loadError}
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm">
          {s.agentFilterLabel}{" "}
          <select
            className="h-11 rounded-xl border border-border bg-surface px-2.5 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
          >
            <option value="">{s.allAgents}</option>
            {knownAgents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {s.minScoreLabel}{" "}
          <select
            className="h-11 rounded-xl border border-border bg-surface px-2.5 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            value={minScoreFilter}
            onChange={(e) => setMinScoreFilter(e.target.value)}
          >
            <option value="">{s.allScores}</option>
            {[0, 1, 2, 3, 4, 5].map((s) => (
              <option key={s} value={String(s)}>{s}+</option>
            ))}
          </select>
        </label>
        <span className="text-sm text-text-muted">
          {interpolate(s.loadedSummary, { loaded: logs.length, unscored })}
          {nextCursor ? s.moreOldSuffix : ""}
        </span>
      </div>

      {logs.length === 0 ? (
        <EmptyState title={s.qaEmptyTitle} description={s.qaEmptyDesc} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm max-lg:block">
            <thead className="max-lg:hidden">
              <tr className="border-b border-border bg-surface-2/80 text-left text-xs font-semibold text-text-muted">
                <th className="py-2 pr-3">{s.colTime}</th>
                <th className="py-2 pr-3">{s.colSource}</th>
                <th className="py-2 pr-3">{s.colAgent}</th>
                <th className="py-2 pr-3">{s.colOutcome}</th>
                <th className="py-2 pr-3">{s.colDisposition}</th>
                <th className="py-2 pr-3">{s.colScript}</th>
                <th className="py-2 pr-3">{s.colNote}</th>
                <th className="py-2 pr-3">{s.colQaScore}</th>
                <th className="py-2">{s.colSave}</th>
              </tr>
            </thead>
            <tbody className="max-lg:block">
              {logs.map((log) => {
                const draft = drafts[log.id] ?? { score: "", comment: "" };
                const disp =
                  log.disposition && isCallDisposition(log.disposition)
                    ? dispositionDef(log.disposition)
                    : null;
                const outcomeV = (OUTCOME_VISUAL as Record<string, StatusVisual>)[
                  log.outcome
                ];
                const sourceV = (SOURCE_VISUAL as Record<string, StatusVisual>)[log.source];
                return (
                  <tr
                    key={log.id}
                    className="border-b border-border/60 align-top max-lg:mb-3 max-lg:block max-lg:rounded-2xl max-lg:border max-lg:bg-card max-lg:p-3 max-lg:shadow-xs"
                  >
                    <td className="py-2 pr-3 whitespace-nowrap max-lg:block max-lg:py-1 max-lg:pr-0">
                      {new Date(log.calledAt).toLocaleString(intlLocale(locale), { timeZone: "Asia/Dhaka" })}
                    </td>
                    <td className="py-2 pr-3 max-lg:block max-lg:py-1 max-lg:pr-0">
                      {sourceV ? (
                        <SourceChip source={log.source as CallQueueSource} lang={locale} />
                      ) : (
                        log.source
                      )}
                    </td>
                    <td className="py-2 pr-3 max-lg:block max-lg:py-1 max-lg:pr-0">{log.agentName ?? "—"}</td>
                    <td className="py-2 pr-3 max-lg:block max-lg:py-1 max-lg:pr-0">
                      {outcomeV ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <OutcomeBadge outcome={log.outcome as CallOutcome} lang={locale} />
                          <span className="font-mono text-[11px] text-text-muted">
                            {log.outcome}
                          </span>
                        </span>
                      ) : (
                        <Badge tone={log.outcome === "CONFIRMED" ? "success" : log.outcome === "CANCELLED" || log.outcome === "WRONG_NUMBER" ? "danger" : "info"}>
                          {log.outcome}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 max-lg:block max-lg:py-1 max-lg:pr-0">
                      {disp ? (
                        <span className="inline-flex flex-wrap items-center gap-2">
                          <DispositionChip disposition={disp.code} lang={locale} />
                          <span className="font-mono text-[11px] text-text-muted">
                            ({disp.code})
                          </span>
                        </span>
                      ) : (
                        (log.disposition ?? "—")
                      )}
                    </td>
                    <td className="py-2 pr-3 max-lg:block max-lg:py-1 max-lg:pr-0">
                      {log.scriptVersion ? (
                        <span className="inline-flex h-6 items-center rounded-md bg-surface-2 px-2 font-mono text-xs font-medium text-text-muted ring-1 ring-inset ring-black/5">
                          {log.scriptVersion}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3 max-w-56 max-lg:block max-lg:max-w-none max-lg:py-1 max-lg:pr-0">{log.note ?? "—"}</td>
                    <td className="py-2 pr-3 max-lg:block max-lg:py-1 max-lg:pr-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={5}
                          step={1}
                          className="h-11 w-16 rounded-xl border border-border bg-surface px-2 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                          value={draft.score}
                          onChange={(e) => setDrafts((p) => ({ ...p, [log.id]: { ...draft, score: e.target.value } }))}
                          aria-label={s.qaScoreAria}
                        />
                        <input
                          className="h-11 w-full rounded-xl border border-border bg-surface px-2 shadow-xs sm:w-48 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                          value={draft.comment}
                          onChange={(e) => setDrafts((p) => ({ ...p, [log.id]: { ...draft, comment: e.target.value } }))}
                          placeholder={s.qaCommentPlaceholder}
                          aria-label={s.qaCommentAria}
                        />
                      </div>
                      {log.qaScore !== null ? (
                        <span className="text-xs text-success-solid">{interpolate(s.currentScore, { score: log.qaScore })}</span>
                      ) : (
                        <span className="text-xs text-text-muted">{s.scoreNotYet}</span>
                      )}
                      <ScoreMeter score={log.qaScore} locale={locale} />
                      {rowError[log.id] ? <div className="text-xs text-danger">{rowError[log.id]}</div> : null}
                    </td>
                    <td className="py-2 max-lg:block max-lg:py-1">
                      <button
                        type="button"
                        className="brand-gradient rounded-xl px-3 py-2 text-sm font-medium text-white shadow-glow hover:brightness-105 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                        onClick={() => saveScore(log)}
                        disabled={savingId === log.id}
                      >
                        {savingId === log.id ? "…" : s.scoreBtn}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? s.loadingText : s.loadMoreBtn}
          </Button>
          {moreError ? (
            <span role="alert" className="text-sm text-danger">{moreError}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

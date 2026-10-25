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
 */
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { dispositionDef, isCallDisposition } from "@/callcenter/dispositions";

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
          setLoadError(json.error?.message ?? `লোড ব্যর্থ হয়েছে (${res.status})`);
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
        setLoadError("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।");
        setLogs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // pageUrl is derived from the two filters; they are the real deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentFilter, minScoreFilter]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await fetch(pageUrl(nextCursor));
      const json = (await res.json().catch(() => ({}))) as QaResponse;
      if (!res.ok || !json.data) {
        // Loaded rows stay on screen; only the button area reports.
        setMoreError(json.error?.message ?? `লোড ব্যর্থ হয়েছে (${res.status})`);
        return;
      }
      const incoming = json.data.logs;
      setLogs((prev) => [...(prev ?? []), ...incoming]);
      setUnscored((n) => n + json.data!.unscored);
      setNextCursor(json.data.nextCursor);
      setDrafts((prev) => ({ ...draftsFor(incoming), ...prev }));
      rememberAgents(incoming);
    } catch {
      setMoreError("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।");
    } finally {
      setLoadingMore(false);
    }
  }

  async function saveScore(log: QaLog) {
    const draft = drafts[log.id] ?? { score: "", comment: "" };
    const score = Number(draft.score);
    if (!Number.isInteger(score) || score < 0 || score > 5) {
      setRowError((p) => ({ ...p, [log.id]: "স্কোর ০–৫ এর মধ্যে পূর্ণ সংখ্যা হতে হবে।" }));
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
        setRowError((p) => ({ ...p, [log.id]: json.error?.message ?? `সেভ ব্যর্থ হয়েছে (${res.status})` }));
        return;
      }
      const updated = json.data.log;
      setLogs((prev) => (prev ?? []).map((l) => (l.id === updated.id ? { ...l, qaScore: updated.qaScore, qaComment: updated.qaComment } : l)));
      setUnscored((n) => Math.max(0, n - (log.qaScore === null ? 1 : 0)));
    } catch {
      setRowError((p) => ({ ...p, [log.id]: "নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।" }));
    } finally {
      setSavingId(null);
    }
  }

  if (logs === null) return <p className="text-sm text-text-muted">লোড হচ্ছে… (Loading…)</p>;
  if (locked) {
    return (
      <p role="status" className="rounded-md bg-amber-50 px-3.5 py-2.5 text-small leading-relaxed text-amber-800">
        🔒 Call Center মডিউল লক করা আছে (module.call_center OFF) — QA তালিকা দেখা যাচ্ছে না।
      </p>
    );
  }
  if (loadError) {
    return (
      <p role="alert" className="rounded-md bg-rose-50 px-3.5 py-2.5 text-small leading-relaxed text-rose-700">
        {loadError}
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="text-sm">
          এজেন্ট:{" "}
          <select
            className="h-10 rounded-md border border-border px-2"
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
          >
            <option value="">সবাই</option>
            {knownAgents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          সর্বনিম্ন স্কোর:{" "}
          <select
            className="h-10 rounded-md border border-border px-2"
            value={minScoreFilter}
            onChange={(e) => setMinScoreFilter(e.target.value)}
          >
            <option value="">সব</option>
            {[0, 1, 2, 3, 4, 5].map((s) => (
              <option key={s} value={String(s)}>{s}+</option>
            ))}
          </select>
        </label>
        <span className="text-sm text-text-muted">
          মোট {logs.length}টি কল লোড হয়েছে · স্কোর বাকি {unscored}টি
          {nextCursor ? " · আরও পুরনো কল আছে" : ""}
        </span>
      </div>

      {logs.length === 0 ? (
        <p className="text-sm text-text-muted">কোনো সম্পন্ন কল পাওয়া যায়নি। (No completed calls found.)</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2 pr-3">সময়</th>
                <th className="py-2 pr-3">উৎস</th>
                <th className="py-2 pr-3">এজেন্ট</th>
                <th className="py-2 pr-3">ফলাফল</th>
                <th className="py-2 pr-3">Disposition</th>
                <th className="py-2 pr-3">স্ক্রিপ্ট</th>
                <th className="py-2 pr-3">নোট</th>
                <th className="py-2 pr-3">QA স্কোর (০–৫)</th>
                <th className="py-2">সংরক্ষণ</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => {
                const draft = drafts[log.id] ?? { score: "", comment: "" };
                return (
                  <tr key={log.id} className="border-b border-border align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {new Date(log.calledAt).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })}
                    </td>
                    <td className="py-2 pr-3">{log.source}</td>
                    <td className="py-2 pr-3">{log.agentName ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={log.outcome === "CONFIRMED" ? "success" : log.outcome === "CANCELLED" || log.outcome === "WRONG_NUMBER" ? "danger" : "info"}>
                        {log.outcome}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">
                      {log.disposition && isCallDisposition(log.disposition)
                        ? `${dispositionDef(log.disposition).labelBn} (${log.disposition})`
                        : (log.disposition ?? "—")}
                    </td>
                    <td className="py-2 pr-3">{log.scriptVersion ?? "—"}</td>
                    <td className="py-2 pr-3 max-w-56">{log.note ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={5}
                          step={1}
                          className="h-10 w-16 rounded-md border border-border px-2"
                          value={draft.score}
                          onChange={(e) => setDrafts((p) => ({ ...p, [log.id]: { ...draft, score: e.target.value } }))}
                          aria-label="QA score"
                        />
                        <input
                          className="h-10 w-48 rounded-md border border-border px-2"
                          value={draft.comment}
                          onChange={(e) => setDrafts((p) => ({ ...p, [log.id]: { ...draft, comment: e.target.value } }))}
                          placeholder="QA মন্তব্য (ঐচ্ছিক)"
                          aria-label="QA comment"
                        />
                      </div>
                      {log.qaScore !== null ? (
                        <span className="text-xs text-emerald-700">বর্তমান স্কোর: {log.qaScore}</span>
                      ) : (
                        <span className="text-xs text-text-muted">এখনো স্কোর হয়নি</span>
                      )}
                      {rowError[log.id] ? <div className="text-xs text-rose-700">{rowError[log.id]}</div> : null}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                        onClick={() => saveScore(log)}
                        disabled={savingId === log.id}
                      >
                        {savingId === log.id ? "…" : "স্কোর দিন"}
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
          <button
            type="button"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium disabled:opacity-50"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? "লোড হচ্ছে…" : "আরও দেখুন (Load more)"}
          </button>
          {moreError ? (
            <span role="alert" className="text-sm text-rose-700">{moreError}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

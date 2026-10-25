"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { SourceChip, TaskStatusBadge } from "@/callcenter/components";
import type { StaffAgentOption, SupervisorTaskView } from "@/callcenter/supervisor-store";
import { ageLabel } from "./board-ui";

// Supervisor task-management controls (C2, CD2 redesign). Renders the
// board's open tasks as action cards with reassign / release /
// force-close controls; every action POSTs to
// /api/v1/admin/call-center/supervisor/actions (staff.manage +
// module.call_center gated server-side) and router.refresh()es on
// success so the server-rendered board re-reads the DB. The action
// plumbing (bodies, disabled rules, result messaging) is unchanged
// from the table version — only the presentation moved. Props are
// plain serializable data only — no function props cross the boundary.
interface Props {
  tasks: SupervisorTaskView[];
  agents: StaffAgentOption[];
}

type ActionBody =
  | { action: "reassign"; taskId: string; agentId: string }
  | { action: "release"; taskId: string }
  | { action: "force-close"; taskId: string; reason: string };

const inputCls =
  "min-h-[44px] w-full rounded-md border border-border bg-card px-3 text-sm text-text-main outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-300/40 disabled:opacity-50 sm:min-h-[38px]";
const btnBase =
  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-[38px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300";

export function SupervisorControls({ tasks, agents }: Props) {
  const router = useRouter();
  const [selectedAgent, setSelectedAgent] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(body: ActionBody) {
    setBusyTaskId(body.taskId);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/admin/call-center/supervisor/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        data?: { note?: string };
        error?: { message?: string };
      };
      if (!res.ok) {
        setMessage({ ok: false, text: payload.error?.message ?? `Action failed (HTTP ${res.status}).` });
        return;
      }
      setMessage({ ok: true, text: payload.data?.note ?? "Done." });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Network error — the action was not sent." });
    } finally {
      setBusyTaskId(null);
    }
  }

  if (tasks.length === 0) {
    return <p className="text-sm text-text-muted">No open tasks right now — nothing to manage.</p>;
  }

  return (
    <div>
      {message ? (
        <p
          role="status"
          className={`mb-4 rounded-md px-3.5 py-2.5 text-sm ${
            message.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          }`}
        >
          {message.text}
        </p>
      ) : null}
      <ul className="space-y-3">
        {tasks.map((t) => {
          const busy = busyTaskId === t.id;
          const chosenAgent = selectedAgent[t.id] ?? "";
          const reason = reasons[t.id] ?? "";
          return (
            <li key={t.id} className="rounded-lg border border-border/70 bg-card p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-main">{t.customerName || "—"}</p>
                  <p className="mt-0.5 font-mono text-xs tabular-nums text-text-muted">{t.phoneMasked}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <SourceChip source={t.source} />
                  <TaskStatusBadge status={t.status} />
                  {t.orderNo ? (
                    <Badge tone="neutral" icon={<Icon name="package" size={12} />}>
                      {t.orderNo}
                    </Badge>
                  ) : null}
                </div>
              </div>

              <p className="mt-2.5 text-xs text-text-muted">
                দায়িত্বে:{" "}
                <span className="font-medium text-text-main">
                  {t.assignedAgentName ?? t.assignedAgentId ?? "কেউ নয়"}
                </span>{" "}
                · বয়স: <span className="font-medium text-text-main">{ageLabel(t.ageMinutes)}</span> · চেষ্টা:{" "}
                <span className="font-medium text-text-main">{t.attempts}</span>
              </p>

              <div className="mt-3.5 grid gap-2 border-t border-border/60 pt-3.5 sm:grid-cols-[1fr_auto] lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
                <select
                  aria-label={`Reassign target for task ${t.id}`}
                  value={chosenAgent}
                  disabled={busy}
                  onChange={(e) => setSelectedAgent((s) => ({ ...s, [t.id]: e.target.value }))}
                  className={inputCls}
                >
                  <option value="">Select agent…</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name ?? a.id}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy || chosenAgent === "" || chosenAgent === t.assignedAgentId}
                  onClick={() => run({ action: "reassign", taskId: t.id, agentId: chosenAgent })}
                  className={`${btnBase} bg-brand-600 text-white hover:bg-brand-700`}
                >
                  <Icon name="users" size={15} />
                  Reassign
                </button>
                <input
                  aria-label={`Force-close reason for task ${t.id}`}
                  placeholder="Force-close reason (required)"
                  value={reason}
                  disabled={busy}
                  onChange={(e) => setReasons((s) => ({ ...s, [t.id]: e.target.value }))}
                  className={inputCls}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy || t.assignedAgentId === null}
                    onClick={() => run({ action: "release", taskId: t.id })}
                    className={`${btnBase} flex-1 border border-border bg-card text-text-main hover:bg-surface-2 lg:flex-none`}
                  >
                    <Icon name="rotate-ccw" size={15} />
                    Release
                  </button>
                  <button
                    type="button"
                    disabled={busy || reason.trim() === ""}
                    onClick={() => run({ action: "force-close", taskId: t.id, reason: reason.trim() })}
                    className={`${btnBase} flex-1 bg-rose-600 text-white hover:bg-rose-700 lg:flex-none`}
                  >
                    <Icon name="x" size={15} />
                    Force-close
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

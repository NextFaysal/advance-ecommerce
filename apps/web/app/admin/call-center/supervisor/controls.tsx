"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StaffAgentOption, SupervisorTaskView } from "@/callcenter/supervisor-store";

// Supervisor task-management controls (C2). Renders the board's open
// tasks with reassign / release / force-close controls; every action
// POSTs to /api/v1/admin/call-center/supervisor/actions (staff.manage +
// module.call_center gated server-side) and router.refresh()es on
// success so the server-rendered board re-reads the DB. Props are plain
// serializable data only — no function props cross the boundary.
interface Props {
  tasks: SupervisorTaskView[];
  agents: StaffAgentOption[];
}

type ActionBody =
  | { action: "reassign"; taskId: string; agentId: string }
  | { action: "release"; taskId: string }
  | { action: "force-close"; taskId: string; reason: string };

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
    return <p>No open tasks right now — nothing to manage.</p>;
  }

  return (
    <div>
      {message ? (
        <p role="status" style={{ color: message.ok ? "green" : "crimson" }}>
          {message.text}
        </p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Phone</th>
            <th>Source</th>
            <th>Status</th>
            <th>Order</th>
            <th>Assignee</th>
            <th>Age</th>
            <th>Attempts</th>
            <th>Manage</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const busy = busyTaskId === t.id;
            const chosenAgent = selectedAgent[t.id] ?? "";
            const reason = reasons[t.id] ?? "";
            return (
              <tr key={t.id}>
                <td>{t.customerName || "—"}</td>
                <td>{t.phoneMasked}</td>
                <td>{t.source}</td>
                <td>{t.status}</td>
                <td>{t.orderNo ?? "—"}</td>
                <td>{t.assignedAgentName ?? t.assignedAgentId ?? "—"}</td>
                <td>{t.ageMinutes}m</td>
                <td>{t.attempts}</td>
                <td>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    <select
                      aria-label={`Reassign target for task ${t.id}`}
                      value={chosenAgent}
                      disabled={busy}
                      onChange={(e) => setSelectedAgent((s) => ({ ...s, [t.id]: e.target.value }))}
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
                    >
                      Reassign
                    </button>
                    <button
                      type="button"
                      disabled={busy || t.assignedAgentId === null}
                      onClick={() => run({ action: "release", taskId: t.id })}
                    >
                      Release
                    </button>
                    <input
                      aria-label={`Force-close reason for task ${t.id}`}
                      placeholder="Force-close reason (required)"
                      value={reason}
                      disabled={busy}
                      onChange={(e) => setReasons((s) => ({ ...s, [t.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      disabled={busy || reason.trim() === ""}
                      onClick={() => run({ action: "force-close", taskId: t.id, reason: reason.trim() })}
                    >
                      Force-close
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

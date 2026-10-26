import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { loadSupervisorBoard, type SupervisorBoard } from "@/callcenter/supervisor-store";
import { CallCenterTabs } from "../tabs";
import { AutoRefresh } from "./auto-refresh";
import { SupervisorControls } from "./controls";

// Call center SUPERVISOR console — C2.
// Locked state: identical contract to the agent page (/admin/call-center)
// — while module.call_center is OFF the page renders the lock panel.
// Data: Prisma DB via src/callcenter/supervisor-store.ts (board
// aggregates + task views). This board carries MASKED phone numbers
// only — full numbers stay behind the agent queue API's
// customers.view_full_phone gate.
// Access: the supervisor API requires staff.manage; this page renders
// for any signed-in admin route session (the admin shell's own gate),
// and the action POSTs re-check staff.manage server-side, so a
// non-supervisor sees the board read-only in effect (actions 403).
// Refresh: <AutoRefresh /> polls router.refresh() every 20s while the
// tab is visible — true realtime waits for the worker host.
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Dhaka", hour12: true });
}

const cardStyle: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "10px 14px",
  minWidth: 130,
};

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 12, color: "#666" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function Board({ board }: { board: SupervisorBoard }) {
  const sourceLine = (Object.entries(board.countsBySource) as [string, number][])
    .map(([source, count]) => `${source}: ${count}`)
    .join(" · ");
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Call Center — Supervisor</h1>
      <CallCenterTabs active="supervisor" />
      <p>
        Live board from the database (masked numbers only), generated {fmtTime(board.generatedAt)} (Asia/Dhaka).
        Auto-refreshes every 20 seconds while this tab is visible — polling, not realtime; realtime waits for the
        worker host. SLA: confirmation tasks must be attempted within {board.sla.confirmMinutes} minutes, failed-delivery
        rescues within {board.sla.rescueMinutes} minutes (Settings: call_center.sla_confirm_minutes /
        call_center.sla_rescue_minutes).
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, margin: "16px 0" }}>
        <StatCard label="Queued" value={String(board.countsByStatus.QUEUED)} />
        <StatCard label="In call" value={String(board.countsByStatus.IN_CALL)} />
        <StatCard label="Unassigned" value={String(board.unassignedCount)} />
        <StatCard
          label="Oldest queued"
          value={board.oldestQueuedAgeMinutes === null ? "—" : `${board.oldestQueuedAgeMinutes}m`}
        />
        <StatCard label="Due callbacks" value={String(board.dueCallbacks.length)} />
        <StatCard label="SLA breaches" value={String(board.slaBreaches.length)} />
        <StatCard label="Done" value={String(board.countsByStatus.DONE)} />
        <StatCard label="Skipped" value={String(board.countsByStatus.SKIPPED)} />
      </div>
      <p>By source — {sourceLine}</p>

      <h2 style={{ color: board.slaBreaches.length > 0 ? "crimson" : undefined }}>
        SLA Breaches ({board.slaBreaches.length})
      </h2>
      {board.slaBreaches.length === 0 ? (
        <p>No breaches — every open confirmation/rescue task is inside its SLA window or already attempted.</p>
      ) : (
        <table style={{ border: "2px solid crimson" }}>
          <thead>
            <tr>
              <th>Rule</th><th>Customer</th><th>Phone</th><th>Source</th><th>Order</th><th>Assignee</th>
              <th>Age</th><th>SLA</th><th>Overdue by</th>
            </tr>
          </thead>
          <tbody>
            {board.slaBreaches.map((b) => (
              <tr key={b.id}>
                <td>{b.rule === "CONFIRM" ? "Confirmation" : "Rescue"}</td>
                <td>{b.customerName || "—"}</td>
                <td>{b.phoneMasked}</td>
                <td>{b.source}</td>
                <td>{b.orderNo ?? "—"}</td>
                <td>{b.assignedAgentName ?? b.assignedAgentId ?? "—"}</td>
                <td>{b.ageMinutes}m</td>
                <td>{b.thresholdMinutes}m</td>
                <td style={{ color: "crimson", fontWeight: 600 }}>{b.overdueByMinutes}m</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Due / Overdue Callbacks ({board.dueCallbacks.length})</h2>
      {board.dueCallbacks.length === 0 ? (
        <p>No callbacks are due right now.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Customer</th><th>Phone</th><th>Source</th><th>Order</th><th>Assignee</th>
              <th>Callback at</th><th>Overdue by</th>
            </tr>
          </thead>
          <tbody>
            {board.dueCallbacks.map((cb) => (
              <tr key={cb.id}>
                <td>{cb.customerName || "—"}</td>
                <td>{cb.phoneMasked}</td>
                <td>{cb.source}</td>
                <td>{cb.orderNo ?? "—"}</td>
                <td>{cb.assignedAgentName ?? cb.assignedAgentId ?? "—"}</td>
                <td>{cb.callbackAt ? fmtTime(cb.callbackAt) : "—"}</td>
                <td style={{ color: cb.minutesOverdue > 0 ? "crimson" : undefined }}>{cb.minutesOverdue}m</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Agents Today (Asia/Dhaka)</h2>
      {board.agentLoads.length === 0 ? (
        <p>No agent holds an open task and nobody has logged an outcome today.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Agent</th><th>In call</th><th>Queued assigned</th><th>Outcomes today</th><th>Confirmed today</th>
            </tr>
          </thead>
          <tbody>
            {board.agentLoads.map((a) => (
              <tr key={a.agentId}>
                <td>{a.agentName ?? a.agentId}</td>
                <td>{a.inCall}</td>
                <td>{a.queuedAssigned}</td>
                <td>{a.outcomesToday}</td>
                <td>{a.confirmedToday}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Manage Tasks</h2>
      <p>
        Reassign, release back to the pool, or force-close with a reason. Every action is written to the
        task&apos;s call log (REASSIGNED / RELEASED / FORCE_CLOSED) under your name.
      </p>
      <SupervisorControls tasks={board.openTasks} agents={board.agents} />
      <AutoRefresh />
    </main>
  );
}

export default async function AdminCallCenterSupervisorPage() {
  await ensureDbFeatureFlags().catch(() => {});
  if (!isCallCenterEnabled(demoCallCenterFlags)) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Call Center — Supervisor</h1>
        <p role="status">
          🔒 This module is locked for this install. Call center is a paid add-on —
          enable <code>module.call_center</code> in Admin &gt; Settings &gt; Feature Flags to unlock it.
        </p>
      </main>
    );
  }
  let board: SupervisorBoard;
  try {
    board = await loadSupervisorBoard();
  } catch {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Call Center — Supervisor</h1>
        <p role="alert">ডাটাবেস থেকে সুপারভাইজার বোর্ড পড়া যায়নি — কোনো সংখ্যা দেখানো হচ্ছে না। (Could not read the supervisor board from the database; no numbers are shown.)</p>
      </main>
    );
  }
  return <Board board={board} />;
}

import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon, type IconName } from "@/components/ui/icon";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import {
  loadSupervisorBoard,
  type SupervisorAgentLoad,
  type SupervisorBoard,
} from "@/callcenter/supervisor-store";
import { SlaChip, SourceChip, TaskCard } from "@/callcenter/components";
import { slaStateForTask } from "@/callcenter/components";
import { formatDhakaTime } from "@/orders/components/labels";
import { CallCenterTabs } from "../tabs";
import { AutoRefresh } from "./auto-refresh";
import { SupervisorControls } from "./controls";
import { ageLabel } from "./board-ui";

// Call center SUPERVISOR console — C2 (CD2 redesign: same board data,
// card-based presentation).
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
// tab is visible — polling, not realtime; realtime waits for the
// worker host. The indicator shows the board's generatedAt so the
// freshness is visible instead of implied.

function SectionTitle({ icon, children, tone }: { icon: IconName; children: ReactNode; tone?: string }) {
  return (
    <h2 className={`mt-8 mb-3 flex items-center gap-2 text-base font-semibold ${tone ?? "text-text-main"}`}>
      <Icon name={icon} size={18} />
      {children}
    </h2>
  );
}

function SlaTile({
  label,
  value,
  icon,
  accent,
  valueClass,
}: {
  label: string;
  value: string;
  icon: IconName;
  accent: string;
  valueClass: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-card p-4 shadow-card">
      <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] ${accent}`}>
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-text-muted">{label}</p>
        <p className={`font-mono text-2xl font-bold leading-7 tabular-nums ${valueClass}`}>{value}</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card px-3.5 py-3 shadow-card">
      <p className="text-[11px] font-medium text-text-muted">{label}</p>
      <p className="mt-0.5 font-mono text-lg font-bold leading-6 tabular-nums text-text-main">{value}</p>
    </div>
  );
}

function AgentLoadCard({ load, maxActive }: { load: SupervisorAgentLoad; maxActive: number }) {
  const active = load.inCall + load.queuedAssigned;
  const loadPct = maxActive > 0 ? Math.round((active / maxActive) * 100) : 0;
  const confirmPct = load.outcomesToday > 0 ? Math.round((load.confirmedToday / load.outcomesToday) * 100) : 0;
  return (
    <article className="rounded-lg border border-border/70 bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-text-main">
          {load.agentName ?? load.agentId}
        </p>
        <Badge tone={load.inCall > 0 ? "info" : "neutral"} icon={<Icon name="phone" size={12} />}>
          {load.inCall > 0 ? "কলে আছে" : "মুক্ত"}
        </Badge>
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-xs text-text-muted">
          <span>সক্রিয় টাস্ক (কল + সারি)</span>
          <span className="font-mono font-semibold tabular-nums text-text-main">{active}</span>
        </div>
        <div
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2"
          role="img"
          aria-label={`Active tasks ${active} of board max ${maxActive}`}
        >
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${loadPct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-text-muted">
          কলে <span className="font-medium text-text-main">{load.inCall}</span> · সারিতে দায়িত্ব{" "}
          <span className="font-medium text-text-main">{load.queuedAssigned}</span>
        </p>
      </div>

      <div className="mt-3 border-t border-border/60 pt-3">
        <div className="flex justify-between text-xs text-text-muted">
          <span>আজকের আউটকাম</span>
          <span className="font-mono font-semibold tabular-nums text-text-main">{load.outcomesToday}</span>
        </div>
        <div
          className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-surface-2"
          role="img"
          aria-label={`Confirmed ${load.confirmedToday} of ${load.outcomesToday} outcomes today`}
        >
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${confirmPct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-text-muted">
          কনফার্ম <span className="font-medium text-emerald-700">{load.confirmedToday}</span> · বাকি আউটকাম{" "}
          <span className="font-medium text-text-main">{load.outcomesToday - load.confirmedToday}</span>
        </p>
      </div>
    </article>
  );
}

function Board({ board }: { board: SupervisorBoard }) {
  // SLA chips are judged against the board's own generation instant,
  // so they always agree with the aggregates on this page.
  const now = new Date(board.generatedAt);
  const callbackStateById = new Map(
    board.dueCallbacks.map((c) => [c.id, slaStateForTask(c, now, board.sla)]),
  );
  const openTotal = board.countsByStatus.QUEUED + board.countsByStatus.IN_CALL;
  const withinSla = openTotal - board.slaBreaches.length;
  const maxActive = Math.max(1, ...board.agentLoads.map((a) => a.inCall + a.queuedAssigned));
  const queuedTasks = board.openTasks.filter((t) => t.status === "QUEUED");
  const inCallTasks = board.openTasks.filter((t) => t.status === "IN_CALL");
  const capped = openTotal > board.openTasks.length;

  return (
    <main>
      <PageHeader
        title="সুপারভাইজার কনসোল"
        description="Call Center — Supervisor board (masked numbers only)"
        breadcrumb="Admin / Call Center"
      />
      <CallCenterTabs active="supervisor" />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <AutoRefresh generatedAt={board.generatedAt} />
        <span className="text-xs text-text-muted">
          SLA: কনফার্মেশন টাস্ক {board.sla.confirmMinutes} মিনিটে, ডেলিভারি রেসকিউ {board.sla.rescueMinutes}{" "}
          মিনিটে চেষ্টা করতে হয় (Settings: call_center.sla_confirm_minutes / call_center.sla_rescue_minutes)।
        </span>
      </div>

      {/* SLA status summary — counts straight from the board payload */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <SlaTile
          label="SLA-এর মধ্যে আছে (খোলা টাস্ক)"
          value={String(withinSla)}
          icon="shield"
          accent="bg-emerald-50 text-emerald-600"
          valueClass="text-emerald-700"
        />
        <SlaTile
          label="কলব্যাকের সময় হয়েছে"
          value={String(board.dueCallbacks.length)}
          icon="clock"
          accent="bg-amber-50 text-amber-600"
          valueClass={board.dueCallbacks.length > 0 ? "text-amber-700" : "text-text-main"}
        />
        <SlaTile
          label="SLA ভেঙেছে"
          value={String(board.slaBreaches.length)}
          icon="alert"
          accent="bg-rose-50 text-rose-600"
          valueClass={board.slaBreaches.length > 0 ? "text-rose-700" : "text-text-main"}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat label="সারিতে · Queued" value={String(board.countsByStatus.QUEUED)} />
        <MiniStat label="কলে আছে · In call" value={String(board.countsByStatus.IN_CALL)} />
        <MiniStat label="দায়িত্বহীন · Unassigned" value={String(board.unassignedCount)} />
        <MiniStat
          label="সবচেয়ে পুরনো সারির টাস্ক"
          value={board.oldestQueuedAgeMinutes === null ? "—" : `${board.oldestQueuedAgeMinutes}m`}
        />
        <MiniStat label="সম্পন্ন · Done" value={String(board.countsByStatus.DONE)} />
        <MiniStat label="স্কিপ · Skipped" value={String(board.countsByStatus.SKIPPED)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-text-muted">উৎস অনুযায়ী:</span>
        {(Object.entries(board.countsBySource) as [keyof typeof board.countsBySource, number][]).map(
          ([source, count]) => (
            <span key={source} className="inline-flex items-center gap-1.5">
              <SourceChip source={source} />
              <span className="font-mono text-xs font-semibold tabular-nums text-text-main">{count}</span>
            </span>
          ),
        )}
      </div>

      {/* Due / overdue callbacks — attention strip */}
      <SectionTitle icon="bell" tone={board.dueCallbacks.length > 0 ? "text-rose-700" : undefined}>
        বাকি কলব্যাক · Due / Overdue Callbacks ({board.dueCallbacks.length})
      </SectionTitle>
      {board.dueCallbacks.length === 0 ? (
        <p className="text-sm text-text-muted">No callbacks are due right now.</p>
      ) : (
        <Card className="border-rose-200 bg-rose-50/60 p-4">
          <ul className="grid gap-2.5 lg:grid-cols-2">
            {board.dueCallbacks.map((cb) => {
              const cbState = callbackStateById.get(cb.id);
              return (
                <li
                  key={cb.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-100 bg-card px-3.5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-main">{cb.customerName || "—"}</p>
                    <p className="mt-0.5 font-mono text-xs tabular-nums text-text-muted">
                      {cb.phoneMasked} · কলব্যাক: {cb.callbackAt ? formatDhakaTime(cb.callbackAt) : "—"} ·{" "}
                      {cb.assignedAgentName ?? cb.assignedAgentId ?? "কেউ নয়"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <SourceChip source={cb.source} />
                    {cbState ? (
                      <SlaChip
                        state={cbState}
                        label={
                          cb.minutesOverdue > 0 ? `কলব্যাক ${cb.minutesOverdue} মিনিট পেরিয়ে` : undefined
                        }
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {/* SLA breaches */}
      <SectionTitle icon="alert" tone={board.slaBreaches.length > 0 ? "text-rose-700" : undefined}>
        SLA ভঙ্গ · SLA Breaches ({board.slaBreaches.length})
      </SectionTitle>
      {board.slaBreaches.length === 0 ? (
        <p className="text-sm text-text-muted">
          No breaches — every open confirmation/rescue task is inside its SLA window or already attempted.
        </p>
      ) : (
        <ul className="grid gap-2.5 lg:grid-cols-2">
          {board.slaBreaches.map((b) => (
            <li key={b.id} className="rounded-lg border-2 border-rose-200 bg-card p-4 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-semibold text-text-main">{b.customerName || "—"}</p>
                <div className="flex items-center gap-1.5">
                  <Badge tone="info">{b.rule === "CONFIRM" ? "কনফার্মেশন" : "রেসকিউ"}</Badge>
                  <SlaChip state="overdue" label={`${b.overdueByMinutes} মিনিট পেরিয়ে`} />
                </div>
              </div>
              <p className="mt-1 font-mono text-xs tabular-nums text-text-muted">
                {b.phoneMasked}
                {b.orderNo ? ` · ${b.orderNo}` : ""}
              </p>
              <div className="mt-2.5">
                <SourceChip source={b.source} />
              </div>
              <p className="mt-2.5 text-xs text-text-muted">
                দায়িত্বে:{" "}
                <span className="font-medium text-text-main">
                  {b.assignedAgentName ?? b.assignedAgentId ?? "কেউ নয়"}
                </span>{" "}
                · বয়স {ageLabel(b.ageMinutes)} · SLA সীমা {b.thresholdMinutes} মিনিট
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* Agents today — load cards */}
      <SectionTitle icon="users">আজকের এজেন্ট লোড · Agents Today (Asia/Dhaka)</SectionTitle>
      {board.agentLoads.length === 0 ? (
        <p className="text-sm text-text-muted">
          No agent holds an open task and nobody has logged an outcome today.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {board.agentLoads.map((a) => (
            <AgentLoadCard key={a.agentId} load={a} maxActive={maxActive} />
          ))}
        </div>
      )}

      {/* Live board grouped by status */}
      <SectionTitle icon="grid">লাইভ বোর্ড · Board by Status</SectionTitle>
      {capped ? (
        <p className="mb-3 text-xs text-text-muted">
          খোলা টাস্ক {openTotal}টি — বোর্ডে প্রথম {board.openTasks.length}টি দেখানো হচ্ছে।
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {(
          [
            { status: "QUEUED" as const, title: "সারিতে · Queued", tasks: queuedTasks, count: board.countsByStatus.QUEUED },
            { status: "IN_CALL" as const, title: "কলে আছে · In Call", tasks: inCallTasks, count: board.countsByStatus.IN_CALL },
          ]
        ).map((col) => (
          <section key={col.status} aria-label={col.title} className="rounded-lg border border-border/70 bg-surface-2/60 p-3.5">
            <h3 className="mb-3 flex items-center justify-between text-sm font-semibold text-text-main">
              <span className="flex items-center gap-2">
                <Icon name={col.status === "QUEUED" ? "clock" : "phone"} size={16} />
                {col.title}
              </span>
              <span className="rounded-full bg-card px-2 py-0.5 font-mono text-xs font-bold tabular-nums ring-1 ring-inset ring-black/5">
                {col.count}
              </span>
            </h3>
            {col.tasks.length === 0 ? (
              <p className="text-sm text-text-muted">এই অবস্থায় কোনো টাস্ক নেই।</p>
            ) : (
              <div className="space-y-2.5">
                {col.tasks.map((t) => (
                  <TaskCard key={t.id} task={t} slaThresholds={board.sla} now={now} />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <SectionTitle icon="settings">টাস্ক পরিচালনা · Manage Tasks</SectionTitle>
      <p className="mb-3 max-w-2xl text-sm leading-relaxed text-text-muted">
        Reassign, release back to the pool, or force-close with a reason. Every action is written to the
        task&apos;s call log (REASSIGNED / RELEASED / FORCE_CLOSED) under your name.
      </p>
      <SupervisorControls tasks={board.openTasks} agents={board.agents} />
    </main>
  );
}

export default async function AdminCallCenterSupervisorPage() {
  await ensureDbFeatureFlags();
  if (!isCallCenterEnabled(demoCallCenterFlags)) {
    return (
      <main>
        <PageHeader
          title="সুপারভাইজার কনসোল"
          description="Call Center — Supervisor"
          breadcrumb="Admin / Call Center"
        />
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
      <main>
        <PageHeader
          title="সুপারভাইজার কনসোল"
          description="Call Center — Supervisor"
          breadcrumb="Admin / Call Center"
        />
        <p role="alert">ডাটাবেস থেকে সুপারভাইজার বোর্ড পড়া যায়নি — কোনো সংখ্যা দেখানো হচ্ছে না। (Could not read the supervisor board from the database; no numbers are shown.)</p>
      </main>
    );
  }
  return <Board board={board} />;
}

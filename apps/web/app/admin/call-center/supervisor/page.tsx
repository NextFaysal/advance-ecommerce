import type { ReactNode } from "react";
import { PageHeader } from "@/admin-shell/PageHeader";
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
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
import { CallCenterTabs } from "../tabs";
import { CALL_CENTER_STRINGS } from "../strings";
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
    <h2 className={`mt-8 mb-3 flex items-center gap-2 font-display text-base font-semibold ${tone ?? "text-text-main"}`}>
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
    <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
      <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] ${accent}`}>
        <Icon name={icon} size={20} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-text-muted">{label}</p>
        <p className={`tnum font-mono text-2xl font-bold leading-7 tabular-nums ${valueClass}`}>{value}</p>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-3.5 py-3 shadow-xs">
      <p className="text-[11px] font-medium text-text-muted">{label}</p>
      <p className="tnum mt-0.5 font-mono text-lg font-bold leading-6 tabular-nums text-text-main">{value}</p>
    </div>
  );
}

function AgentLoadCard({ load, maxActive, locale }: { load: SupervisorAgentLoad; maxActive: number; locale: Locale }) {
  const s = pick(locale, CALL_CENTER_STRINGS);
  const active = load.inCall + load.queuedAssigned;
  const loadPct = maxActive > 0 ? Math.round((active / maxActive) * 100) : 0;
  const confirmPct = load.outcomesToday > 0 ? Math.round((load.confirmedToday / load.outcomesToday) * 100) : 0;
  return (
    <article className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-text-main">
          {load.agentName ?? load.agentId}
        </p>
        <Badge tone={load.inCall > 0 ? "info" : "neutral"} icon={<Icon name="phone" size={12} />}>
          {load.inCall > 0 ? s.inCallBadge : s.freeBadge}
        </Badge>
      </div>

      <div className="mt-3">
        <div className="flex justify-between text-xs text-text-muted">
          <span>{s.activeTasksLabel}</span>
          <span className="tnum font-mono font-semibold tabular-nums text-text-main">{active}</span>
        </div>
        <div
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2"
          role="img"
          aria-label={interpolate(s.ariaActiveTasks, { active, max: maxActive })}
        >
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${loadPct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-text-muted">
          {s.inCallWord} <span className="font-medium text-text-main">{load.inCall}</span> · {s.queuedAssignedWord}{" "}
          <span className="font-medium text-text-main">{load.queuedAssigned}</span>
        </p>
      </div>

      <div className="mt-3 border-t border-border/60 pt-3">
        <div className="flex justify-between text-xs text-text-muted">
          <span>{s.todayOutcomes}</span>
          <span className="tnum font-mono font-semibold tabular-nums text-text-main">{load.outcomesToday}</span>
        </div>
        <div
          className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-surface-2"
          role="img"
          aria-label={interpolate(s.ariaConfirmed, { confirmed: load.confirmedToday, total: load.outcomesToday })}
        >
          <div className="h-full bg-success-solid transition-all" style={{ width: `${confirmPct}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-text-muted">
          {s.confirmedWord} <span className="font-medium text-success-solid">{load.confirmedToday}</span> · {s.otherOutcomesWord}{" "}
          <span className="font-medium text-text-main">{load.outcomesToday - load.confirmedToday}</span>
        </p>
      </div>
    </article>
  );
}

function Board({ board, locale }: { board: SupervisorBoard; locale: Locale }) {
  const s = pick(locale, CALL_CENTER_STRINGS);
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
        title={s.supervisorTitle}
        subtitle={s.supervisorDesc}
      />
      <CallCenterTabs active="supervisor" />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <AutoRefresh generatedAt={board.generatedAt} />
        <span className="text-xs text-text-muted">
          {interpolate(s.slaNote, { confirm: board.sla.confirmMinutes, rescue: board.sla.rescueMinutes })}
        </span>
      </div>

      {/* SLA status summary — counts straight from the board payload */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <SlaTile
          label={s.tileWithinSla}
          value={String(withinSla)}
          icon="shield"
          accent="bg-success-soft text-success-solid"
          valueClass="text-success-solid"
        />
        <SlaTile
          label={s.tileCallbacksDue}
          value={String(board.dueCallbacks.length)}
          icon="clock"
          accent="bg-warning-soft text-warning-solid"
          valueClass={board.dueCallbacks.length > 0 ? "text-warning-solid" : "text-text-main"}
        />
        <SlaTile
          label={s.tileSlaBreached}
          value={String(board.slaBreaches.length)}
          icon="alert"
          accent="bg-danger-soft text-danger"
          valueClass={board.slaBreaches.length > 0 ? "text-danger" : "text-text-main"}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MiniStat label={s.miniQueued} value={String(board.countsByStatus.QUEUED)} />
        <MiniStat label={s.miniInCall} value={String(board.countsByStatus.IN_CALL)} />
        <MiniStat label={s.miniUnassigned} value={String(board.unassignedCount)} />
        <MiniStat
          label={s.miniOldest}
          value={board.oldestQueuedAgeMinutes === null ? "—" : `${board.oldestQueuedAgeMinutes}m`}
        />
        <MiniStat label={s.miniDone} value={String(board.countsByStatus.DONE)} />
        <MiniStat label={s.miniSkipped} value={String(board.countsByStatus.SKIPPED)} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-text-muted">{s.bySourceLabel}</span>
        {(Object.entries(board.countsBySource) as [keyof typeof board.countsBySource, number][]).map(
          ([source, count]) => (
            <span key={source} className="inline-flex items-center gap-1.5">
              <SourceChip source={source} lang={locale} />
              <span className="tnum font-mono text-xs font-semibold tabular-nums text-text-main">{count}</span>
            </span>
          ),
        )}
      </div>

      {/* Due / overdue callbacks — attention strip */}
      <SectionTitle icon="bell" tone={board.dueCallbacks.length > 0 ? "text-danger" : undefined}>
        {interpolate(s.dueSectionTitle, { count: board.dueCallbacks.length })}
      </SectionTitle>
      {board.dueCallbacks.length === 0 ? (
        <p className="text-sm text-text-muted">{s.noCallbacksDue}</p>
      ) : (
        <Card className="border-danger/30 bg-danger-soft/60 p-4">
          <ul className="grid gap-2.5 lg:grid-cols-2">
            {board.dueCallbacks.map((cb) => {
              const cbState = callbackStateById.get(cb.id);
              return (
                <li
                  key={cb.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/20 bg-card px-3.5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text-main">{cb.customerName || "—"}</p>
                    <p className="tnum mt-0.5 font-mono text-xs tabular-nums text-text-muted">
                      {cb.phoneMasked} · {s.callbackPrefix} {cb.callbackAt ? formatDhakaTime(cb.callbackAt) : "—"} ·{" "}
                      {cb.assignedAgentName ?? cb.assignedAgentId ?? s.nobody}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <SourceChip source={cb.source} lang={locale} />
                    {cbState ? (
                      <SlaChip
                        state={cbState}
                        lang={locale}
                        label={
                          cb.minutesOverdue > 0 ? interpolate(s.callbackOverdueLabel, { mins: cb.minutesOverdue }) : undefined
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
      <SectionTitle icon="alert" tone={board.slaBreaches.length > 0 ? "text-danger" : undefined}>
        {interpolate(s.breachesSectionTitle, { count: board.slaBreaches.length })}
      </SectionTitle>
      {board.slaBreaches.length === 0 ? (
        <p className="text-sm text-text-muted">
          {s.noBreaches}
        </p>
      ) : (
        <ul className="grid gap-2.5 lg:grid-cols-2">
          {board.slaBreaches.map((b) => (
            <li key={b.id} className="rounded-2xl border-2 border-danger/40 bg-card p-4 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-semibold text-text-main">{b.customerName || "—"}</p>
                <div className="flex items-center gap-1.5">
                  <Badge tone="info">{b.rule === "CONFIRM" ? s.ruleConfirm : s.ruleRescue}</Badge>
                  <SlaChip state="overdue" lang={locale} label={interpolate(s.overdueLabel, { mins: b.overdueByMinutes })} />
                </div>
              </div>
              <p className="tnum mt-1 font-mono text-xs tabular-nums text-text-muted">
                {b.phoneMasked}
                {b.orderNo ? ` · ${b.orderNo}` : ""}
              </p>
              <div className="mt-2.5">
                <SourceChip source={b.source} lang={locale} />
              </div>
              <p className="mt-2.5 text-xs text-text-muted">
                {s.assignedToLabel}{" "}
                <span className="font-medium text-text-main">
                  {b.assignedAgentName ?? b.assignedAgentId ?? s.nobody}
                </span>{" "}
                · {s.ageWord} {ageLabel(b.ageMinutes, locale)} · {interpolate(s.slaLimitPart, { mins: b.thresholdMinutes })}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* Agents today — load cards */}
      <SectionTitle icon="users">{s.agentsSectionTitle}</SectionTitle>
      {board.agentLoads.length === 0 ? (
        <p className="text-sm text-text-muted">
          {s.noAgentsToday}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {board.agentLoads.map((a) => (
            <AgentLoadCard key={a.agentId} load={a} maxActive={maxActive} locale={locale} />
          ))}
        </div>
      )}

      {/* Live board grouped by status */}
      <SectionTitle icon="grid">{s.boardSectionTitle}</SectionTitle>
      {capped ? (
        <p className="mb-3 text-xs text-text-muted">
          {interpolate(s.cappedNote, { open: openTotal, shown: board.openTasks.length })}
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {(
          [
            { status: "QUEUED" as const, title: s.colQueuedTitle, tasks: queuedTasks, count: board.countsByStatus.QUEUED },
            { status: "IN_CALL" as const, title: s.colInCallTitle, tasks: inCallTasks, count: board.countsByStatus.IN_CALL },
          ]
        ).map((col) => (
          <section key={col.status} aria-label={col.title} className="rounded-2xl border border-border/60 bg-surface-2/60 p-3.5">
            <h3 className="mb-3 flex items-center justify-between font-display text-sm font-semibold text-text-main">
              <span className="flex items-center gap-2">
                <Icon name={col.status === "QUEUED" ? "clock" : "phone"} size={16} />
                {col.title}
              </span>
              <span className="tnum rounded-full bg-card px-2 py-0.5 font-mono text-xs font-bold tabular-nums ring-1 ring-inset ring-black/5">
                {col.count}
              </span>
            </h3>
            {col.tasks.length === 0 ? (
              <p className="text-sm text-text-muted">{s.noTasksInState}</p>
            ) : (
              <div className="space-y-2.5">
                {col.tasks.map((t) => (
                  <TaskCard key={t.id} task={t} slaThresholds={board.sla} now={now} lang={locale} />
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <SectionTitle icon="settings">{s.manageSectionTitle}</SectionTitle>
      <p className="mb-3 max-w-2xl text-sm leading-relaxed text-text-muted">
        {s.manageDesc}
      </p>
      <SupervisorControls tasks={board.openTasks} agents={board.agents} />
    </main>
  );
}

export default async function AdminCallCenterSupervisorPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
  await ensureDbFeatureFlags();
  if (!isCallCenterEnabled(demoCallCenterFlags)) {
    return (
      <main>
        <PageHeader
          title={s.supervisorTitle}
          subtitle={s.supervisorDescShort}
        />
        <p role="status">
          {s.lockedA} <code>module.call_center</code> {s.lockedB}
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
          title={s.supervisorTitle}
          subtitle={s.supervisorDescShort}
        />
        <p role="alert">{s.boardReadError}</p>
      </main>
    );
  }
  return <Board board={board} locale={locale} />;
}

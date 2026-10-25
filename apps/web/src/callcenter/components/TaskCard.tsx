/**
 * TaskCard — CD0 (doc 20 §2). The ONE queue-item card shared by the
 * agent workbench queue, the callbacks strip and the supervisor
 * board, so a task reads identically wherever it appears.
 *
 * Presentational only: it renders the queue-item view fields both
 * real views already carry (CallTaskView in ../types, SupervisorTaskView
 * in ../supervisor-store) and computes nothing except the SLA chip
 * (via ./sla when the caller passes thresholds + now). The phone is
 * the MASKED number from the view — this component has no access to
 * a full number and never renders one.
 *
 * `onSelect` is an event handler, so parents that pass it must be
 * client components (the workbench and supervisor controls already
 * are); parents that pass only data may live on either side of the
 * RSC boundary. `actions` / `children` are ReactNode slots.
 */
import type { ReactNode } from "react";
import { Icon } from "../../components/ui/icon";
import { Money } from "../../components/ui/money";
import { formatDhakaTime, STATUS_TONE_DOT_CLASS } from "../../orders/components/labels";
import type { CallOutcome, CallQueueSource, CallTaskStatus } from "../types";
import { OutcomeBadge, SlaChip, SourceChip, type VisualLang } from "./badges";
import { slaStateForTask, type SlaThresholds } from "./sla";
import { TASK_STATUS_VISUAL } from "./visuals";

/** Structural minimum of a queue item. Both CallTaskView and
 *  SupervisorTaskView satisfy it; board-only extras (assignedAgentName)
 *  and workbench-only extras (note, lastOutcome) are optional. */
export interface TaskCardTask {
  customerName: string;
  /** ALWAYS masked — never a full number. */
  phoneMasked: string;
  source: CallQueueSource;
  status: CallTaskStatus;
  priority: number;
  createdAt?: string;
  callbackAt?: string;
  attempts?: number;
  orderNo?: string;
  orderTotalPoisha?: number;
  assignedAgentName?: string | null;
  lastOutcome?: CallOutcome;
  note?: string;
}

export interface TaskCardProps {
  task: TaskCardTask;
  /** When both are given, the card shows its SlaChip (state computed
   *  by slaStateForTask; nothing renders when no SLA applies). */
  slaThresholds?: SlaThresholds;
  now?: Date;
  lang?: VisualLang;
  selected?: boolean;
  /** Client-component parents only (event handler prop). */
  onSelect?: () => void;
  /** Footer action row (buttons/menus) — rendered outside the
   *  select target so nested interactives stay valid. */
  actions?: ReactNode;
  /** Extra context under the meta lines (e.g. Customer 360 excerpt). */
  children?: ReactNode;
  className?: string;
}

export function TaskCard({
  task,
  slaThresholds,
  now,
  lang = "bn",
  selected = false,
  onSelect,
  actions,
  children,
  className = "",
}: TaskCardProps) {
  const bn = lang === "bn";
  const slaState =
    slaThresholds && now
      ? slaStateForTask(
          {
            status: task.status,
            source: task.source,
            createdAt: task.createdAt,
            callbackAt: task.callbackAt,
            attempts: task.attempts,
          },
          now,
          slaThresholds,
        )
      : null;
  const statusVisual = TASK_STATUS_VISUAL[task.status];

  const main = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-text-main">
          {task.customerName || (bn ? "অজানা গ্রাহক" : "Unknown customer")}
        </p>
        {slaState ? <SlaChip state={slaState} lang={lang} /> : null}
      </div>

      <p className="mt-1 flex items-center gap-1.5 text-sm text-text-muted">
        <Icon name="phone" size={13} />
        <span className="font-mono tabular-nums">{task.phoneMasked}</span>
        {task.orderNo ? (
          <span className="text-text-subtle">
            · <span className="font-mono">{task.orderNo}</span>
          </span>
        ) : null}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <SourceChip source={task.source} lang={lang} />
        <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-xs font-medium leading-none text-text-muted ring-1 ring-inset ring-black/5">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${STATUS_TONE_DOT_CLASS[statusVisual.tone]}`}
          />
          {bn ? statusVisual.labelBn : statusVisual.labelEn}
        </span>
        {task.lastOutcome ? <OutcomeBadge outcome={task.lastOutcome} lang={lang} /> : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
        {task.orderTotalPoisha ? (
          <span className="inline-flex items-center gap-1">
            <Icon name="banknote" size={12} />
            <Money poisha={task.orderTotalPoisha} />
          </span>
        ) : null}
        <span>
          {bn ? "অগ্রাধিকার" : "Priority"} {task.priority}
        </span>
        {task.attempts ? (
          <span>
            {bn ? "চেষ্টা" : "Attempts"} {task.attempts}
          </span>
        ) : null}
        {task.assignedAgentName ? (
          <span className="inline-flex items-center gap-1">
            <Icon name="user" size={12} />
            {task.assignedAgentName}
          </span>
        ) : null}
      </div>

      {task.callbackAt || task.createdAt ? (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-text-muted">
          <Icon name={task.callbackAt ? "clock" : "info"} size={12} />
          {task.callbackAt
            ? `${bn ? "কলব্যাক" : "Callback"}: ${formatDhakaTime(task.callbackAt)}`
            : `${bn ? "তৈরি" : "Created"}: ${formatDhakaTime(task.createdAt!)}`}
        </p>
      ) : null}

      {task.note ? (
        <p className="mt-1.5 line-clamp-2 text-xs text-text-muted">{task.note}</p>
      ) : null}
    </>
  );

  return (
    <article
      className={`rounded-xl bg-card p-3.5 shadow-sm ring-1 ${
        selected ? "ring-2 ring-brand-500" : "ring-border"
      } ${className}`}
    >
      {onSelect ? (
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          {main}
        </button>
      ) : (
        <div>{main}</div>
      )}
      {children}
      {actions ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          {actions}
        </div>
      ) : null}
    </article>
  );
}

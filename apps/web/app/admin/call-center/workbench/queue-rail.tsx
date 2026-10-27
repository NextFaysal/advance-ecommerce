"use client";

/**
 * Queue rail (CD1) — the LEFT zone of the workbench workspace.
 *
 * Contents (same data the monolith had): the unassigned-pool summary,
 * the claim-next action and the offered next task as a CD0 TaskCard,
 * plus the manual-task form (passed in as children by the shell,
 * which owns its state). On desktop this is a static column; on
 * mobile it becomes a slide-in drawer toggled from the shell header —
 * the content and handlers are identical in both modes.
 */
import type { ReactNode } from "react";
import { TaskCard } from "@/callcenter/components";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { CALL_CENTER_STRINGS } from "../strings";
import { SOURCE_LABEL, type TaskView } from "./shared";

export function QueueRail({
  unassignedCount,
  upNext,
  current,
  busy,
  onClaimNext,
  onClaimTask,
  open,
  onClose,
  children,
}: {
  unassignedCount: number;
  upNext: TaskView | null;
  current: TaskView | null;
  busy: boolean;
  onClaimNext: () => void;
  onClaimTask: (taskId: string) => void;
  open: boolean;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { locale } = useLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
  return (
    <div
      className={
        open
          ? "fixed inset-0 z-50 xl:static xl:z-auto"
          : "hidden xl:block"
      }
    >
      {open ? (
        <button
          type="button"
          aria-label={s.closeQueueAria}
          onClick={onClose}
          className="absolute inset-0 bg-slate-900/50 xl:hidden"
        />
      ) : null}
      <aside className="relative flex h-full w-[86vw] max-w-xs flex-col gap-4 overflow-y-auto bg-card p-4 shadow-xl xl:h-auto xl:w-auto xl:max-w-none xl:bg-transparent xl:p-0 xl:shadow-none">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
            {s.queueHeading}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-surface-2 px-2.5 py-1 text-xs font-medium text-text-main hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 xl:hidden"
          >
            {s.closeButton}
          </button>
        </div>

        <div className="rounded-xl border border-border bg-surface-2 p-3">
          <p className="text-sm text-text-muted">{s.unassignedLabel}</p>
          <p className="mt-0.5 text-3xl font-bold tabular-nums">{unassignedCount}{s.countSuffix}</p>
        </div>

        {!current ? (
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={onClaimNext}
              className="w-full rounded-md bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              {s.claimNext}
            </button>
            {upNext ? (
              <div className="mt-3">
                <p className="mb-1.5 text-sm font-medium">{s.nextTaskReady}</p>
                <TaskCard
                  task={upNext}
                  lang={locale}
                  actions={
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onClaimTask(upNext.id)}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      {s.claimThisCall}
                    </button>
                  }
                />
                <p className="mt-1.5 text-xs text-text-muted">{SOURCE_LABEL[upNext.source][locale]}</p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-text-muted">
                {s.noTasksNow}
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
            {s.callInProgressNote}
          </p>
        )}

        {children}
      </aside>
    </div>
  );
}

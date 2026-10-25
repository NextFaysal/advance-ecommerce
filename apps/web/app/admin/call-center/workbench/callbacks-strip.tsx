"use client";

/**
 * Callbacks strip (CD1) — the due-callback alert row and the
 * "my callbacks" row, full-width above the workspace grid.
 *
 * Behaviour is the monolith's, unchanged: both lists render in the
 * exact order the queue GET returned them (the server sorts; this
 * component never re-sorts), the claim button appears only while no
 * task is in hand (an agent mid-call is never offered a second claim),
 * and each row is a CD0 TaskCard with an explicit SlaChip for the
 * due state (the hand-rolled "দেরি" badge is replaced by the shared
 * SLA language — see the CD1 report).
 */
import { SlaChip, TaskCard } from "@/callcenter/components";
import { bnDateTime, type TaskView } from "./shared";

function CallbackRow({
  task,
  current,
  busy,
  onClaimTask,
  accent,
}: {
  task: TaskView;
  current: TaskView | null;
  busy: boolean;
  onClaimTask: (taskId: string) => void;
  accent: "amber" | "sky";
}) {
  return (
    <li className="w-72 shrink-0 snap-start">
      <TaskCard
        task={task}
        actions={
          !current ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onClaimTask(task.id)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
                accent === "amber"
                  ? "bg-amber-500 hover:bg-amber-600"
                  : "bg-sky-600 hover:bg-sky-700"
              }`}
            >
              এই কলটি নিন
            </button>
          ) : undefined
        }
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2 px-0.5">
        {/* The workbench payload carries no SLA thresholds, so only the
            board's threshold-free callback rule is shown: callbackAt < now. */}
        {task.callbackAt && Date.parse(task.callbackAt) < Date.now() ? (
          <SlaChip state="overdue" />
        ) : null}
        {task.callbackAt ? (
          <span className="text-xs text-slate-600">সময়: {bnDateTime(task.callbackAt)}</span>
        ) : null}
      </div>
    </li>
  );
}

export function CallbacksStrip({
  dueCallbacks,
  myCallbacks,
  current,
  busy,
  onClaimTask,
}: {
  dueCallbacks: TaskView[];
  myCallbacks: TaskView[];
  current: TaskView | null;
  busy: boolean;
  onClaimTask: (taskId: string) => void;
}) {
  if (dueCallbacks.length === 0 && myCallbacks.length === 0) return null;
  return (
    <div className="space-y-3">
      {dueCallbacks.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <h3 className="text-sm font-semibold text-amber-900">
            ⏰ কলব্যাকের সময় হয়েছে ({dueCallbacks.length}টি)
          </h3>
          <ul className="mt-2 flex snap-x gap-3 overflow-x-auto pb-1">
            {dueCallbacks.map((t) => (
              <CallbackRow
                key={t.id}
                task={t}
                current={current}
                busy={busy}
                onClaimTask={onClaimTask}
                accent="amber"
              />
            ))}
          </ul>
        </div>
      ) : null}

      {myCallbacks.length > 0 ? (
        <div className="rounded-xl border border-sky-300 bg-sky-50 p-3">
          <h3 className="text-sm font-semibold text-sky-900">
            🗓 আমার কলব্যাক ({myCallbacks.length}টি)
          </h3>
          <ul className="mt-2 flex snap-x gap-3 overflow-x-auto pb-1">
            {myCallbacks.map((t) => (
              <CallbackRow
                key={t.id}
                task={t}
                current={current}
                busy={busy}
                onClaimTask={onClaimTask}
                accent="sky"
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

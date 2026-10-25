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
          aria-label="কিউ বন্ধ করুন"
          onClick={onClose}
          className="absolute inset-0 bg-slate-900/50 xl:hidden"
        />
      ) : null}
      <aside className="relative flex h-full w-[86vw] max-w-xs flex-col gap-4 overflow-y-auto bg-white p-4 shadow-xl xl:h-auto xl:w-auto xl:max-w-none xl:bg-transparent xl:p-0 xl:shadow-none">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            কিউ (Queue)
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 xl:hidden"
          >
            ✕ বন্ধ করুন
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm text-slate-600">অ্যাসাইন না করা টাস্ক বাকি</p>
          <p className="mt-0.5 text-3xl font-bold tabular-nums">{unassignedCount}টি</p>
        </div>

        {!current ? (
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={onClaimNext}
              className="w-full rounded-md bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              📞 পরবর্তী কল নিন (Claim next task)
            </button>
            {upNext ? (
              <div className="mt-3">
                <p className="mb-1.5 text-sm font-medium">পরের টাস্ক প্রস্তুত:</p>
                <TaskCard
                  task={upNext}
                  actions={
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onClaimTask(upNext.id)}
                      className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      এই কলটি নিন
                    </button>
                  }
                />
                <p className="mt-1.5 text-xs text-slate-500">{SOURCE_LABEL[upNext.source]}</p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                এই মুহূর্তে দেওয়ার মতো টাস্ক নেই — নতুন অর্ডার/কলব্যাক এলে এখানে আসবে।
              </p>
            )}
          </div>
        ) : (
          <p className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
            একটি কল চলছে — ফলাফল রেকর্ড হলে পরের টাস্ক এখানে আসবে।
          </p>
        )}

        {children}
      </aside>
    </div>
  );
}

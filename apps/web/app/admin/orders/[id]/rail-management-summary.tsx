"use client";

// OD2 (doc 19 §3-S2) — rail management summary for the order
// workspace. A read-only mirror of the পরিচালনা tab's data: it GETs
// the same /management endpoint ManagementPanel uses (same view
// shape, mirrored locally — the panel file is not imported) and
// shows assignee / priority / hold / tags at a glance. It NEVER
// writes: ManagementPanel stays the only editor.
//
// Supplementary surface by design: while loading it shows skeleton
// rows (ui/skeleton); on 401/403/failure it renders nothing at all —
// the পরিচালনা tab keeps the full surface with its own error
// reporting, so a hidden summary loses no information.
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";

type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

interface ManagementSummaryView {
  assigneeName: string | null;
  priority: Priority;
  tags: string[];
  held: boolean;
  heldReason: string | null;
}

/** Mirrors ManagementPanel's maps exactly (same labels, same tones). */
const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "কম",
  NORMAL: "সাধারণ",
  HIGH: "বেশি",
  URGENT: "জরুরি",
};

const PRIORITY_TONE: Record<Priority, "success" | "warning" | "danger" | "info" | "neutral"> = {
  LOW: "neutral",
  NORMAL: "info",
  HIGH: "warning",
  URGENT: "danger",
};

export function RailManagementSummary({ orderId }: { orderId: string }) {
  const [view, setView] = useState<ManagementSummaryView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "hidden">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/v1/admin/orders/${encodeURIComponent(orderId)}/management`,
        );
        if (!res.ok) {
          if (!cancelled) setState("hidden");
          return;
        }
        const json = (await res.json().catch(() => ({}))) as {
          data?: ManagementSummaryView;
        };
        if (cancelled) return;
        if (json.data) {
          setView(json.data);
          setState("ready");
        } else {
          setState("hidden");
        }
      } catch {
        if (!cancelled) setState("hidden");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (state === "hidden") return null;

  return (
    <Card className="shadow-card">
      <h2 className="mb-3 text-base font-semibold">পরিচালনা</h2>
      {state === "loading" || !view ? (
        <div className="space-y-2" role="status" aria-label="পরিচালনার সারাংশ লোড হচ্ছে">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : (
        <>
          {view.held ? (
            <p
              role="alert"
              className="mb-3 flex items-start gap-2 rounded-md bg-rose-50 px-3 py-2 text-small font-medium leading-relaxed text-rose-700"
            >
              <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
              <span>
                হোল্ড করা আছে
                {view.heldReason ? ` — ${view.heldReason}` : ""}
              </span>
            </p>
          ) : null}
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">দায়িত্বে</dt>
              <dd className="font-medium">{view.assigneeName ?? "কেউ নির্ধারিত নয়"}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">অগ্রাধিকার</dt>
              <dd>
                <Badge tone={PRIORITY_TONE[view.priority]}>{PRIORITY_LABEL[view.priority]}</Badge>
              </dd>
            </div>
            {view.tags.length > 0 ? (
              <div className="flex items-start justify-between gap-3">
                <dt className="pt-0.5 text-text-muted">ট্যাগ</dt>
                <dd className="flex flex-wrap justify-end gap-1">
                  {view.tags.map((t) => (
                    <Badge key={t} tone="neutral">
                      {t}
                    </Badge>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
        </>
      )}
      <p className="mt-3 text-caption text-text-muted">বদলাতে হলে: পরিচালনা ট্যাব</p>
    </Card>
  );
}

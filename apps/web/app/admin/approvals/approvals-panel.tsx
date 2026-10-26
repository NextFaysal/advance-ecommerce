"use client";

/**
 * Approvals panel (ADV-27) — self-fetching over
 * GET /api/v1/admin/approvals + POST /api/v1/admin/approvals/[id]/decide.
 *
 * Shows the live orders.approvals.* configuration (so staff can see
 * WHICH rule produced the queue), the pending requests with the
 * exact numbers that blocked the action, and the recent decision
 * history. Approve/Reject call the decide route (orders.edit —
 * Owner/Manager); reject requires a reason, enforced server-side
 * and mirrored here. When approvals are disabled in Settings the
 * queue is informational only — new blocks stop occurring, and the
 * panel says so instead of implying the gate is live.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface ApprovalConfigView {
  enabled: boolean;
  discountThresholdBps: number;
  refundThresholdPoisha: number;
}

interface ApprovalEntry {
  id: string;
  kind: "discount" | "refund";
  orderId: string;
  refundId: string | null;
  discountPoisha: number | null;
  subtotalPoisha: number | null;
  discountBps: number | null;
  thresholdBps: number | null;
  amountPoisha: number | null;
  thresholdPoisha: number | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requestedById: string | null;
  requestedByName: string | null;
  requestedAt: string;
  decidedById: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  orderNo: string | null;
  orderStatus: string | null;
  customerName: string | null;
  refundStatus: string | null;
}

const dateFmt = new Intl.DateTimeFormat("bn-BD", {
  timeZone: "Asia/Dhaka",
  dateStyle: "medium",
  timeStyle: "short",
});

function pctLabel(bps: number | null): string {
  if (bps === null) return "—";
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

function EntryCard({
  entry,
  busy,
  onDecide,
}: {
  entry: ApprovalEntry;
  busy: boolean;
  onDecide: (entry: ApprovalEntry, decision: "APPROVED" | "REJECTED", reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const pending = entry.status === "PENDING";
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={entry.kind === "discount" ? "warning" : "info"}>
              {entry.kind === "discount" ? "ছাড়ের অনুমোদন" : "রিফান্ডের অনুমোদন"}
            </Badge>
            <Badge
              tone={entry.status === "PENDING" ? "warning" : entry.status === "APPROVED" ? "success" : "danger"}
            >
              {entry.status === "PENDING"
                ? "অনুমোদনের অপেক্ষায়"
                : entry.status === "APPROVED"
                  ? "অনুমোদিত"
                  : "প্রত্যাখ্যাত"}
            </Badge>
            {entry.orderNo && (
              <Link href={`/admin/orders/${entry.orderId}`} className="font-medium underline">
                {entry.orderNo}
              </Link>
            )}
            {entry.customerName && <span className="text-muted-foreground">{entry.customerName}</span>}
          </div>
          {entry.kind === "discount" ? (
            <p className="text-sm">
              ছাড় {pctLabel(entry.discountBps)}
              {entry.discountPoisha !== null && entry.subtotalPoisha !== null && (
                <>
                  {" "}
                  ({formatBdt(entry.discountPoisha)} / মোট {formatBdt(entry.subtotalPoisha)})
                </>
              )}{" "}
              — সীমা {pctLabel(entry.thresholdBps)}। অনুমোদন ছাড়া এই অর্ডার নিশ্চিত করা যাবে না।
            </p>
          ) : (
            <p className="text-sm">
              রিফান্ড {entry.amountPoisha !== null ? formatBdt(entry.amountPoisha) : "—"} — সীমা{" "}
              {entry.thresholdPoisha !== null ? formatBdt(entry.thresholdPoisha) : "—"}। অনুমোদন ছাড়া এই রিফান্ড
              পাঠানো যাবে না।
              {entry.refundStatus && <> বর্তমান অবস্থা: {entry.refundStatus}।</>}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            অনুরোধ: {entry.requestedByName ?? entry.requestedById ?? "—"} · {dateFmt.format(new Date(entry.requestedAt))}
            {entry.decidedAt && (
              <>
                {" "}
                · সিদ্ধান্ত: {entry.decidedByName ?? entry.decidedById ?? "—"} ·{" "}
                {dateFmt.format(new Date(entry.decidedAt))}
                {entry.decisionReason && <> · কারণ: {entry.decisionReason}</>}
              </>
            )}
          </p>
        </div>
        {pending && (
          <div className="flex min-w-64 flex-col gap-2">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="কারণ (প্রত্যাখ্যানের জন্য আবশ্যক)"
              maxLength={500}
            />
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => onDecide(entry, "APPROVED", reason)}>
                অনুমোদন দিন
              </Button>
              <Button
                variant="outline"
                disabled={busy || reason.trim() === ""}
                onClick={() => onDecide(entry, "REJECTED", reason)}
              >
                প্রত্যাখ্যান
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export function ApprovalsPanel() {
  const [config, setConfig] = useState<ApprovalConfigView | null>(null);
  const [entries, setEntries] = useState<ApprovalEntry[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "error" | "ready">("loading");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await fetch("/api/v1/admin/approvals");
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.data) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      setConfig(body.data.config);
      setEntries(body.data.entries);
      setLoadState("ready");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "লোড করা যায়নি।");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = useCallback(
    async (entry: ApprovalEntry, decision: "APPROVED" | "REJECTED", reason: string) => {
      setBusyId(entry.id);
      setMessage("");
      try {
        const res = await fetch(`/api/v1/admin/approvals/${entry.id}/decide`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision, reason: reason.trim() ? reason.trim() : undefined }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
        setMessage(
          decision === "APPROVED"
            ? "অনুমোদন দেওয়া হয়েছে — এখন সংশ্লিষ্ট কাজটি আবার চেষ্টা করা যাবে।"
            : "অনুরোধ প্রত্যাখ্যান করা হয়েছে।",
        );
        await load();
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "সিদ্ধান্ত সংরক্ষণ করা যায়নি।");
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const pending = entries.filter((e) => e.status === "PENDING");
  const decided = entries.filter((e) => e.status !== "PENDING").slice(0, 50);

  return (
    <div className="space-y-4">
      {config && (
        <Card className="p-4 text-sm">
          {config.enabled ? (
            <p>
              অনুমোদন ব্যবস্থা <strong>চালু</strong> আছে: ছাড় {pctLabel(config.discountThresholdBps)} বা তার বেশি
              হলে অর্ডার নিশ্চিত করতে ম্যানেজারের অনুমোদন লাগে, আর {formatBdt(config.refundThresholdPoisha)}-এর
              বেশি রিফান্ড পাঠাতে অনুমোদন লাগে। সীমা বদলাতে Settings &gt; Orders (orders.approvals.*) ব্যবহার
              করুন।
            </p>
          ) : (
            <p>
              অনুমোদন ব্যবস্থা <strong>বন্ধ</strong> আছে (Settings: orders.approvals.enabled) — নতুন কোনো অনুরোধ
              তৈরি হচ্ছে না; নিচের তালিকাটি আগের রেকর্ড মাত্র।
            </p>
          )}
        </Card>
      )}
      {message && <Card className="p-3 text-sm">{message}</Card>}
      {loadState === "loading" && <p className="text-sm text-muted-foreground">লোড হচ্ছে…</p>}
      {loadState === "error" && (
        <p className="text-sm text-destructive">তালিকা লোড করা যায়নি। আবার চেষ্টা করুন।</p>
      )}
      {loadState === "ready" && pending.length === 0 && (
        <Card className="p-4 text-sm">অপেক্ষমাণ কোনো অনুরোধ নেই।</Card>
      )}
      {pending.map((entry) => (
        <EntryCard key={entry.id} entry={entry} busy={busyId === entry.id} onDecide={decide} />
      ))}
      {decided.length > 0 && (
        <>
          <h2 className="pt-2 text-base font-semibold">সাম্প্রতিক সিদ্ধান্ত</h2>
          {decided.map((entry) => (
            <EntryCard key={entry.id} entry={entry} busy={false} onDecide={decide} />
          ))}
        </>
      )}
    </div>
  );
}

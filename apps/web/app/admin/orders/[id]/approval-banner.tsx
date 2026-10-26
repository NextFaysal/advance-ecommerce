"use client";

/**
 * Approval state banner (ADV-27) — renders the approval workflow
 * state carried on the order detail payload as `approval`
 * (src/orders/approvals.getOrderApprovalState): a pending discount
 * approval means this order CANNOT be confirmed until a manager
 * approves it at /admin/approvals, and the banner says exactly that
 * (with the discount share that triggered it) instead of the block
 * surfacing only as a failed confirm click. Pending refund
 * approvals on this order are listed too. Renders nothing when
 * there is nothing to say.
 *
 * The prop types are declared locally (structural mirror of the
 * server read model) — this client component must not import the
 * server module that owns them.
 */
import Link from "next/link";
import { formatBdt } from "../../../../src/checkout/pricing";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ApprovalRecordView {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  discountBps: number | null;
  thresholdBps: number | null;
  amountPoisha: number | null;
  decisionReason: string | null;
}

interface OrderApprovalStateView {
  discount: ApprovalRecordView | null;
  pendingDiscount: boolean;
  refunds: ApprovalRecordView[];
}

function pctLabel(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

export function ApprovalBanner({ approval }: { approval?: OrderApprovalStateView }) {
  if (!approval) return null;
  const pendingRefunds = approval.refunds.filter((r) => r.status === "PENDING");
  const d = approval.discount;
  if (!d && pendingRefunds.length === 0) return null;
  return (
    <Card className="shadow-card">
      <h2 className="mb-3 text-base font-semibold">অনুমোদন</h2>
      <div className="space-y-3 text-sm">
        {d && (
          <div className="space-y-1">
            <Badge tone={d.status === "PENDING" ? "warning" : d.status === "APPROVED" ? "success" : "danger"}>
              {d.status === "PENDING"
                ? "অনুমোদনের অপেক্ষায়"
                : d.status === "APPROVED"
                  ? "ছাড় অনুমোদিত"
                  : "ছাড় প্রত্যাখ্যাত"}
            </Badge>
            <p className="leading-relaxed">
              এই অর্ডারে ছাড় {d.discountBps !== null ? pctLabel(d.discountBps) : "—"}%
              {d.thresholdBps !== null && <> (সীমা {pctLabel(d.thresholdBps)}%)</>}।
              {d.status === "PENDING" && (
                <>
                  {" "}
                  ম্যানেজারের অনুমোদন ছাড়া অর্ডারটি নিশ্চিত করা যাবে না —{" "}
                  <Link href="/admin/approvals" className="font-medium text-brand-700 hover:underline">
                    অনুমোদনের তালিকায় যান
                  </Link>
                  ।
                </>
              )}
              {d.status === "REJECTED" && <> আবার নিশ্চিত করার চেষ্টা করলে নতুন অনুরোধ তৈরি হবে।</>}
              {d.decisionReason && <> সিদ্ধান্তের কারণ: {d.decisionReason}</>}
            </p>
          </div>
        )}
        {pendingRefunds.map((r) => (
          <div key={r.id} className="space-y-1">
            <Badge tone="warning">রিফান্ডের অনুমোদনের অপেক্ষায়</Badge>
            <p className="leading-relaxed">
              {r.amountPoisha !== null ? formatBdt(r.amountPoisha) : "—"} রিফান্ডটি ম্যানেজারের অনুমোদন ছাড়া
              পাঠানো যাবে না —{" "}
              <Link href="/admin/approvals" className="font-medium text-brand-700 hover:underline">
                অনুমোদনের তালিকায় যান
              </Link>
              ।
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

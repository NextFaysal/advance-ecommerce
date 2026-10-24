"use client";

// Bulk action bar for the admin order list — selection lives in the list
// page; this bar sends ONE request to the existing bulk endpoint
// (POST /api/v1/admin/orders) and shows the API's own answer verbatim.
// HONEST CONTRACT: that endpoint is a validated + audited STUB — it
// returns 202 QUEUED_FOR_BULK_JOB and changes nothing until the BullMQ
// bulk job is wired (Step 17/22). The bar never claims orders were
// confirmed/booked/printed.
import { useState } from "react";
import { Button } from "../../components/ui/button";

export type BulkAction = "confirm" | "print_label" | "book_courier";

type BulkApiResponse =
  | { data: { action: string; orderIds: string[]; status: string }; meta?: { stub?: boolean; note?: string } }
  | { error: { code: string; message: string; details?: unknown } };

const ACTION_LABEL_BN: Record<BulkAction, string> = {
  confirm: "বাল্ক কনফার্ম",
  print_label: "বাল্ক লেবেল প্রিন্ট",
  book_courier: "বাল্ক কুরিয়ার বুকিং",
};

export function BulkActionBar({
  selectedIds,
  onClear,
}: {
  selectedIds: string[];
  onClear: () => void;
}) {
  const [busy, setBusy] = useState<BulkAction | null>(null);
  const [result, setResult] = useState<string>("");

  if (selectedIds.length === 0) return null;

  async function run(action: BulkAction) {
    setBusy(action);
    setResult("");
    try {
      const res = await fetch("/api/v1/admin/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, orderIds: selectedIds }),
      });
      const body = (await res.json().catch(() => null)) as BulkApiResponse | null;
      if (body && "data" in body) {
        setResult(
          `${ACTION_LABEL_BN[action]} — API উত্তর: HTTP ${res.status} · স্ট্যাটাস ${body.data.status} · ${body.data.orderIds.length}টি অর্ডার। ${body.meta?.note ?? ""} (কিছুই এখনো কার্যকর হয়নি — স্টাব)`,
        );
      } else if (body && "error" in body) {
        setResult(`${ACTION_LABEL_BN[action]} — API উত্তর: HTTP ${res.status} · ${body.error.code}: ${body.error.message}`);
      } else {
        setResult(`${ACTION_LABEL_BN[action]} — API উত্তর: HTTP ${res.status} (অপ্রত্যাশিত উত্তর)।`);
      }
    } catch {
      setResult(`${ACTION_LABEL_BN[action]} — API-তে পৌঁছানো যায়নি (নেটওয়ার্ক)। কিছুই পাঠানো হয়নি।`);
    }
    setBusy(null);
  }

  return (
    <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{selectedIds.length}টি অর্ডার সিলেক্ট করা হয়েছে</p>
        {(Object.keys(ACTION_LABEL_BN) as BulkAction[]).map((action) => (
          <Button
            key={action}
            type="button"
            size="sm"
            variant={action === "book_courier" ? "primary" : "outline"}
            loading={busy === action}
            disabled={busy !== null}
            onClick={() => void run(action)}
          >
            {ACTION_LABEL_BN[action]}
          </Button>
        ))}
        <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={onClear}>
          সিলেকশন মুছুন
        </Button>
      </div>
      <p className="mt-2 text-xs text-text-muted">
        বাল্ক API এখন একটি স্টাব: ভ্যালিডেট + অডিট করে <strong>202 QUEUED_FOR_BULK_JOB</strong> ফেরত দেয় —
        আসল কনফার্ম/বুকিং/প্রিন্ট BullMQ জব wiring (Step 17/22) হলে হবে।
      </p>
      {result && (
        <p role="status" className="mt-2 text-sm">
          {result}
        </p>
      )}
    </div>
  );
}
